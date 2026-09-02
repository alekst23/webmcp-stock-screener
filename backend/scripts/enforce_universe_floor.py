"""Filter the stored panel to the enforced universe floor -- no EODHD calls.

    uv run python scripts/enforce_universe_floor.py            # dry run, reports only
    uv run python scripts/enforce_universe_floor.py --apply    # writes

This is both the one-time correction for the 50,565-ticker panel
(docs/reference/universe-scope-analysis.md) and the recurring tool for a
periodic, deliberate universe re-scope (see
docs/plan/EPIC-0016/T-0016-13-universe-enforcement.md's promotion-policy
section for why growing the universe is an explicit action, not an
automatic nightly one). It reads the *existing* stored panel, measures every
resident ticker against the enforced floor
(domain/universe_floor.py, infra/universe_eligibility.py), and writes back
only what clears it. Nothing here calls the price-data provider.

Defaults to a dry run: the projected survivor/row counts are reported, and
nothing is written, until `--apply` is passed explicitly -- this script's
whole job is to overwrite the production panel object, and the bucket being
versioned is a rollback path, not a reason to skip caution.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from application.backfill_panel import PANEL_KEY
from application.load_panel import UNIVERSE_KEY
from infra.nasdaq_screener import universe_from_csv, universe_to_csv
from infra.object_store import S3PanelStore
from infra.panel_io import (
    panel_frame_to_wire_bytes,
    panel_status_from_frame,
    parquet_bytes_to_panel,
)
from infra.universe_eligibility import (
    ELIGIBILITY_KEY,
    compute_eligible_universe,
    eligibility_to_csv,
)
from scripts._cli_env import require_panel_store


def _report(label: str, tickers: int, rows: int) -> None:
    print(f"{label}: {tickers:,} tickers, {rows:,} rows")


def _rewrite_universe_metadata(store: S3PanelStore, survivors: set[str]) -> None:
    """Trim the Nasdaq-screener metadata object to the same tickers the
    rebuilt panel now holds, so the two objects describe one universe
    instead of drifting apart. Optional: a bucket with no universe.csv yet
    is left alone."""
    if not store.object_exists(UNIVERSE_KEY):
        return
    metadata = universe_from_csv(store.get_object(UNIVERSE_KEY).decode("utf-8"))
    trimmed = {ticker: meta for ticker, meta in metadata.items() if ticker in survivors}
    store.put_object(UNIVERSE_KEY, universe_to_csv(trimmed).encode("utf-8"))
    print(f"universe.csv trimmed: {len(metadata):,} -> {len(trimmed):,} entries")


def _verify(store: S3PanelStore, key: str) -> None:
    """Read the just-written panel back through the normal S3PanelStore
    code path -- the same one production reads through -- rather than
    trusting the bytes this process already holds."""
    data = store.get_object(key)
    frame = parquet_bytes_to_panel(data)
    status = panel_status_from_frame(frame, source="object-store")
    resident_bytes = int(frame.memory_usage(deep=True).sum())
    print("--- verified read-back ---")
    print(f"ticker_count: {status.ticker_count:,}")
    print(f"row_count: {status.row_count:,}")
    print(f"as_of: {status.as_of}")
    print(f"resident_bytes: {resident_bytes:,}")
    print(f"resident_bytes_per_row: {resident_bytes / status.row_count:.2f}")
    print(f"ticker code dtype: {frame['ticker'].cat.codes.dtype}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key", default=PANEL_KEY)
    parser.add_argument("--universe-key", default=UNIVERSE_KEY)
    parser.add_argument("--eligibility-key", default=ELIGIBILITY_KEY)
    parser.add_argument("--apply", action="store_true", help="Write; default is a dry-run report.")
    args = parser.parse_args()

    store = require_panel_store()
    previous_version = store.object_version(args.key)
    print(f"current S3 VersionId for {args.key} (rollback target): {previous_version}")

    existing = store.get_object(args.key)
    frame = parquet_bytes_to_panel(existing)
    _report("current panel", int(frame["ticker"].nunique()), len(frame))

    as_of = date.fromordinal(int(frame["date"].max()))
    eligible = compute_eligible_universe(frame, as_of=as_of)
    filtered = frame[frame["ticker"].isin(eligible)]
    _report("enforced-floor panel", len(eligible), len(filtered))

    if not args.apply:
        print("Dry run -- no write. Pass --apply to write.")
        return

    store.put_object(args.key, panel_frame_to_wire_bytes(filtered))
    store.put_object(args.eligibility_key, eligibility_to_csv(eligible).encode("utf-8"))
    _rewrite_universe_metadata(store, set(eligible))

    new_version = store.object_version(args.key)
    print(f"new S3 VersionId for {args.key}: {new_version}")
    _verify(store, args.key)


if __name__ == "__main__":
    main()
