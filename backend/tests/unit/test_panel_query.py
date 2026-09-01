"""T-0013-3: a narrower question reads less of the panel.

The claim is about bytes decoded, so the tests assert on the read plan --
which row groups and which column chunks a read will touch, taken from the
file's own metadata -- rather than on wall time, which would measure the
machine rather than the layout.
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
import pyarrow as pa
import pytest

from infra.panel_io import (
    EPOCH_ORDINAL,
    PANEL_COLUMNS,
    PANEL_ROW_GROUP_ROWS,
    parquet_bytes_to_panel,
    table_to_parquet_bytes,
)
from infra.panel_query import panel_read_plan, parquet_bytes_to_subset

_TICKERS = [f"T{index:03d}" for index in range(60)]
_DAYS = 2_000
_START = date(2015, 1, 5)


def _panel() -> bytes:
    """60 tickers x 2,000 sessions -- 120,000 rows, so the panel spans five
    row groups and a single ticker lives in exactly one."""
    rows = len(_TICKERS) * _DAYS
    origin = _START.toordinal() - EPOCH_ORDINAL
    dates = np.tile(np.arange(origin, origin + _DAYS, dtype=np.int32), len(_TICKERS))
    prices = np.linspace(10.0, 500.0, rows, dtype=np.float64)
    table = pa.Table.from_arrays(
        [
            pa.array(np.repeat(np.array(_TICKERS, dtype=object), _DAYS), type=pa.string()),
            pa.array(dates).cast(pa.date32()),
            pa.array(prices),
            pa.array(prices + 1.0),
            pa.array(prices - 1.0),
            pa.array(prices + 0.5),
            pa.array(np.full(rows, 1_000_000, dtype=np.int64)),
        ],
        names=PANEL_COLUMNS,
    )
    return table_to_parquet_bytes(table)


@pytest.fixture(scope="module")
def panel() -> bytes:
    return _panel()


class TestRowGroupSizing:
    def test_the_panel_is_written_at_the_agreed_row_group_size(self, panel: bytes) -> None:
        # AC5: the sizing is the thing pruning granularity is made of, so it
        # is pinned rather than left to whatever the writer defaults to.
        plan = panel_read_plan(panel)

        expected = -(-len(_TICKERS) * _DAYS // PANEL_ROW_GROUP_ROWS)
        assert len(plan.row_groups) == expected, f"expected {expected} row groups: {plan}"


class TestPruning:
    def test_a_narrow_ticker_filter_reads_a_fraction_of_the_panel(self, panel: bytes) -> None:
        # AC1.
        plan = panel_read_plan(panel, tickers=["T000", "T001"])

        assert len(plan.row_groups) == 1, f"expected one row group, got {plan.row_groups}"
        assert plan.fraction_read < 0.25, f"read {plan.fraction_read:.0%} of the panel: {plan}"

    def test_an_unfiltered_read_still_reads_everything(self, panel: bytes) -> None:
        plan = panel_read_plan(panel)

        assert plan.fraction_read == pytest.approx(1.0), f"{plan}"

    def test_a_ticker_absent_from_the_panel_reads_nothing_and_returns_empty(
        self, panel: bytes
    ) -> None:
        # AC3: a filter that matches nothing is a legitimate answer, and must
        # not cost a scan to discover.
        plan = panel_read_plan(panel, tickers=["ZZZZ"])

        assert plan.row_groups == [], f"expected no row groups, got {plan.row_groups}"
        assert plan.compressed_bytes == 0, f"expected nothing read, got {plan.compressed_bytes}"

        frame = parquet_bytes_to_subset(panel, tickers=["ZZZZ"])
        assert frame.empty, f"expected an empty frame, got {len(frame)} rows"
        assert list(frame.columns) == PANEL_COLUMNS, f"got {list(frame.columns)}"


class TestProjection:
    def test_unnamed_columns_are_not_read(self, panel: bytes) -> None:
        # AC2.
        plan = panel_read_plan(panel, columns=["date", "close"])

        assert plan.columns == ["date", "close"], f"got {plan.columns}"
        assert plan.fraction_read < 0.6, f"read {plan.fraction_read:.0%} for two columns: {plan}"

    def test_ticker_is_read_to_filter_but_not_returned_unless_asked_for(self, panel: bytes) -> None:
        plan = panel_read_plan(panel, tickers=["T000"], columns=["close"])

        assert plan.columns == ["ticker", "close"], f"got {plan.columns}"
        frame = parquet_bytes_to_subset(panel, tickers=["T000"], columns=["close"])
        assert list(frame.columns) == ["close"], f"got {list(frame.columns)}"
        assert len(frame) == _DAYS, f"expected {_DAYS} rows, got {len(frame)}"


class TestSubsetMatchesTheWholePanel:
    def test_a_filtered_read_equals_the_full_panel_filtered(self, panel: bytes) -> None:
        # A layout change is only transparent (AC4) if the rows and dtypes it
        # returns are the ones the engine would have got from the whole panel.
        wanted = ["T005", "T059"]

        subset = parquet_bytes_to_subset(panel, tickers=wanted)

        full = parquet_bytes_to_panel(panel)
        expected = full[full["ticker"].isin(wanted)].reset_index(drop=True)
        expected["ticker"] = expected["ticker"].cat.remove_unused_categories()
        pd.testing.assert_frame_equal(subset, expected)

    def test_a_read_spanning_row_groups_keeps_the_panel_sort_order(self, panel: bytes) -> None:
        subset = parquet_bytes_to_subset(panel, tickers=["T059", "T000", "T030"])

        keys = list(zip(subset["ticker"].astype(str), subset["date"]))
        assert keys == sorted(keys), "a multi-group read must stay sorted by (ticker, date)"
        assert len(subset) == 3 * _DAYS, f"expected {3 * _DAYS} rows, got {len(subset)}"
