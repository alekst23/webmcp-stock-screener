"""Nightly delta: add the latest trading day(s) to the stored panel.

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
from domain.models.price import PriceBar
from infra.panel_append import merge_panel_parquet
from infra.panel_io import panel_status_from_parquet

PANEL_KEY = "panel.parquet"

_SOURCE = "object-store"


def append_daily_delta(
    source: PriceSource,
    store: PanelStore,
    exchange: str,
    day: date,
    key: str = PANEL_KEY,
) -> PanelStatus:
    """Download the panel, append one exchange-day, re-upload."""
    return append_sessions(source, store, exchange, [day], key)


def append_sessions(
    source: PriceSource,
    store: PanelStore,
    exchange: str,
    days: list[date],
    key: str = PANEL_KEY,
) -> PanelStatus:
    """Append one or more sessions in chronological order, in a single pass.

    A catch-up over missed sessions is the same operation as a nightly run,
    not a special case: the sessions are fetched oldest-first and spliced in
    together, so several missed days cost one panel rewrite rather than one
    each.

    Idempotent by (ticker, date), so a retried cron run or a re-applied
    catch-up cannot duplicate rows. Sessions with no bars at all (a market
    holiday, or the job running before the provider publishes) leave the
    stored object untouched rather than rewriting it identically.
    """
    return _apply(source, store, exchange, sorted(days), _stored_panel(store, key), key)


def catch_up_sessions(
    source: PriceSource,
    store: PanelStore,
    exchange: str,
    through: date,
    key: str = PANEL_KEY,
) -> PanelStatus:
    """Append every session the panel is missing, up to and including
    `through`. The panel's own as-of date says where to resume, so a job that
    did not run for a week needs no record of which nights it missed."""
    existing = _stored_panel(store, key)
    as_of = panel_status_from_parquet(existing, source=_SOURCE).as_of
    return _apply(source, store, exchange, missing_sessions(as_of, through), existing, key)


def _stored_panel(store: PanelStore, key: str) -> bytes:
    if not store.object_exists(key):
        raise PanelStoreError(
            f"No panel at {key} to append to -- run scripts/backfill_panel.py first"
        )
    return store.get_object(key)


def _apply(
    source: PriceSource,
    store: PanelStore,
    exchange: str,
    days: list[date],
    existing: bytes,
    key: str,
) -> PanelStatus:
    incoming: list[PriceBar] = []
    for day in days:
        incoming.extend(source.fetch_exchange_day(exchange, day))
    if not incoming:
        return panel_status_from_parquet(existing, source=_SOURCE)
    merged, status = merge_panel_parquet(existing, incoming, source=_SOURCE)
    store.put_object(key, merged)
    return status


def missing_sessions(as_of: date, through: date) -> list[date]:
    """Every weekday strictly after `as_of` and not after `through`.

    Market holidays are not modelled: the provider returns no rows for one,
    and an empty session is already a no-op. Building a holiday calendar here
    would add a second source of truth for something the response answers.
    """
    days: list[date] = []
    day = as_of
    while day < through:
        day = date.fromordinal(day.toordinal() + 1)
        if day.weekday() < 5:
            days.append(day)
    return days


def latest_completed_trading_day(today: date) -> date:
    """The most recent weekday strictly before `today`.

    The nightly job runs after the US close but is scheduled in UTC, so
    "yesterday" is the day whose bars are actually published.
    """
    day = today
    while True:
        day = date.fromordinal(day.toordinal() - 1)
        if day.weekday() < 5:
            return day
