"""T-0013-1 AC1: the bulk load's cost is measured, not asserted.

Each measurement runs in a fresh subprocess and reads peak RSS, because the
allocations that matter here (arrow buffers, numpy arrays) never pass through
the Python allocator and are invisible to tracemalloc.

The claim is about *marginal* cost per row, so it is measured as a slope
across two panel sizes rather than as a single ratio. A one-panel number is
dominated by the interpreter's fixed footprint and gets better the larger the
panel, which is exactly the direction that would flatter a bad implementation.
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from infra.panel_io import PANEL_COLUMNS

_DAYS = 500
_SMALL_TICKERS = 300
_LARGE_TICKERS = 1_200
_LARGE_ROWS = _LARGE_TICKERS * _DAYS

# The compact layout is 26 bytes/row (infra/panel_frame.py). The load also
# holds one batch of wire data and the reader's own buffers, so the ceiling is
# a small multiple of that -- but nowhere near the ~1,100 bytes/row of the
# row-object path this replaced. Measured at ~63 bytes/row on this machine.
_MARGINAL_CEILING_BYTES_PER_ROW = 120

_BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _write_panel(path: Path, tickers: int) -> Path:
    """A wire-format panel built column-wise, so the fixture itself never
    materializes the row objects under test."""
    rows = tickers * _DAYS
    symbols = np.array([f"T{index:05d}" for index in range(tickers)], dtype=object)
    start = date(2015, 1, 5).toordinal() - date(1970, 1, 1).toordinal()
    days = np.tile(np.arange(start, start + _DAYS, dtype=np.int32), tickers)
    prices = np.linspace(10.0, 500.0, rows, dtype=np.float64)
    table = pa.Table.from_arrays(
        [
            pa.array(np.repeat(symbols, _DAYS), type=pa.string()),
            pa.array(days).cast(pa.date32()),
            pa.array(prices),
            pa.array(prices + 1.0),
            pa.array(prices - 1.0),
            pa.array(prices + 0.5),
            pa.array(np.full(rows, 1_000_000, dtype=np.int64)),
        ],
        names=PANEL_COLUMNS,
    )
    pq.write_table(table, path)
    return path


def _measure(panel: Path, mode: str) -> dict[str, float]:
    result = subprocess.run(
        [
            sys.executable,
            str(_BACKEND_ROOT / "scripts" / "measure_panel_memory.py"),
            "--panel",
            str(panel),
            "--mode",
            mode,
        ],
        cwd=_BACKEND_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return dict(json.loads(result.stdout.strip().splitlines()[-1]))


@pytest.fixture(scope="module")
def small_panel(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return _write_panel(tmp_path_factory.mktemp("small") / "panel.parquet", _SMALL_TICKERS)


@pytest.fixture(scope="module")
def large_panel(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return _write_panel(tmp_path_factory.mktemp("large") / "panel.parquet", _LARGE_TICKERS)


class TestPanelLoadMemory:
    def test_each_extra_row_costs_the_compact_representation(
        self, small_panel: Path, large_panel: Path
    ) -> None:
        small = _measure(small_panel, "frame")
        large = _measure(large_panel, "frame")

        assert large["rows"] == _LARGE_ROWS, f"expected {_LARGE_ROWS} rows: {large}"
        marginal = (large["peak_bytes"] - small["peak_bytes"]) / (large["rows"] - small["rows"])
        assert marginal < _MARGINAL_CEILING_BYTES_PER_ROW, (
            f"bulk load costs {marginal:.0f} bytes/row at the margin, over the "
            f"{_MARGINAL_CEILING_BYTES_PER_ROW} ceiling: small={small}, large={large}"
        )

    def test_the_bulk_path_costs_a_fraction_of_the_row_object_path(self, small_panel: Path) -> None:
        # The comparison, not the absolute number, is what the epic rests on:
        # the same bytes loaded both ways in the same environment. Measured on
        # the small panel only -- the row-object path needs ~2 KB/row, which
        # is the whole problem.
        frame = _measure(small_panel, "frame")
        bars = _measure(small_panel, "bars")

        ratio = bars["peak_bytes"] / frame["peak_bytes"]
        assert ratio > 4.0, (
            f"expected the row-object path to cost several times more; "
            f"frame={frame}, bars={bars}, ratio={ratio:.1f}x"
        )
