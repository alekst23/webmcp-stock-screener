"""Pull a handful of real tickers from EODHD's free tier and check their
field shape against the `PriceBar` schema the mock generator already
produces (T-1001-1, AC3).

This is a one-off sanity script, not a pipeline — the real paid backfill
and nightly delta are T-1001-9's concern. It exists to catch schema drift
*before* the real pipeline becomes load-bearing: field names, date
handling, and — the one that actually differs — split/dividend adjustment
convention.

EODHD's per-ticker EOD endpoint returns `close` (the raw historical print)
and a separate `adjusted_close` (back-adjusted for splits/dividends as of
today); it does NOT return adjusted open/high/low directly. Our PriceBar
contract commits every OHLC field to the adjusted basis, so
`eodhd_row_to_price_bar` scales open/high/low by the same
adjusted_close/close ratio that produced the adjusted close — take
`close` directly and O/H/L would be on a different price basis than C,
silently corrupting any bar that spans a split or ex-dividend date.

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
    return response.json()


def eodhd_row_to_price_bar(ticker: str, row: dict) -> PriceBar:
    """Map one EODHD EOD row onto our adjusted-OHLCV PriceBar contract.

    `close` -> adjusted_close directly. `open`/`high`/`low` are raw
    (unadjusted) in EODHD's response, so they're scaled by the same
    factor that turns `close` into `adjusted_close` — the split/dividend
    adjustment convention mismatch this script exists to catch.
    """
    adjustment_factor = row["adjusted_close"] / row["close"] if row["close"] else 1.0
    return PriceBar(
        ticker=ticker,
        date=date.fromisoformat(row["date"]),
        open=round(row["open"] * adjustment_factor, 4),
        high=round(row["high"] * adjustment_factor, 4),
        low=round(row["low"] * adjustment_factor, 4),
        close=round(row["adjusted_close"], 4),
        volume=int(row["volume"]),
    )


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
