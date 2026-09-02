"""Measure the whole panel lifecycle at the target universe's scale.

The epic's sizing claim -- a trimmed liquid universe of ~2,000 tickers over
10+ years, served from a 512 MB instance with real headroom -- is a claim
about peak RSS at three moments: loading the panel, holding it, and searching
it. This script produces all three in one fresh process, so the numbers are
comparable and nothing carries over from an earlier stage.

    uv run python scripts/measure_universe_scale.py --panel /tmp/p.parquet \
        --tickers 2000 --days 2520 --build-only
    uv run python scripts/measure_universe_scale.py --panel /tmp/p.parquet

Two runs, because building a 5M-row panel raises the process's peak RSS and
peak RSS is exactly what the second run measures.

The panel is synthetic. That makes the memory figures real (the layout and
the row count are what cost memory, not the prices in them) and the *results*
meaningless -- which is why T-0013-6's acceptance also requires the same
measurement on the deployed instance against a real backfill.
"""

from __future__ import annotations

import argparse
import gc
import json
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
import pyarrow as pa

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from domain.models.pattern import SetupStep  # noqa: E402
from infra.pandas_engine import PandasPatternResearchEngine  # noqa: E402
from infra.panel_frame import PanelFrame  # noqa: E402
from infra.panel_io import (  # noqa: E402
    EPOCH_ORDINAL,
    PANEL_COLUMNS,
    parquet_bytes_to_panel,
    table_to_parquet_bytes,
)
from scripts.measure_panel_memory import peak_rss_bytes  # noqa: E402

_START = date(2015, 1, 5)

# Two whole-universe scans that differ only in how often their first step
# fires. Peak memory during a search is driven by the anchor count, not by the
# panel, so a single number without the selectivity beside it says nothing.
_PATTERNS = {
    # Fires on roughly half of all rows: the pessimistic end, and not a
    # pattern anyone would actually research.
    "broad": [
        SetupStep(condition="close > sma(close, 50)"),
        SetupStep(condition="volume > sma(volume, 20) * 1.5", within=(1, 5)),
    ],
    # A volume spike: the shape of a real first step, firing on a small
    # fraction of rows.
    "narrow": [
        SetupStep(condition="volume > sma(volume, 20) * 3"),
        SetupStep(condition="close > sma(close, 50)", within=(1, 5)),
    ],
}


def build_panel(tickers: int, days: int) -> bytes:
    """A wire-format panel of the requested shape, built column-wise so the
    fixture never costs more than the thing being measured."""
    rows = tickers * days
    symbols = np.array([f"SYN{index:05d}" for index in range(tickers)], dtype=object)
    origin = _START.toordinal() - EPOCH_ORDINAL
    dates = np.tile(np.arange(origin, origin + days, dtype=np.int32), tickers)
    # Per-ticker random walks, not one walk across the whole panel: a single
    # 5M-step cumsum drifts far enough to overflow float64 on the exponential.
    steps = np.random.default_rng(1016).normal(0.0, 0.02, size=(tickers, days))
    close = (50.0 * np.exp(np.cumsum(steps, axis=1))).reshape(rows)
    table = pa.Table.from_arrays(
        [
            pa.array(np.repeat(symbols, days), type=pa.string()),
            pa.array(dates).cast(pa.date32()),
            pa.array(close * 0.99),
            pa.array(close * 1.02),
            pa.array(close * 0.98),
            pa.array(close),
            pa.array((close * 10_000).astype(np.int64)),
        ],
        names=PANEL_COLUMNS,
    )
    return table_to_parquet_bytes(table)


def measure(data: bytes, pattern: str) -> dict[str, object]:
    """Every *_bytes figure below is an absolute, un-subtracted `ru_maxrss`
    reading (T-0016-9, AC1/AC7). This function used to take a baseline after
    the process was already warmed up (imports done, panel bytes on disk)
    and subtract it from every later reading -- since `ru_maxrss` is a
    high-water mark that never falls, that produced "growth since an
    already-late point," not the absolute number a container's memory limit
    enforces. `process_start_bytes` is recorded for context only; nothing is
    subtracted with it."""
    process_start = peak_rss_bytes()
    started = time.perf_counter()
    frame = parquet_bytes_to_panel(data)
    load_peak = peak_rss_bytes()
    load_seconds = time.perf_counter() - started

    resident = int(frame.memory_usage(deep=True).sum())
    engine = PandasPatternResearchEngine(PanelFrame(frame))
    setup = engine.define_setup("scale_check", _PATTERNS[pattern])
    gc.collect()
    before_search = peak_rss_bytes()

    started = time.perf_counter()
    result = engine.find_instances(setup)
    search_peak = peak_rss_bytes()
    search_seconds = time.perf_counter() - started

    return {
        "pattern": pattern,
        "rows": int(len(frame)),
        "tickers": int(frame["ticker"].nunique()),
        "panel_bytes": len(data),
        "resident_bytes": resident,
        "bytes_per_row": round(resident / len(frame), 1),
        "process_start_bytes": process_start,
        "load_peak_bytes": load_peak,
        "load_seconds": round(load_seconds, 2),
        "steady_state_bytes": before_search,
        "search_peak_bytes": search_peak,
        "search_seconds": round(search_seconds, 2),
        "anchors": result.complete_count + result.partial_count,
        "matches": result.complete_count,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tickers", type=int, default=2_000)
    parser.add_argument("--days", type=int, default=2_520)
    parser.add_argument("--panel", type=Path, required=True, help="Where the panel lives")
    parser.add_argument("--pattern", choices=sorted(_PATTERNS), default="narrow")
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="Write the panel and stop. Building it raises this process's peak RSS, so the "
        "measurement has to run afterwards in a fresh one.",
    )
    args = parser.parse_args()

    if args.build_only or not args.panel.exists():
        args.panel.write_bytes(build_panel(args.tickers, args.days))
        print(json.dumps({"built": str(args.panel), "bytes": args.panel.stat().st_size}))
        if args.build_only:
            return
        print(json.dumps({"warning": "measured in the process that built the panel"}))
    print(json.dumps(measure(args.panel.read_bytes(), args.pattern)))


if __name__ == "__main__":
    main()
