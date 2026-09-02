"""Measure what loading a panel actually costs, in peak RSS per row.

The epic's central claim -- that the row-object bulk path is what makes the
real panel unloadable -- is a memory claim, so it has to be measured rather
than asserted. Python-level tools (tracemalloc) cannot see it: numpy and
arrow allocate outside the Python allocator, which is precisely where the
compact frame lives. Peak RSS of a fresh process is the honest instrument.

Run directly against any panel file:
    uv run python scripts/measure_panel_memory.py --panel data/mock/panel.parquet --mode frame
    uv run python scripts/measure_panel_memory.py --panel data/mock/panel.parquet --mode bars

`frame` is the bulk path (`parquet_bytes_to_panel`); `bars` is the row-object
path it replaced (`parquet_bytes_to_bars`), kept measurable so the comparison
stays reproducible instead of historical.
"""

from __future__ import annotations

import argparse
import json
import resource
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from infra.panel_io import (  # noqa: E402
    bars_to_parquet_bytes,
    parquet_bytes_to_bars,
    parquet_bytes_to_panel,
)

_WARMUP_ROWS = 2


def peak_rss_bytes() -> int:
    """ru_maxrss is a high-water mark, so reading it after a load captures the
    transient peak even once the transient is freed. Linux reports kilobytes,
    macOS bytes."""
    peak = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return peak if sys.platform == "darwin" else peak * 1024


def _warm_up() -> None:
    """Both paths touch lazily-initialized arrow and pandas machinery on first
    use. Paying that once before the baseline keeps it out of the delta."""
    from datetime import date

    from domain.models.price import PriceBar

    bars = [
        PriceBar(
            ticker="WARM",
            date=date(2024, 1, offset + 1),
            open=1.0,
            high=2.0,
            low=0.5,
            close=1.5,
            volume=100,
        )
        for offset in range(_WARMUP_ROWS)
    ]
    data = bars_to_parquet_bytes(bars)
    parquet_bytes_to_panel(data)
    parquet_bytes_to_bars(data)


def measure(panel_path: Path, mode: str) -> dict[str, object]:
    _warm_up()
    data = panel_path.read_bytes()
    baseline = peak_rss_bytes()
    loaded = parquet_bytes_to_panel(data) if mode == "frame" else parquet_bytes_to_bars(data)
    peak = peak_rss_bytes() - baseline
    rows = len(loaded)
    return {
        "mode": mode,
        "rows": rows,
        "peak_bytes": peak,
        "bytes_per_row": round(peak / rows, 1) if rows else 0.0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", required=True, type=Path)
    parser.add_argument("--mode", required=True, choices=("frame", "bars"))
    args = parser.parse_args()
    print(json.dumps(measure(args.panel, args.mode)))


if __name__ == "__main__":
    main()
