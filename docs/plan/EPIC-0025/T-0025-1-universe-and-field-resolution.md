# T-0025-1: Universe and field resolution for server-side evaluation

**Epic**: EPIC-0025 (Server-Side Screener Evaluation Endpoint)
**Design**: docs/design/screener-core/
**Status**: Not started
**Depends on**: —
**Blocks**: T-0025-2

## Description

Two data gaps block a correct evaluation, independent of the endpoint
that will use them:

1. No catalog field expresses "percent change over the last N sessions" —
   the exact shape the MVP's flagship ranking needs ("highest gains in
   the past 48 hrs" ≈ 2 daily sessions, since the price pipeline is
   daily-bars-only).
2. Sector and market-cap universe narrowing has schema
   (`UniverseSpec.sectors`, `.market_cap`) but nothing resolves it — the
   metadata is already loaded (`backend/domain/models/universe.py`, via
   `scripts/load_universe_metadata.py`), it's just never read by universe
   resolution.

This ticket closes both, as pure resolution logic with no HTTP surface
yet — T-0025-2 wires them into the endpoint.

## User Story

As the screener evaluation endpoint,
I want a field resolver for session-over-session percent change and a
universe filter that honors sector/market-cap, both backed by data
already loaded,
so that evaluation can express and narrow on the two dimensions the MVP
use case needs.

## Acceptance Criteria

1. A new catalog field (`field.price.change_pct`, parameterized by
   `lookback_sessions`) resolves to the percent change between an
   instrument's close price `lookback_sessions` sessions ago and its most
   recent close, computed as a vectorized window over the price panel —
   not a per-instrument scalar fetch.
2. An instrument with fewer stored sessions than `lookback_sessions`
   resolves this field as not-evaluable (`None`), which the existing
   per-condition fold treats as fails-closed — it does not raise or abort
   the run.
3. Universe resolution filters candidates by `sectors` (any-of) and
   `market_cap` (minimum floor) using the already-loaded static metadata,
   with the same precedence the existing universe spec documents
   (exclusions always win over an inclusion that would otherwise add the
   same member).
4. A sector value in the request that matches nothing in the loaded
   metadata is reported as an unrecognized-value problem (surfaced by
   T-0025-2's validation), not silently dropped from the universe.
5. Neither addition requires a new external data source — both are
   computed from data already loaded (the price panel; the universe
   metadata CSV import).

## Out of Scope

- Fundamentals-based fields (P/E, revenue) — no source exists
  (`NoFundamentalsPort`); not part of this ticket or this epic.
- The HTTP endpoint itself (T-0025-2).
