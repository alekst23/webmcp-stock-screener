# T-1016-6: Verify at full universe scale on 512 MB

**Epic**: EPIC-1016 (Market Data Storage)
**Status**: Open
**Depends on**: T-1016-4, T-1016-5
**Blocks**: —
**Issue**: #13
**Design**: docs/design/market-data-storage/

Resolves #13

## Description

The epic's claim is that the full US listed universe — ~6,268 tickers
(NASDAQ 3,690 + NYSE 2,321 + AMEX 257) across 10+ years, ~12M ticker-days —
runs on a 512 MB instance. This ticket proves it end to end against real
data rather than fixtures, and records the measurements so a later
regression has a baseline to fail against.

This is also where T-1001-9's deferred AC1 and AC5 finally close: the real
backfill runs, and the spot-check validates results against independently
known real-world facts.

## User Story

As the person shipping this,
I want the full-universe claim demonstrated on the real instance,
so that "it fits" is a measurement rather than a projection.

## Acceptance Criteria

1. A real backfill of the full listed universe over 10+ years is loaded into
   object storage and served by the deployed backend.
2. Startup and steady-state memory on the deployed instance are measured and
   recorded, and fall within the 512 MB budget with stated headroom.
3. Peak memory during a full-universe search is measured and recorded, and
   stays within budget.
4. A complete research session against real data produces plausible results,
   spot-checked against at least three independently known real-world facts
   (e.g. a documented earnings gap in a well-known stock).
5. The panel's as-of date shown to the user matches the real data's latest
   session.
6. Measurements are recorded somewhere durable enough to serve as a
   regression baseline.

## Out of Scope

Load and latency benchmarking beyond what the memory claim requires.
