# T-1016-4: Streaming universe evaluation — bounded peak residency

**Epic**: EPIC-1016 (Market Data Storage)
**Status**: Open
**Depends on**: T-1016-2, T-1016-3
**Blocks**: T-1016-6
**Issue**: #13
**Design**: docs/design/market-data-storage/

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
