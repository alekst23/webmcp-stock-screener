# T-1016-2: Delta-proportional, idempotent panel append

**Epic**: EPIC-1016 (Market Data Storage)
**Status**: Complete
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

## Implementation Plan

`infra/panel_append.merge_panel_parquet()` replaces `merge_bars`. The panel is
already sorted by `(ticker, date)` and so is the delta, so the two are merged
in one streaming pass: read the panel a batch at a time, binary-search each
batch for the delta rows that belong in it, splice them in (replacing on a
collision, inserting otherwise), write the batch straight back out. The only
index is the delta itself.

Three decisions worth arguing with:

* **Fixed-size output row groups.** Without them a re-applied session
  produces a panel that is equal but not byte-identical, because the second
  pass sees different batch boundaries than the first. AC2 asks for
  byte-identity, and byte-identity is also what makes "did the nightly job
  change anything?" answerable.
* **The summary is accumulated while streaming.** Describing the merged panel
  by reading it back would undo the point.
* **`io.BytesIO` rather than `pa.BufferOutputStream`** for the sink --
  measured at ~60 MB less peak on a 1.2M-row panel, because CPython's buffer
  often grows in place where arrow's copies.

`application/append_daily_delta.py` gains `append_sessions` (several sessions,
one rewrite) and `catch_up_sessions` (resume from the panel's own as-of date),
with `--catch-up` on `scripts/nightly_delta.py`. `append_daily_delta` keeps
its signature and is now a one-session call into the same path.

## Measurements (AC1)

`scripts/measure_panel_append.py`, peak RSS of a fresh process appending one
session (one bar per ticker) to a stored panel. `copy` is the same code path
with an empty session -- the floor `PanelStore.put_object(bytes)` imposes on
any single-object store:

| panel | mode | peak RSS | seconds |
|---|---|---|---|
| 120k rows / 4.9 MB | merge | 49.8 MB | 0.06 |
| 120k rows / 4.9 MB | copy | 40.9 MB | 0.06 |
| 120k rows / 4.9 MB | rows (old) | 253.8 MB | 0.46 |
| 1.2M rows / 40.8 MB | merge | 132.1 MB | 0.56 |
| 1.2M rows / 40.8 MB | copy | 133.2 MB | 0.52 |
| 1.2M rows / 40.8 MB | rows (old) | 2,252.1 MB | 5.58 |

(Re-measured after T-1016-3 settled the row-group size at 25,000 rows, which
also cost the merge ~40 MB less peak on the larger panel.)

Two readings across the 10x panel step:

* The session's own cost -- merge minus copy -- is **8.9 MB and ~0 MB**: flat
  while the panel grew 10x and the session grew 10x with it. (The larger
  panel's difference falls inside measurement noise, which is the point.)
* Peak per byte of stored panel, at the margin, is **1.9x** against **~51x**
  for the row-object merge. Wall time is 10x lower.

**Known limit, deliberately not hidden by the metric.** The rewrite itself is
still O(panel): `PanelStore.put_object` takes `bytes`, so the whole panel is
re-serialized whatever the merge does. That is the `copy` row above, and at
the ~5M-row target it is the term that matters. Removing it needs either
per-partition writes (T-1016-3) or a streaming upload through the store
contract -- neither is this ticket. What this ticket removes is the ~50x
constant on top of it.

## Verification

- `tests/functional/test_panel_append.py` — AC2 (byte-identity across a panel
  sized past both the 64k merge batch and the 100k row group, plus
  replacement and within-delta deduplication), AC3 (ordered catch-up in one
  rewrite; resume from the panel's as-of date), AC4 (an unknown ticker lands
  in sorted position), AC5 (the panel stays sorted and `PanelFrame` still
  finds the spliced rows).
- `tests/performance/test_panel_append_memory.py` — AC1.

Mutation-checked: reverting to the dict merge fails both performance tests;
emitting variable-size row groups fails byte-identity; skipping the collision
drop, the delta deduplication, the session ordering, or the as-of-based
resume each fails exactly the test that targets it.
