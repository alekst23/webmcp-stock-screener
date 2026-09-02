"""One-time real-data backfill (T-0001-9 AC1).

Costs one paid EODHD call per ticker. Run it deliberately:

    export EODHD_API_KEY=...        # paid EOD Historical Data plan
    uv run python scripts/backfill_panel.py --from 2016-01-01

Universe scope and history length are flags, not code, because they trade off
directly against the web service's memory ceiling (see infra/panel_frame.py):
roughly 26 bytes per ticker-day, so tickers x trading-days x 26 has to fit
inside the Render plan the API runs on. `--dry-run` prints that projection
without spending a single call.

Universe sources, in precedence order:
  --tickers-file    an explicit newline-separated list (rehearsal runs)
  --exchanges       EODHD's exchange symbol list, filtered to real listings
                    (default NASDAQ,NYSE,AMEX -- everything else on the "US"
                    exchange is OTC tiers)
  --from-metadata   the tickers in the stored Nasdaq screener metadata

Writes the same PriceBar/Parquet shape scripts/generate_mock_panel.py
produces, so nothing downstream changes when the real panel replaces the
mock one.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from application.backfill_panel import PANEL_KEY, backfill_panel
from application.load_panel import UNIVERSE_KEY
from domain.contracts.panel_store import PanelStore
from infra.eodhd_client import EodhdClient
from infra.nasdaq_screener import universe_from_csv
from scripts._cli_env import require_api_key, require_panel_store

# EODHD addresses US listings as SYMBOL.US; the panel stores the bare symbol.
_US_SUFFIX = ".US"

_DEFAULT_FROM = date(2016, 1, 1)
_DEFAULT_EXCHANGES = "NASDAQ,NYSE,AMEX"

# infra/panel_frame.py's measured per-row cost, for the --dry-run projection.
_BYTES_PER_ROW = 26
_TRADING_DAYS_PER_YEAR = 252


def _resolve_tickers(client: EodhdClient, store: PanelStore, args: argparse.Namespace) -> list[str]:
    if args.tickers_file is not None:
        names = [line.strip().upper() for line in args.tickers_file.read_text().splitlines()]
        return [name for name in names if name and not name.startswith("#")]
    if args.from_metadata:
        if not store.object_exists(args.universe_key):
            sys.exit(
                f"No universe metadata at {args.universe_key}. Run "
                "`uv run python scripts/load_universe_metadata.py <screener.csv>` "
                "first, or drop --from-metadata to use the exchange symbol list."
            )
        return sorted(universe_from_csv(store.get_object(args.universe_key).decode("utf-8")))
    exchanges = [name.strip() for name in args.exchanges.split(",") if name.strip()]
    return client.fetch_symbols(exchange=args.symbol_list, exchanges=exchanges)


def _projection(tickers: int, from_date: date, to_date: date) -> str:
    years = max((to_date - from_date).days / 365.25, 0.0)
    rows = int(tickers * years * _TRADING_DAYS_PER_YEAR)
    return (
        f"{tickers} tickers x ~{years:.1f}y ~= {rows:,} ticker-days "
        f"~= {rows * _BYTES_PER_ROW / 1e6:,.0f} MB resident, {tickers} API calls"
    )


def _progress(ticker: str, index: int, total: int) -> None:
    # Every 100th line only: a several-thousand-ticker run should leave a
    # readable log, not thousands of lines of scrollback.
    if index % 100 == 0 or index == total:
        print(f"  {index}/{total} tickers fetched (latest: {ticker})", flush=True)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="from_date", type=date.fromisoformat, default=_DEFAULT_FROM)
    parser.add_argument("--to", dest="to_date", type=date.fromisoformat, default=None)
    parser.add_argument("--tickers-file", type=Path, default=None)
    parser.add_argument(
        "--exchanges",
        default=_DEFAULT_EXCHANGES,
        help=f"Comma-separated listing venues to include (default: {_DEFAULT_EXCHANGES})",
    )
    parser.add_argument(
        "--symbol-list",
        default="US",
        help="EODHD exchange code whose symbol list is enumerated (default: US)",
    )
    parser.add_argument(
        "--from-metadata",
        action="store_true",
        help="Take the ticker list from the stored screener metadata instead",
    )
    parser.add_argument("--limit", type=int, default=None, help="Cap the ticker count")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve the universe and print the size projection without fetching",
    )
    parser.add_argument("--universe-key", default=UNIVERSE_KEY)
    parser.add_argument("--key", default=PANEL_KEY, help="Object key for the panel")
    parser.add_argument(
        "--no-enforce-floor",
        action="store_true",
        help=(
            "Skip the enforced universe floor (docs/plan/EPIC-0016/"
            "T-0016-13-universe-enforcement.md) -- for deliberate rehearsal runs "
            "against a small --tickers-file that could never clear it. Real "
            "production backfills should keep the floor on (the default)."
        ),
    )
    return parser


def main() -> None:
    args = _build_parser().parse_args()

    client = EodhdClient(require_api_key())
    store = require_panel_store()
    tickers = _resolve_tickers(client, store, args)
    if args.limit is not None:
        tickers = tickers[: args.limit]
    if not tickers:
        sys.exit("Resolved an empty ticker list -- nothing to back fill.")

    to_date = args.to_date or date.today()
    print(f"Universe: {_projection(len(tickers), args.from_date, to_date)}")
    if args.dry_run:
        print("Dry run -- no data fetched, no panel written.")
        return

    print(f"Backfilling {args.from_date} .. {to_date}...")
    status = backfill_panel(
        client,
        store,
        [f"{ticker}{_US_SUFFIX}" for ticker in tickers],
        from_date=args.from_date,
        to_date=to_date,
        key=args.key,
        on_progress=_progress,
        enforce_floor=not args.no_enforce_floor,
    )
    print(
        f"Wrote {status.row_count} rows for {status.ticker_count} tickers to "
        f"{args.key} ({status.first_date} .. {status.as_of})."
    )


if __name__ == "__main__":
    main()
