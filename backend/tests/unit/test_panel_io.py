"""T-0013-1: the bulk panel path is Parquet <-> compact frame, gated by column.

The old path validated every row with Pydantic on the way in, which is what
made the schema gate and the memory peak the same thing. Splitting them means
the gate needs its own tests: it now has to catch producer drift that no
per-row validator will ever see again.
"""

from __future__ import annotations

import io
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from domain.errors import PanelSchemaError
from domain.models.price import PriceBar
from infra.panel_frame import bars_to_panel
from infra.panel_io import (
    PANEL_COLUMNS,
    bars_to_parquet_bytes,
    panel_frame_to_wire_bytes,
    panel_status_from_frame,
    parquet_bytes_to_panel,
)
from scripts.generate_mock_panel import write_panel


def _bars(tickers: tuple[str, ...] = ("BBB", "AAA"), days: int = 4) -> list[PriceBar]:
    """Deliberately unsorted tickers: the writer is responsible for ordering."""
    start = date(2024, 1, 2)
    return [
        PriceBar(
            ticker=ticker,
            date=start + timedelta(days=offset),
            open=10.5 + offset,
            high=11.5 + offset,
            low=9.5 + offset,
            close=11.0 + offset,
            volume=1_000 + offset,
        )
        for ticker in tickers
        for offset in range(days)
    ]


def _wire_frame(bars: list[PriceBar]) -> pd.DataFrame:
    return pd.DataFrame([bar.model_dump() for bar in bars], columns=PANEL_COLUMNS)


def _parquet_of(frame: pd.DataFrame) -> bytes:
    buffer = io.BytesIO()
    frame.to_parquet(buffer, index=False)
    return buffer.getvalue()


class TestCompactLoad:
    def test_load_matches_the_frame_built_from_bars(self) -> None:
        # The compact frame is the engine's whole input, so the vectorized
        # reader has to agree with bars_to_panel dtype for dtype, not just
        # value for value -- a float64 slip here silently doubles residency.
        bars = _bars()

        loaded = parquet_bytes_to_panel(bars_to_parquet_bytes(bars))

        expected = bars_to_panel(bars)
        pd.testing.assert_frame_equal(loaded, expected)

    def test_mock_generator_and_real_pipeline_panels_load_identically(self, tmp_path: Path) -> None:
        # AC2: two producers, one wire format. The mock generator writes via
        # pandas from model_dump; the real pipeline writes column-wise arrow.
        bars = sorted(_bars(), key=lambda bar: (bar.ticker, bar.date))
        mock_path = write_panel(bars, output_path=tmp_path / "panel.parquet")

        from_mock = parquet_bytes_to_panel(mock_path.read_bytes())
        from_pipeline = parquet_bytes_to_panel(bars_to_parquet_bytes(bars))

        pd.testing.assert_frame_equal(from_mock, from_pipeline)

    def test_categories_are_lexicographic_whatever_order_rows_appear_in(self) -> None:
        # Arrow numbers dictionary entries by first appearance. A panel whose
        # rows are not ticker-sorted must still produce pandas' lexicographic
        # category order, or every code-based lookup in PanelFrame shifts.
        bars = _bars(tickers=("ZZZ", "AAA"), days=2)
        unsorted_wire = _parquet_of(_wire_frame(bars))

        loaded = parquet_bytes_to_panel(unsorted_wire)

        assert list(loaded["ticker"].cat.categories) == [
            "AAA",
            "ZZZ",
        ], f"expected lexicographic categories, got {list(loaded['ticker'].cat.categories)}"
        assert list(loaded["ticker"].astype(str)) == ["ZZZ", "ZZZ", "AAA", "AAA"], (
            "row order must be preserved: " f"{list(loaded['ticker'].astype(str))}"
        )

    def test_status_reads_off_the_compact_frame(self) -> None:
        frame = parquet_bytes_to_panel(bars_to_parquet_bytes(_bars()))

        status = panel_status_from_frame(frame, source="object-store")

        assert status.as_of == date(2024, 1, 5), f"got {status.as_of}"
        assert status.first_date == date(2024, 1, 2), f"got {status.first_date}"
        assert status.ticker_count == 2, f"got {status.ticker_count}"
        assert status.row_count == 8, f"got {status.row_count}"


class TestPanelFrameToWireBytes:
    """T-0016-13: the inverse of parquet_bytes_to_panel, for filtering an
    already-loaded panel in place (scripts/enforce_universe_floor.py)
    rather than rebuilding it from PriceBar objects."""

    def test_round_trip_reproduces_the_original_compact_frame(self) -> None:
        bars = _bars()
        original = bars_to_panel(bars)

        restored = parquet_bytes_to_panel(panel_frame_to_wire_bytes(original))

        pd.testing.assert_frame_equal(restored, original)

    def test_a_filtered_subset_writes_back_with_only_the_kept_tickers(self) -> None:
        # This is exactly what the enforcement rebuild does: drop rows for
        # tickers that do not clear the floor, then write the remainder.
        bars = _bars(tickers=("AAA", "BBB"), days=3)
        frame = bars_to_panel(bars)
        kept = frame[frame["ticker"] == "AAA"]

        restored = parquet_bytes_to_panel(panel_frame_to_wire_bytes(kept))

        tickers = set(restored["ticker"].astype(str))
        assert tickers == {"AAA"}, f"expected only AAA to survive, got {tickers}"
        assert len(restored) == 3, f"expected AAA's 3 rows, got {len(restored)}"


class TestSchemaGate:
    def test_a_missing_column_names_the_column(self) -> None:
        frame = _wire_frame(_bars()).drop(columns=["volume"])

        with pytest.raises(PanelSchemaError, match="volume"):
            parquet_bytes_to_panel(_parquet_of(frame))

    def test_a_wrong_dtype_names_the_column(self) -> None:
        # A producer writing prices as strings is the drift that used to
        # surface as a Pydantic error on row 1 of 12,000,000.
        frame = _wire_frame(_bars())
        frame["close"] = frame["close"].astype(str)

        with pytest.raises(PanelSchemaError, match="close"):
            parquet_bytes_to_panel(_parquet_of(frame))

    def test_reordered_columns_name_the_offending_position(self) -> None:
        reordered = ["ticker", "open", "date", "high", "low", "close", "volume"]
        frame = _wire_frame(_bars())[reordered]

        with pytest.raises(PanelSchemaError, match="open"):
            parquet_bytes_to_panel(_parquet_of(frame))

    def test_a_compatible_narrower_dtype_still_loads(self) -> None:
        # The gate checks type families, not exact dtypes: a producer that
        # writes float32 prices has not drifted from the contract.
        bars = sorted(_bars(), key=lambda bar: (bar.ticker, bar.date))
        table = pq.read_table(io.BytesIO(bars_to_parquet_bytes(bars)))
        narrowed = table.set_column(
            table.schema.get_field_index("close"),
            "close",
            table.column("close").cast(pa.float32()),
        )
        buffer = io.BytesIO()
        pq.write_table(narrowed, buffer)

        loaded = parquet_bytes_to_panel(buffer.getvalue())

        assert len(loaded) == len(bars), f"expected {len(bars)} rows, got {len(loaded)}"
