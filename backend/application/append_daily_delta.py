"""Nightly delta: add the latest trading day to the stored panel.

One bulk-by-exchange call per exchange per night (~100 quota units), rather
than one call per ticker -- the opposite endpoint choice from the backfill,
for the opposite reason. See docs/reference/data-provider.md.
"""

from __future__ import annotations

from datetime import date

from domain.contracts.panel_store import PanelStore
from domain.contracts.price_source import PriceSource
from domain.errors import PanelStoreError
from domain.models.panel import PanelStatus
from infra.panel_io import (
    bars_to_parquet_bytes,
    merge_bars,
    panel_status,
    parquet_bytes_to_bars,
)

PANEL_KEY = "panel.parquet"


def append_daily_delta(
    source: PriceSource,
    store: PanelStore,
    exchange: str,
    day: date,
    key: str = PANEL_KEY,
) -> PanelStatus:
    """Download the panel, append one exchange-day, re-upload.

    Idempotent by (ticker, date) via merge_bars, so a retried cron run or a
    manual catch-up cannot duplicate rows. A day with no bars (a market
    holiday, or the job running before the provider publishes) leaves the
    stored object untouched rather than rewriting it identically.
    """
    if not store.object_exists(key):
        raise PanelStoreError(
            f"No panel at {key} to append to -- run scripts/backfill_panel.py first"
        )
    existing = parquet_bytes_to_bars(store.get_object(key))
    incoming = source.fetch_exchange_day(exchange, day)
    if not incoming:
        return panel_status(existing, source="object-store")
    merged = merge_bars(existing, incoming)
    store.put_object(key, bars_to_parquet_bytes(merged))
    return panel_status(merged, source="object-store")


def latest_completed_trading_day(today: date) -> date:
    """The most recent weekday strictly before `today`.

    The nightly job runs after the US close but is scheduled in UTC, so
    "yesterday" is the day whose bars are actually published. Market holidays
    are not modelled: the provider simply returns no rows for one, and
    `append_daily_delta` treats an empty response as a no-op. Building a real
    holiday calendar here would add a second source of truth for something
    the response already answers.
    """
    day = today
    while True:
        day = date.fromordinal(day.toordinal() - 1)
        if day.weekday() < 5:
            return day
