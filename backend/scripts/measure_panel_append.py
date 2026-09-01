"""Measure what appending one session to the panel costs.

T-1016-2's claim is that the *work of applying a session* tracks the session,
not the panel it lands on. Re-serializing the panel is not part of that
claim: `PanelStore.put_object` takes bytes, so a single-object store rewrites
the whole panel however clever the merge is. `--mode copy` measures exactly
that floor -- the same code path with an empty session -- so the session's
own cost can be read off as the difference.

    uv run python scripts/measure_panel_append.py --panel PANEL --mode merge
    uv run python scripts/measure_panel_append.py --panel PANEL --mode copy
    uv run python scripts/measure_panel_append.py --panel PANEL --mode rows

`merge` is the streaming splice, `copy` its empty-session floor, and `rows`
the row-object dict merge it replaced -- kept runnable so the comparison
stays reproducible rather than historical.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from domain.models.price import PriceBar  # noqa: E402
from infra.panel_append import merge_panel_parquet  # noqa: E402
from infra.panel_io import (  # noqa: E402
    EPOCH_ORDINAL,
    bars_to_parquet_bytes,
    parquet_bytes_to_bars,
)
from scripts.measure_panel_memory import peak_rss_bytes  # noqa: E402


def _next_session(panel_path: Path) -> tuple[list[str], date]:
    """One bar per ticker, on the day after the panel's last -- the shape of a
    real bulk-by-exchange session. Derived by scanning two columns a batch at
    a time, so building the fixture does not itself cost the panel."""
    reader = pq.ParquetFile(panel_path)
    tickers: set[str] = set()
    last = 0
    for batch in reader.iter_batches(batch_size=64_000, columns=["ticker", "date"]):
        tickers.update(np.asarray(batch.column("ticker").to_numpy(zero_copy_only=False)).tolist())
        days = np.asarray(batch.column("date").cast(pa.int32()).to_numpy(zero_copy_only=False))
        last = max(last, int(days.max()))
    return sorted(tickers), date.fromordinal(last + EPOCH_ORDINAL + 1)


def _session_bars(tickers: list[str], day: date) -> list[PriceBar]:
    return [
        PriceBar(ticker=ticker, date=day, open=9.0, high=11.0, low=8.0, close=10.0, volume=1_000)
        for ticker in tickers
    ]


def _row_object_merge(existing: bytes, incoming: list[PriceBar]) -> bytes:
    """The pre-T-1016-2 append: every panel row as an object, keyed by
    (ticker, date). Kept here only as the measurement baseline."""
    by_key = {(bar.ticker, bar.date): bar for bar in parquet_bytes_to_bars(existing)}
    by_key.update({(bar.ticker, bar.date): bar for bar in incoming})
    return bars_to_parquet_bytes(list(by_key.values()))


def measure(panel_path: Path, mode: str) -> dict[str, object]:
    tickers, day = _next_session(panel_path)
    session = [] if mode == "copy" else _session_bars(tickers, day)
    existing = panel_path.read_bytes()
    baseline = peak_rss_bytes()
    started = time.perf_counter()
    if mode == "rows":
        merged = _row_object_merge(existing, session)
    else:
        merged, _ = merge_panel_parquet(existing, session, source="measurement")
    elapsed = time.perf_counter() - started
    peak = peak_rss_bytes() - baseline
    return {
        "mode": mode,
        "panel_bytes": len(existing),
        "output_bytes": len(merged),
        "session_rows": len(session),
        "peak_bytes": peak,
        "seconds": round(elapsed, 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", required=True, type=Path)
    parser.add_argument("--mode", required=True, choices=("merge", "copy", "rows"))
    args = parser.parse_args()
    print(json.dumps(measure(args.panel, args.mode)))


if __name__ == "__main__":
    main()
