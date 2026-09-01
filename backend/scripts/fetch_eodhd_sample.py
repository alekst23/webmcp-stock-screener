"""Pull a handful of real tickers from EODHD's free tier and check their
field shape against the `PriceBar` schema the mock generator already
produces (T-0001-1, AC3).

This is a one-off sanity script, not a pipeline — the real paid backfill
and nightly delta live in `infra/eodhd_client.py` plus
`scripts/backfill_panel.py` / `scripts/nightly_delta.py` (T-0001-9). It
exists to catch schema drift *before* the real pipeline becomes
load-bearing: field names, date handling, and — the one that actually
differs — split/dividend adjustment convention.

The row mapping itself now lives in `infra/eodhd_client.py`, since the real
pipeline and this check must never disagree about it; this module re-exports
it so the check and its test keep one import path.

Run directly (needs a free EODHD_API_KEY — see backend/.env.example):
    uv run python scripts/fetch_eodhd_sample.py
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests

from domain.models.price import PriceBar
from infra.eodhd_client import eodhd_row_to_price_bar

EODHD_BASE_URL = "https://eodhd.com/api/eod"
SAMPLE_TICKERS = ["AAPL.US", "MSFT.US", "AMZN.US"]


def fetch_eod_history(ticker: str, api_key: str, from_date: date) -> list[dict]:
    """One call to EODHD's per-ticker range endpoint. Free tier covers
    roughly the trailing year, enough to check field shapes without
    touching the paid plan."""
    response = requests.get(
        f"{EODHD_BASE_URL}/{ticker}",
        params={"api_token": api_key, "fmt": "json", "period": "d", "from": from_date.isoformat()},
        timeout=10,
    )
    response.raise_for_status()
    rows: list[dict] = response.json()
    return rows


def check_sample(tickers: list[str], api_key: str) -> list[PriceBar]:
    """Fetch and map a small sample; raising here (via Pydantic validation
    inside eodhd_row_to_price_bar) is the schema-conformance signal —
    a field-shape mismatch fails loudly instead of silently mis-mapping."""
    from_date = date.today() - timedelta(days=60)
    bars: list[PriceBar] = []
    for ticker in tickers:
        rows = fetch_eod_history(ticker, api_key, from_date)
        bars.extend(eodhd_row_to_price_bar(ticker, row) for row in rows)
    return bars


if __name__ == "__main__":
    key = os.environ.get("EODHD_API_KEY", "").strip()
    if not key:
        print(
            "EODHD_API_KEY not set (see backend/.env.example — free signup, "
            "no card required). Skipping real-data schema check."
        )
        sys.exit(0)

    sample_bars = check_sample(SAMPLE_TICKERS, key)
    print(
        f"Fetched and mapped {len(sample_bars)} real EOD rows for "
        f"{len(SAMPLE_TICKERS)} tickers — all conform to PriceBar."
    )
