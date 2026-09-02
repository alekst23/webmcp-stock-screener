# T-0016-13: Universe enforcement

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: In Progress
**Depends on**: T-0016-7, T-0016-8, T-0016-9, T-0016-12 (the analysis and the
production panel this ticket corrects)
**Blocks**: —
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Description

`docs/reference/universe-scope-analysis.md` measured the production panel
and found it holds 50,565 tickers / 2,420,825 rows -- 96% of those tickers
carry fewer than 5 rows of history. The mechanism is understood and
unfixed: `universe.csv` is metadata-only (sector/market-cap for
`TickerMetadata`) and has never gated panel content, and the nightly delta
(`application/append_daily_delta.py`) appends every bar the bulk-by-exchange
endpoint returns for the whole US exchange, unconditionally. That is what
produced the 50,565-ticker panel from a 1,999-ticker starting point, and it
will do so again on the next nightly run regardless of what floor is chosen,
unless the floor is enforced in code, not just decided on paper.

The user chose the floor: **median 60-session dollar volume >= $25,000,000,
last close >= $1, >= 252 sessions (1 year) of history** -- the tight end of
the analysis's candidate range, accepted deliberately for cleaner pattern
base rates over a larger research surface.

Done looks like: the floor enforced at both places the analysis identified
(ingest and the nightly delta), the production panel rebuilt to the chosen
universe from its own existing bytes (no EODHD calls), and the container's
real memory peak measured against the rebuilt panel rather than
extrapolated.

## User Story

As the person operating this screener,
I want the universe floor enforced in the pipeline that builds and updates
the panel, not just decided in an analysis document,
so that the 50,565-ticker accident cannot recur on the next nightly run, and
so that a ticker crossing the floor in either direction is a recorded,
observable event rather than silent churn in the base rates a pattern search
reports.

## Acceptance Criteria

1. `backend/application/backfill_panel.py` can filter a fresh backfill to
   only tickers whose fetched history clears the floor before
   `panel.parquet` is written, and the real production ingest script opts
   into this by default.
2. `backend/application/append_daily_delta.py` never admits a bar for a
   ticker outside the currently eligible set into the stored panel, when an
   eligible-set object is present in the store; a store with no eligibility
   object degrades to today's unfiltered behavior (matches the existing
   `universe.csv` metadata fallback precedent), so every existing test and
   local checkout keeps working unmodified.
3. The eligible-ticker set is stored as data (a versioned object alongside
   the panel), not a hardcoded constant, and is refreshed by the nightly
   delta from the panel's own trailing history after each night's merge.
4. A ticker whose refreshed stats fall below the floor stops receiving new
   bars on the next nightly run (its already-written historical rows are
   not retroactively deleted), and the event is logged by ticker and count
   -- it must never happen silently.
5. A ticker crossing back above the floor is only re-admitted through an
   explicit, operator-triggered re-scope, not an automatic nightly action --
   documented and justified in Solution Approach, not merely asserted.
6. The production panel is rebuilt from its own existing bytes (no EODHD
   calls) to exactly the combined floor (dollar volume + price + history),
   with the exact survivor ticker and row counts reported.
7. Before the production object is overwritten, its current S3 version ID
   is recorded as the rollback target.
8. The rebuilt panel is verified by reading it back through the normal
   `S3PanelStore` code path on the default credential chain: ticker count,
   row count, as_of, resident size, and resident bytes/row are all reported.
