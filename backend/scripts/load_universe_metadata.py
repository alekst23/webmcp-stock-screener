"""Upload a Nasdaq screener CSV export as the universe metadata (AC3).

Download the export from
https://www.nasdaq.com/market-activity/stocks/screener (free, no account),
then:

    uv run python scripts/load_universe_metadata.py ~/Downloads/nasdaq_screener.csv

The parsed form is what gets stored, not the raw export, so a change to the
screener's column names can only ever break this script -- never the running
API (see infra/nasdaq_screener.py).
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from application.load_panel import UNIVERSE_KEY
from infra.nasdaq_screener import parse_screener_csv, universe_to_csv
from scripts._cli_env import require_panel_store


def _default_as_of(path: Path) -> date:
    """The export's own download date, taken from the file's mtime -- closer
    to the truth than today's date for a CSV pulled last month."""
    return datetime.fromtimestamp(path.stat().st_mtime).date()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path, help="Nasdaq screener CSV export")
    parser.add_argument(
        "--as-of",
        type=date.fromisoformat,
        default=None,
        help="Date the export reflects (default: the file's modification date)",
    )
    parser.add_argument("--key", default=UNIVERSE_KEY, help="Object key to write")
    args = parser.parse_args()

    if not args.csv_path.exists():
        sys.exit(f"No such file: {args.csv_path}")

    store = require_panel_store()
    as_of = args.as_of or _default_as_of(args.csv_path)
    universe = parse_screener_csv(args.csv_path.read_text(encoding="utf-8-sig"), as_of)
    if not universe:
        sys.exit(f"{args.csv_path} parsed to zero tickers -- is it a screener export?")

    store.put_object(args.key, universe_to_csv(universe).encode("utf-8"))
    with_sector = sum(1 for meta in universe.values() if meta.sector)
    with_cap = sum(1 for meta in universe.values() if meta.market_cap is not None)
    print(
        f"Wrote {len(universe)} tickers to {args.key} as of {as_of} "
        f"({with_sector} with a sector, {with_cap} with a market cap)."
    )


if __name__ == "__main__":
    main()
