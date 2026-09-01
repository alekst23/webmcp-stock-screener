# T-0013-4 (CANCELLED): Streaming universe evaluation — bounded peak residency

**Epic**: EPIC-0013 (Market Data Storage)
**Status**: Cancelled — the 512 MB ceiling this addressed was removed by the AWS re-platform (#16)
**Depends on**: T-0013-2, T-0013-3
**Blocks**: —
**Issue**: #13
**Design**: docs/design/market-data-storage/

## Why this is deferred

Cut from EPIC-0013's scope on 2026-09-01. This epic targets a POC:
a trimmed liquid universe that stays fully resident, on the explicit
understanding that a production version needs a real store.

Given that, a hand-rolled chunked scanner is a query engine built to be
discarded exactly when it starts mattering. It buys no latency
(`findInstances` scans the whole universe by design), only headroom —
and headroom is what DuckDB-over-R2 gives for free, reading the same
partitioned Parquet T-0013-3 produces.

Kept as a file rather than deleted because the analysis stays valid if
the ladder is ever climbed in a different order. Do not implement this
without first rejecting DuckDB for a stated reason.

## Description

The last step that decouples memory from dataset size: evaluate a search
partition-by-partition so peak residency is one partition rather than the
whole panel. This is cheap because `pandas_engine.py` already iterates
`panel.groupby("ticker")` — per-ticker evaluation is already isolated, so
this restructures a loop rather than rewriting the matcher.

Note what this does and does not buy. `findInstances` scans the whole
universe by design; streaming does not reduce the work or the latency. It
makes memory stop tracking the dataset, which is the point.

## User Story

As a researcher searching the full listed universe,
I want the search to complete within the instance's memory budget,
so that growing the universe does not start killing the service.

## Acceptance Criteria

1. A search over a universe substantially larger than available memory
   completes, with measured peak residency bounded by roughly one partition
   plus accumulated results — not by panel size.
2. Results are identical to those the fully-resident engine produces for the
   same pattern and universe. Verified against the existing known-pattern
   fixtures, which must pass unchanged.
3. Peak residency is materially unchanged when the universe doubles in
   tickers or in history; only latency and storage grow.
4. Two concurrent searches both complete within budget; neither is starved
   nor pushes the other over.
5. Statistics that sample across the panel (base rates) draw a sample
   equivalent in distribution to the resident implementation's.

## Out of Scope

DuckDB-over-R2 (considered and deferred — see technical.md).


## Cancelled — 2026-09-01

This ticket existed to keep peak memory under Render's free-tier 512 MB by
evaluating conditions per ticker instead of materializing whole-panel
intermediates. The backend is moving to a large AWS container (#16), where
the measured peak fits with headroom, so the constraint it was written
against no longer exists.

It is cancelled rather than deferred because leaving it open implies work
that should happen eventually. It should not: if peak memory ever becomes a
problem again, the answer is a real query engine against the database that
is already provisioned, not a hand-rolled chunked scanner — which is what
this epic's own `technical.md` argued from the start.

The underlying observation stays true and stays recorded in
`docs/plan/project.md`: peak memory grows with expression complexity, not
just dataset size. It is simply no longer worth engineering around.