9. Container memory is re-measured on the deployed image against the
   rebuilt panel, using T-0016-9's exact method (`--memory=2g
   --memory-swap=2g --cpus=1`), for both the realistic 3-step/4-study
   pattern and the broad unfiltered pattern, reported as absolute RSS with
   no baseline subtraction plus headroom against 2 GB -- measured, not
   extrapolated, even where it disagrees with T-0016-9's extrapolation.
10. New tests cover ingest floor enforcement, nightly-delta gating, and the
    promotion/demotion policy; each is shown to fail without the
    corresponding fix (mutation-check evidence); the backend test suite
    does not regress below its 123 passed / 5 skipped baseline.

## Design References

- `docs/reference/universe-scope-analysis.md` -- section 7 ("Enforcement
  gap") is this ticket's starting brief; sections 2 and 4 are the survivor
  counts this ticket's rebuild is checked against
- `backend/scripts/analyze_universe_scope.py` -- `recent_window_dollar_volume`'s
  windowing (market-wide most-recent-60-session-dates, not per-ticker) is
  reused rather than reimplemented, see Solution Approach
- `docs/plan/EPIC-0016/T-0016-9-verify-container-memory.md` -- the container
  memory method this ticket's re-measurement reuses unchanged
- `backend/application/backfill_panel.py`, `backend/application/append_daily_delta.py`,
  `backend/infra/panel_append.py`, `backend/infra/panel_io.py`,
  `backend/infra/panel_frame.py`, `backend/infra/object_store.py` -- the
  pipeline this ticket adds a gate to, without changing the panel's wire
  format or the engine's public surface
- `backend/domain/panel_disclosure.py` -- the pattern this ticket's
  `domain/universe_floor.py` mirrors: pure policy (thresholds, a pure
  eligibility predicate) separate from the infra that computes the inputs
  from a pandas frame
- `docs/plan/EPIC-0016/T-0016-12-no-synthetic-in-prod.md` -- the precedent
  for a new branch in existing production code shipping default-off so
  every existing test keeps passing unmodified, which AC2's fallback
  mirrors

## Solution Approach

### Where the eligible-ticker list lives, and why not `universe.csv`

`universe.csv` already exists and is already read at startup, but it holds
Nasdaq-screener-sourced `TickerMetadata` (sector, market cap) -- a different
data source, a different refresh cadence, and a different consumer
(`minMarketCap`/`sectors` filtering) than a liquidity floor computed from
the panel's own trailing dollar volume. Overloading it would either bend
`TickerMetadata` to carry unrelated computed fields or make "presence in
`universe.csv`" silently mean two different things depending on which code
path asks. A new object, `universe_eligibility.csv`
(`infra/universe_eligibility.py::ELIGIBILITY_KEY`), stored alongside
`panel.parquet` in the same bucket, keeps the two concerns separate:
ticker, `median_dollar_volume`, `last_close`, `history_sessions`, `as_of`.
When the production panel is rebuilt (AC6), `universe.csv` is *also*
trimmed to the surviving tickers so the bucket's two objects describe the
same universe rather than drifting apart -- but that is bucket hygiene, not
the enforcement mechanism itself.

### Layering: policy in `domain/`, mechanics in `infra/`

`domain/universe_floor.py` (mirrors `domain/panel_disclosure.py`) holds the
three threshold constants and `passes_floor(median_dollar_volume, last_close,
history_sessions) -> bool` -- pure, no pandas, no I/O, so the *rule* is
unit-testable in isolation from how its inputs are computed.
`infra/universe_eligibility.py` holds `compute_eligible_universe(frame,
as_of)`, which reuses the exact windowing
`scripts/analyze_universe_scope.py::recent_window_dollar_volume` already
uses (a market-wide window of the panel's most recent 60 distinct session
dates, not a per-ticker trailing window, so a stale ticker with no rows in
the window reports no volume there rather than a median from years-old
activity) -- and CSV read/write for the eligibility object, matching
`infra/nasdaq_screener.py`'s `universe_to_csv`/`universe_from_csv` shape.

### Ingest (AC1)

`backfill_panel()` gains `enforce_floor: bool = False`. Default off, for
the same reason T-0016-12's `REQUIRE_REAL_PANEL` defaults off: existing
callers (schema-conformance tests using 2-6 row fixtures that could never
clear a 252-session floor) keep passing with zero edits. The real ingest
script, `scripts/backfill_panel.py`, passes `enforce_floor=True` by default
with a `--no-enforce-floor` escape hatch for deliberate rehearsal runs
(mirrors its existing `--dry-run`). When enabled: after every ticker's bars
are fetched, `compute_eligible_universe` runs once against the whole fetched
set, bars for non-surviving tickers are dropped before
`bars_to_parquet_bytes`, and the eligibility object is written alongside
the panel in the same call.

### Nightly delta (AC2-AC5) -- the ordering that matters

The bulk endpoint still returns the whole exchange every night (unchanged
-- one call, ~100 quota units); what changes is what gets merged.
`_apply()` in `append_daily_delta.py`:

1. Reads the *currently stored* eligibility object (the one the previous
   night's run wrote, or the one the rebuild wrote). If absent, no
   filtering happens at all -- AC2's fallback.
2. Filters tonight's incoming bars to that set **before** calling
   `merge_panel_parquet`. This is deliberate: a ticker's eligibility for
   *tonight's* admission is decided from a window that does not include
   tonight's not-yet-appended bar. Deciding admission from a
   same-night-recomputed window would risk excluding a ticker for the wrong
   reason -- an incomplete window, not a real liquidity drop -- exactly the
   ordering hazard the ticket brief calls out.
3. Merges and writes the panel as today.
4. Re-parses the now-updated panel (`parquet_bytes_to_panel` -- one extra
   full decode pass, accepted: the post-floor panel is ~56 MB resident, the
   same order of cost `load_panel` already pays once per service start) and
   recomputes eligibility from it. `domain.universe_floor.diff_eligibility`
   reports which tickers left the set; each is logged
   (`logger.warning`, ticker names and count -- AC4's "never silently").
   The refreshed set is written back as the new `universe_eligibility.csv`,
   read by tomorrow night's step 1.

A ticker that falls below the floor (step 4) is not retroactively purged
from `panel.parquet` -- only removed from the set step 2 consults, so it
stops receiving new bars starting the *next* run. Retroactive deletion
would cost a full panel rewrite on every demotion and destroy rows a user's
already-open research session may reference; freezing forward accretion is
the cheap, safe half of "stop it from getting worse," and the demotion is
still fully observable via the log line and the object's own diff against
its previous version (S3 versioning keeps both).

### Promotion policy (AC5) -- why it is not automatic

A ticker that was never admitted to the panel has no trailing rows the
floor computation can read -- there is nothing in `panel.parquet` to
compute a 60-session median from. Automatically admitting it on a single
night's bulk-response volume would either violate the 252-session history
floor outright (admitting it with one day of history) or require silently
retaining full-universe history for every ticker "just in case" it someday
qualifies -- which is exactly the unbounded-panel failure mode this ticket
exists to close, reintroduced through a different door. Growing the
universe is therefore an explicit, periodic, operator-triggered action:
`scripts/enforce_universe_floor.py` (the same script this ticket's rebuild
uses) re-run against the live panel recomputes eligibility from whatever
history *is* resident and reports the diff; admitting a genuinely new
candidate still requires a deliberate `backfill_panel.py` run for it, same
as it does today for any ticker not yet in the panel at all. A previously
demoted ticker is a known edge case of this same limitation: because its
bars stop being admitted, its trailing window ages out of the panel's
most-recent-60-session frame over time, so it cannot self-recover through
the nightly path either -- re-admitting it goes through the same explicit
re-scope, not an automatic promotion. This is stated plainly rather than
glossed over: it is a real limitation of computing the floor from
panel-resident data only, accepted because the alternative (retaining
full-exchange history) is the exact cost this epic's memory ceiling exists
to avoid.

### Rebuilding the production panel (AC6-AC8)

`scripts/enforce_universe_floor.py` -- filters the *existing* stored panel,
no EODHD calls. Reads `panel.parquet` via `S3PanelStore` (the same code
path production reads through), computes eligibility with the exact user
floor, filters the compact frame, converts it back to wire-format Parquet
bytes (`infra/panel_io.py::panel_frame_to_wire_bytes`, the inverse of
`parquet_bytes_to_panel`), and writes `panel.parquet` +
`universe_eligibility.csv` + a `universe.csv` trimmed to the same tickers.
Defaults to a dry-run report; `--apply` is required to write. Before
writing, it records the object's current S3 `VersionId` as the stated
rollback target. After writing, it re-reads the new object back through
`S3PanelStore` and reports ticker count, row count, `as_of`, resident
bytes, and resident bytes/row -- the same verification T-0016-7 did for the
original backfill.

### Container re-measurement (AC9)

`scripts/measure_container_memory.py` is unchanged; T-0016-9's method
(build `backend/Dockerfile`, run under `docker run --memory=2g
--memory-swap=2g --cpus=1` with real read-only credentials) is re-run
against the rebuilt object, once per pattern (`simple`, `complex`), since
peak RSS cannot fall within one process.

## Technical Considerations

`_apply()`'s extra full-panel parse for the eligibility refresh runs once
per nightly invocation, not once per session in a catch-up run -- the
refresh reads the panel *after* every session in the batch has been merged,
matching how `merge_panel_parquet` already treats a multi-day catch-up as
one rewrite rather than one per day.

`enforce_floor`'s off-by-default parameter and AC2's eligibility-object
fallback are the two places this ticket adds a branch to already-shipped
production code (`backfill_panel()`, `_apply()`); both default to today's
existing behavior for exactly the reason CLAUDE.md's dead-code policy
requires a flag for new behavior in existing code -- an incomplete or
reverted enforcement path must not be able to affect a caller that never
asked for it.

## Out of Scope

Automatic promotion of an off-universe ticker (see Solution Approach --
deliberately not built, with the reasoning stated). Any Terraform or AWS
resource change. Any change to `PriceBar`, the panel's wire schema, or the
engine's public surface. A UI-facing way to browse the eligibility list
(nothing today consumes `universe_eligibility.csv` outside the ingest/nightly
pipeline).

## Verification

_Filled in after implementation and the live rebuild; see the report for
the exact survivor counts, S3 version IDs, read-back stats, and measured
container peaks._
