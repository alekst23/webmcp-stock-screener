# T-1016-5: Disclose panel staleness and partial coverage

**Epic**: EPIC-1016 (Market Data Storage)
**Status**: Open
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
