"""Nightly delta: add the latest trading day(s) to the stored panel.

One bulk-by-exchange call per exchange per night (~100 quota units), rather
than one call per ticker -- the opposite endpoint choice from the backfill,
for the opposite reason. See docs/reference/data-provider.md.
"""

from __future__ import annotations

import logging
from datetime import date

from domain.contracts.panel_store import PanelStore
from domain.contracts.price_source import PriceSource
from domain.errors import PanelStoreError
from domain.models.panel import PanelStatus
from domain.models.price import PriceBar
from domain.models.universe import EligibilityRecord
from domain.trading_calendar import previous_weekday, sessions_between
from domain.universe_floor import diff_eligibility
from infra.panel_append import merge_panel_parquet
from infra.panel_io import panel_status_from_parquet, parquet_bytes_to_panel
from infra.universe_eligibility import (
    ELIGIBILITY_KEY,
    compute_eligible_universe,
    eligibility_from_csv,
    eligibility_to_csv,
)

PANEL_KEY = "panel.parquet"

_SOURCE = "object-store"

logger = logging.getLogger(__name__)


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
    eligibility_key: str = ELIGIBILITY_KEY,
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
    return _apply(
        source, store, exchange, sorted(days), _stored_panel(store, key), key, eligibility_key
    )


def catch_up_sessions(
    source: PriceSource,
    store: PanelStore,
    exchange: str,
    through: date,
    key: str = PANEL_KEY,
    eligibility_key: str = ELIGIBILITY_KEY,
) -> PanelStatus:
    """Append every session the panel is missing, up to and including
    `through`. The panel's own as-of date says where to resume, so a job that
    did not run for a week needs no record of which nights it missed."""
    existing = _stored_panel(store, key)
    as_of = panel_status_from_parquet(existing, source=_SOURCE).as_of
    return _apply(
        source, store, exchange, sessions_between(as_of, through), existing, key, eligibility_key
    )


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
    eligibility_key: str,
) -> PanelStatus:
    incoming: list[PriceBar] = []
    for day in days:
        incoming.extend(source.fetch_exchange_day(exchange, day))
    if not incoming:
        return panel_status_from_parquet(existing, source=_SOURCE)

    # Gate admission on the *previous* refresh's eligible set, not one
    # recomputed tonight -- tonight's bars are not yet in the panel, so a
    # same-night recompute would judge every ticker on an incomplete window.
    # A store with no eligibility object (never enforced, or a local/test
    # store) admits everything, matching today's behavior unmodified.
    eligible = _read_eligibility(store, eligibility_key)
    if eligible is not None:
        incoming = [bar for bar in incoming if bar.ticker in eligible]
        if not incoming:
            return panel_status_from_parquet(existing, source=_SOURCE)

    merged, status = merge_panel_parquet(existing, incoming, source=_SOURCE)
    store.put_object(key, merged)

    if eligible is not None:
        _refresh_eligibility(store, merged, status.as_of, set(eligible), eligibility_key)
    return status


def _read_eligibility(store: PanelStore, key: str) -> dict[str, EligibilityRecord] | None:
    if not store.object_exists(key):
        return None
    return eligibility_from_csv(store.get_object(key).decode("utf-8"))


def _refresh_eligibility(
    store: PanelStore,
    merged_panel: bytes,
    as_of: date,
    previous_tickers: set[str],
    eligibility_key: str,
) -> None:
    """Recompute the eligible set from the panel as it now stands (tonight's
    admitted bars included) and log any demotion by name -- AC4's "never
    silently". Costs one extra full-panel parse per nightly run; accepted,
    the enforced panel is small (~56 MB resident) relative to what a service
    boot already pays once."""
    current = compute_eligible_universe(parquet_bytes_to_panel(merged_panel), as_of=as_of)
    _promoted, demoted = diff_eligibility(previous_tickers, set(current))
    if demoted:
        logger.warning(
            "universe demotion: %d ticker(s) fell below the enforced floor and will stop "
            "receiving new bars: %s",
            len(demoted),
            sorted(demoted),
        )
    store.put_object(eligibility_key, eligibility_to_csv(current).encode("utf-8"))


def latest_completed_trading_day(today: date) -> date:
    """The most recent weekday strictly before `today`.

    The nightly job runs after the US close but is scheduled in UTC, so
    "yesterday" is the day whose bars are actually published.
    """
    return previous_weekday(today)
