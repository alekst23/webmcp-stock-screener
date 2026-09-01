# T-1016-5: Disclose panel staleness and partial coverage

**Epic**: EPIC-1016 (Market Data Storage)
**Status**: Complete
**Depends on**: T-1016-3
**Blocks**: T-1016-6
**Issue**: #13
**Design**: docs/design/market-data-storage/

## Description

Serve what is available and tell the truth about it. Today `main.py`
returns a blanket 503 when the panel file is absent, and once storage is
remote and partitioned the failure modes multiply: object storage
unreachable, a partition missing or corrupt, a panel stale because the
nightly delta did not run.

The rule is serve-and-disclose: results are still produced, and the
panel's true state travels with them. Hard failure only when nothing is
loadable. Never present stale or partial data as current and complete —
that is the point of T-1001-9's AC4, extended to the cases that arise once
the panel lives in object storage.

## User Story

As a researcher drawing conclusions from a pattern search,
I want to know when the data behind it is stale or incomplete,
so that I never mistake a partial universe for the whole one.

## Acceptance Criteria

1. A panel whose latest session is older than expected is served, and is
   presented as stale with its true as-of date.
2. A search run with some partitions unreadable returns results and states
   that the universe searched was incomplete, including what was missing.
3. Synthetic data is named as synthetic wherever results are presented, so
   an illustrative result cannot read as a real one.
4. When nothing is loadable, the request fails with an error naming the
   panel as the cause rather than a generic failure.
5. A degradation notice clears on its own once the panel is complete and
   current again — no intervention, no restart.
6. Every degradation state is reachable in a test without needing real
   object storage.

## Out of Scope

Alerting or paging on degradation; retry/backoff policy for object storage.

## Implementation Plan

`PanelStatus` carries the whole truth about the panel, and splits into two
kinds of field:

* **Load-time facts** — `is_synthetic`, `missing` (ticker ranges the loader
  could not read). Set where the panel is read and travel with it.
* **Request-time judgement** — `is_stale`, `sessions_behind`, `notices`,
  computed by `domain.panel_disclosure.disclose(status, today)` on every
  `/api/research/panel` request.

The split is what makes AC5 hold without machinery: nothing stores "degraded"
anywhere, so nothing has to remember to clear it. A panel whose nightly delta
lands stops being reported as stale on the very next request, no restart and
no intervention.

**Staleness threshold: 3 sessions** (`STALE_AFTER_SESSIONS`). One missed
weekday is routine — a market holiday, or the job running before the provider
publishes — and a notice that fires every long weekend is a notice people
learn to ignore. Three consecutive missed sessions is the nightly job having
stopped.

**Partial coverage** comes from `infra.panel_query.read_panel_resilient`,
which reads the panel a row group at a time and skips the ones that fail,
naming each skipped group by its ticker range. The range lives in the footer,
so it survives corruption of the pages it describes. This is the *degraded*
path only: `load_panel` runs T-1016-1's preallocated reader first and falls
back only when that raises, because the resilient read concatenates and so
costs a second copy of the panel. Schema drift is deliberately **not**
salvaged — a drifted producer is a bug, and serving part of its output would
hide that bug behind a coverage notice.

`domain/trading_calendar.py` now holds the weekday arithmetic both the nightly
job and staleness need, instead of a copy in each.

The frontend appends the backend's notices to the status line it already
renders, dropping the synthetic one because that surface has always said it
in its own words (`src/lib/workspace/panelStatus.ts`). No new UI section, so
no feature flag.

## Verification

- `tests/functional/test_panel_disclosure.py` — AC1 (a stale panel is served
  with its true as-of date), AC2 (a panel with an unreadable row group serves
  the rest and names what is missing), AC3 (synthetic data named), AC4 (the
  503 names the panel rather than the service), AC5 (the notice clears when
  the panel catches up), AC6 (every state above reached with an in-memory
  store and a byte-level fixture — no object storage anywhere).
- `src/lib/workspace/panelStatus.test.ts` — the notices reach the line the
  as-of date lives in, and "synthetic" is not said twice.

The partial-coverage fixture corrupts one row group's column chunk at the
offset the file's own metadata gives, rather than at a guessed position: an
earlier version overwrote bytes at a fraction of the file and the panel read
back clean, because Parquet writes no page checksums by default. That failure
is worth recording — silent corruption is a real property of the format, and
a coverage notice only fires when a read actually raises.

Mutation-checked: forcing `is_stale` false fails three staleness tests;
dropping `is_synthetic` at load fails the synthetic test; re-raising instead
of skipping a bad row group fails the partial-coverage test; dropping the
notices from the frontend status line fails its test.
