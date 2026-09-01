# T-1016-2: Delta-proportional, idempotent panel append

**Epic**: EPIC-1016 (Market Data Storage)
**Status**: Open
**Depends on**: T-1016-1
**Blocks**: T-1016-4
**Issue**: #13
**Design**: docs/design/market-data-storage/

## Description

`merge_bars()` builds a `(ticker, date)`-keyed dict across the entire panel
to append a single trading day — roughly 6k rows onto ~12M. On top of the
row-object cost that is ~1.4 GB of index to do a day's work.

Rework the append so its cost tracks the delta, while preserving exactly the
guarantee the dict was written for: re-applying a session leaves one row per
ticker-day, never a duplicate. That idempotency is not incidental — a
duplicated row silently shifts every rolling window in the engine.

## User Story

As the nightly cron job,
I want appending one session to cost one session's work,
so that keeping the panel current does not get more expensive every night.

## Acceptance Criteria

1. Appending a session to a panel costs work and memory proportional to the
   session, not to the accumulated panel. Demonstrated by measurement across
   at least two panel sizes an order of magnitude apart.
2. Applying the same session twice leaves the panel byte-identical to
   applying it once — one row per `(ticker, date)`, incoming row winning.
3. A catch-up spanning several missed sessions applies every missing session
   in order, and the panel's as-of date reflects the newest.
4. A delta containing a ticker absent from the panel adds that ticker rather
   than failing or silently dropping it.
5. Panel ordering invariants the engine relies on hold after any append.

## Out of Scope

Scheduling and cron wiring (already in `render.yaml` from T-1001-9).
