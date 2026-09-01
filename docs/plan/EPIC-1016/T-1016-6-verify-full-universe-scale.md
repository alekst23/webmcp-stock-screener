# T-1016-6: Verify at target universe scale on 512 MB

**Epic**: EPIC-1016 (Market Data Storage)
**Status**: Open
**Depends on**: T-1016-3, T-1016-5
**Blocks**: —
**Issue**: #13
**Design**: docs/design/market-data-storage/

Resolves #13

## Description

The epic's claim is that a trimmed liquid universe — on the order of 2,000
US listed common stocks across 10+ years, ~5M ticker-days, ~130 MB resident
— runs comfortably on a 512 MB instance with real headroom. This ticket
proves it end to end against real data rather than fixtures, and records the
measurements so a later regression has a baseline to fail against.

It also fixes the universe itself. The liquidity floor is a product decision
as much as a sizing one — thinly-traded microcaps distort pattern base rates
— so the chosen cut and its rationale are recorded, not left implicit in a
CLI flag someone ran once.

This is also where T-1001-9's deferred AC1 and AC5 finally close: the real
backfill runs, and the spot-check validates results against independently
known real-world facts.

## User Story

As the person shipping this,
I want the full-universe claim demonstrated on the real instance,
so that "it fits" is a measurement rather than a projection.

## Acceptance Criteria

1. A liquidity/market-cap cut is chosen, its rationale recorded, and the
   resulting ticker count stated. A real backfill of that universe over 10+
   years is loaded into object storage and served by the deployed backend.
2. Startup and steady-state memory on the deployed instance are measured and
   recorded, and fall within the 512 MB budget with stated headroom.
3. Peak memory during a whole-universe search is measured and recorded, and
   stays within budget with stated headroom.
4. A complete research session against real data produces plausible results,
   spot-checked against at least three independently known real-world facts
   (e.g. a documented earnings gap in a well-known stock).
5. The panel's as-of date shown to the user matches the real data's latest
   session.
6. Measurements are recorded somewhere durable enough to serve as a
   regression baseline, including the headroom figure that would trigger the
   DuckDB upgrade described in the technical design.

## Out of Scope

Load and latency benchmarking beyond what the memory claim requires.
