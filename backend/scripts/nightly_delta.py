"""Nightly delta job (T-0001-9 AC2) -- the Render Cron Job's entry point.

    uv run python scripts/nightly_delta.py

Downloads the stored panel, appends one bulk-by-exchange trading day, and
re-uploads it. One bulk call (~100 quota units), not one call per ticker.

Idempotent: re-running for the same day replaces those rows rather than
duplicating them (infra/panel_append.py), so a retried cron run or a manual
catch-up is safe.

    uv run python scripts/nightly_delta.py --catch-up

resumes from the panel's own as-of date instead, applying every session it is
missing in one rewrite -- the recovery path after a run of failed nights.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from application.append_daily_delta import (
    PANEL_KEY,
    append_daily_delta,
    catch_up_sessions,
    latest_completed_trading_day,
)
from domain.errors import PanelStoreError, PriceSourceError
from infra.eodhd_client import EodhdClient
from scripts._cli_env import require_api_key, require_panel_store

_DEFAULT_EXCHANGE = "US"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exchange", default=_DEFAULT_EXCHANGE)
    parser.add_argument(
        "--day",
        type=date.fromisoformat,
        default=None,
        help="Trading day to append (default: the most recent weekday)",
    )
    parser.add_argument("--key", default=PANEL_KEY)
    parser.add_argument(
        "--catch-up",
        action="store_true",
        help="Apply every session missing since the panel's as-of date, not just one",
    )
    args = parser.parse_args()

    # A universe demotion (application/append_daily_delta.py) is logged at
    # WARNING, not printed -- this is what makes it show up in the cron job's
    # captured output rather than only in a process that never configures
    # logging at all.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    api_key = require_api_key()
    store = require_panel_store()
    day = args.day or latest_completed_trading_day(date.today())
    client = EodhdClient(api_key)

    try:
        if args.catch_up:
            status = catch_up_sessions(client, store, args.exchange, day, key=args.key)
        else:
            status = append_daily_delta(client, store, args.exchange, day, key=args.key)
    except (PanelStoreError, PriceSourceError) as exc:
        # A cron job that exits 0 on failure is a silently stale dataset --
        # exactly what AC2's "kept current without manual intervention"
        # depends on not happening.
        sys.exit(f"Nightly delta failed for {args.exchange} on {day}: {exc}")

    print(
        f"Panel now holds {status.row_count} rows for {status.ticker_count} "
        f"tickers, as of {status.as_of} (appended {args.exchange} {day})."
    )


if __name__ == "__main__":
    main()
