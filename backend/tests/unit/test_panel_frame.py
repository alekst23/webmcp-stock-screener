"""T-0001-9: the compact panel representation and its positional lookups.

The mock panel's 25 tickers never exposed the real universe's memory
profile. These tests pin the per-row cost and the lookup behavior that
replaced the per-row index dictionaries -- both invisible to every other
test, which only ever checks query results.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from domain.models.price import PriceBar
from infra.panel_frame import PanelFrame, bars_to_panel
from scripts.generate_mock_panel import generate_panel

# 26 bytes/row is the layout docs/reference/data-provider.md sizes against
# (category + int32 + 4x float32 + uint32). A little headroom absorbs
# pandas' fixed per-column overhead on a small fixture; anything near the
# previous 141 bytes/row blows the Render free tier's 512 MB at real scale.
_MAX_BYTES_PER_ROW = 32


def _bars(ticker: str, start: date, days: int) -> list[PriceBar]:
    return [
        PriceBar(
            ticker=ticker,
            date=start + timedelta(days=offset),
            open=10.0 + offset,
            high=11.0 + offset,
            low=9.0 + offset,
            close=10.5 + offset,
            volume=1_000 + offset,
        )
        for offset in range(days)
    ]


class TestCompactStorage:
    def test_panel_stays_within_the_memory_budget_per_row(self) -> None:
        frame = bars_to_panel(generate_panel())

        bytes_per_row = frame.memory_usage(deep=True).sum() / len(frame)

        assert bytes_per_row <= _MAX_BYTES_PER_ROW, (
            f"panel costs {bytes_per_row:.1f} bytes/row, over the "
            f"{_MAX_BYTES_PER_ROW} byte budget -- at ~12M real ticker-days "
            "that is what decides whether the API fits its instance"
        )

    def test_columns_use_the_compact_dtypes(self) -> None:
        frame = bars_to_panel(generate_panel())

        dtypes = {name: str(dtype) for name, dtype in frame.dtypes.items()}

        assert dtypes["ticker"] == "category", f"got {dtypes['ticker']}"
        assert dtypes["date"] == "int32", f"got {dtypes['date']}"
        assert dtypes["close"] == "float32", f"got {dtypes['close']}"
        assert dtypes["volume"] == "uint32", f"got {dtypes['volume']}"

    def test_prices_survive_the_full_traded_range(self) -> None:
        # Scaled int32 fixed-point at 4dp overflows above ~$214,748; BRK.A
        # trades near $712,000, and penny stocks print at $0.004.
        extremes = [
            PriceBar(
                ticker="BRKA",
                date=date(2024, 1, 2),
                open=712_000.0,
                high=715_000.0,
                low=710_000.0,
                close=712_500.0,
                volume=900,
            ),
            PriceBar(
                ticker="PENNY",
                date=date(2024, 1, 2),
                open=0.0056,
                high=0.0056,
                low=0.004,
                close=0.004,
                volume=55_006,
            ),
        ]
        panel = PanelFrame.from_bars(extremes)

        big = panel.bar_at(panel.row_position("BRKA", date(2024, 1, 2)) or 0)
        small = panel.bar_at(panel.row_position("PENNY", date(2024, 1, 2)) or 0)

        assert big.close == pytest.approx(712_500.0, rel=1e-6), f"got {big.close}"
        assert small.close == pytest.approx(0.004, rel=1e-6), f"got {small.close}"


class TestPositionalLookups:
    def test_row_position_finds_a_bar_and_reports_absence(self) -> None:
        panel = PanelFrame.from_bars(
            _bars("AAA", date(2024, 1, 1), 5) + _bars("BBB", date(2024, 1, 1), 5)
        )

        assert panel.row_position("BBB", date(2024, 1, 3)) == 7, "wrong absolute row"
        assert panel.row_position("BBB", date(2024, 2, 1)) is None, "expected a missing date"
        assert panel.row_position("CCC", date(2024, 1, 1)) is None, "expected a missing ticker"

    def test_ticker_bounds_do_not_bleed_into_the_next_ticker(self) -> None:
        # The lookups navigate one flat sorted frame, so an off-by-one in the
        # per-ticker range would silently read another company's prices.
        panel = PanelFrame.from_bars(
            _bars("AAA", date(2024, 1, 1), 5) + _bars("BBB", date(2024, 1, 1), 5)
        )

        assert panel.bounds("AAA") == (0, 5), f"got {panel.bounds('AAA')}"
        assert panel.bounds("BBB") == (5, 10), f"got {panel.bounds('BBB')}"

    def test_anchor_sample_stays_inside_the_requested_range(self) -> None:
        panel = PanelFrame.from_bars(_bars("AAA", date(2024, 1, 1), 30))

        sample = panel.anchor_sample(date(2024, 1, 10), date(2024, 1, 20), size=100)

        assert len(sample) == 11, f"expected the 11 in-range days, got {len(sample)}"
        for ticker, on_date in sample:
            assert ticker == "AAA", f"unexpected ticker {ticker}"
            assert date(2024, 1, 10) <= on_date <= date(2024, 1, 20), f"out of range: {on_date}"

    def test_anchor_sample_caps_at_the_requested_size(self) -> None:
        panel = PanelFrame.from_bars(_bars("AAA", date(2024, 1, 1), 30))

        sample = panel.anchor_sample(date(2024, 1, 1), date(2024, 1, 30), size=5)

        assert len(sample) == 5, f"expected 5 sampled anchors, got {len(sample)}"
