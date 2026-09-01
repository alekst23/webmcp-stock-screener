"""T-1016-2 AC1: appending a session costs a session, at any panel size.

One floor cannot be measured away: `PanelStore.put_object` takes bytes, so a
single-object store re-serializes the whole panel however clever the merge
is. What T-1016-2 removes is everything *above* that floor -- the row objects
and the whole-panel `(ticker, date)` index, which cost ~50x the serialized
panel and grew every night.

So the measured claim is a bounded multiple of the panel's own bytes, checked
at two panel sizes an order of magnitude apart: a constant small multiple is
the claim, and a multiple that grows -- or a large one -- is the defect. The
residual O(panel) rewrite is recorded as a known limit in the ticket, not
hidden by the metric.
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

from infra.panel_io import EPOCH_ORDINAL, PANEL_COLUMNS

_DAYS = 500
_SMALL_TICKERS = 100
_LARGE_TICKERS = 1_000

# Peak RSS per byte of stored panel, at the margin. Measured at ~2.4x; the
# row-object merge it replaced needed ~52x.
_PEAK_CEILING_MULTIPLE = 8.0

_BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _write_panel(path: Path, tickers: int) -> Path:
    rows = tickers * _DAYS
    symbols = np.array([f"T{index:05d}" for index in range(tickers)], dtype=object)
    origin = date(2015, 1, 5).toordinal() - EPOCH_ORDINAL
    days = np.tile(np.arange(origin, origin + _DAYS, dtype=np.int32), tickers)
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
            str(_BACKEND_ROOT / "scripts" / "measure_panel_append.py"),
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


class TestAppendMemory:
    def test_the_append_stays_a_bounded_multiple_of_the_panel_at_both_sizes(
        self, small_panel: Path, large_panel: Path
    ) -> None:
        small = _measure(small_panel, "merge")
        large = _measure(large_panel, "merge")

        # Marginal, not absolute: ~20 MB of any measurement is the
        # interpreter's fixed footprint, which flatters a large panel and
        # punishes a small one. The slope between the two is what says how
        # much a bigger panel actually costs to append to.
        marginal = (large["peak_bytes"] - small["peak_bytes"]) / (
            large["output_bytes"] - small["output_bytes"]
        )
        assert marginal < _PEAK_CEILING_MULTIPLE, (
            f"each extra byte of panel costs {marginal:.1f} bytes of peak to append "
            f"to, over the {_PEAK_CEILING_MULTIPLE}x ceiling: small={small}, large={large}"
        )

    def test_the_streaming_merge_costs_a_fraction_of_the_row_object_merge(
        self, small_panel: Path
    ) -> None:
        merge = _measure(small_panel, "merge")
        rows = _measure(small_panel, "rows")

        ratio = rows["peak_bytes"] / merge["peak_bytes"]
        assert ratio > 3.0, (
            f"expected the row-object merge to cost several times more; "
            f"merge={merge}, rows={rows}, ratio={ratio:.1f}x"
        )
