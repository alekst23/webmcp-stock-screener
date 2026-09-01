# T-1009-2: Screener execution contracts and run provenance

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
**Depends on**: —
**Blocks**: T-1009-7, T-1009-8

## Description

Validation and execution need market data, so they live behind a domain
port in the Python backend rather than in the browser. This ticket
defines that port and the entities either side of it: the backend's view
of a screener definition, the validation problem, and the pinned run with
its full provenance. It is the contract EPIC-1010 will read runs through,
so it must be settled before anything executes.

## User Story

As a developer implementing screener validation and execution,
I want a domain-level port and entities describing what a screener is and
what a run produces,
so that the evaluation engine, the validation tool, and the results
surface all agree on the same contract without importing each other.

## Acceptance Criteria

1. The backend can represent a screener definition — universe selection,
   filter tree with node IDs and enabled flags, and ranking — matching the
   browser-side model field for field.
2. Each of the eight condition types is a distinct typed variant, and a
   definition carrying an unrecognized condition type is rejected at parse
   time rather than silently ignored.
3. A validation problem carries a severity (blocking or non-blocking), a
   machine-readable code, the node IDs or universe criteria it concerns,
   and a human-readable explanation.
4. A run entity carries a stable run ID, the screener ID and the exact
   screener revision executed, universe count, matched count, returned
   count, a truncation flag, whether ranking was applied, and warnings.
5. Every run carries complete provenance: `as_of`, source, live/delayed
   status, timezone, currency, price adjustment (adjusted or unadjusted),
   the fundamentals reporting period backing any fundamental field used,
   and the calculation-engine version. A run cannot be constructed with
   provenance missing.
6. A run retains, per matched instrument in ranked order, the instrument
   ID, its rank and composite score, each ranking field's value, and the
   evaluated value and pass/fail state of every enabled filter node keyed
   by node ID.
7. A screener evaluation port declares validation and execution as
   operations returning these entities, and lives in the domain layer with
   no import from infra.
8. Unit tests cover parsing of every condition variant, rejection of an
   unknown condition type, and the refusal to construct a run with
   incomplete provenance.

## Design References

- `docs/design/screener-core/technical.md` — the `ScreenerRun` contract,
  provenance requirements, and what a run stores for EPIC-1010.
- `docs/design/screener-core/spec.md` — "Validate a screener" and "Run a
  screener" scenarios.
- `backend/domain/contracts/engine.py` — the existing Protocol-in-domain
  pattern this port follows.
- `backend/domain/models/` — the existing Pydantic domain entity style.

## Technical Considerations

- Domain never imports from infra. The port describes behavior; the
  pandas-backed adapter arrives in T-1009-7.
- The provenance type itself is EPIC-1006's; consume it rather than
  redefining its fields, and treat this ticket's job as making it
  mandatory on a run.
- Market-data and catalog access is through EPIC-1008's ports. Do not
  build a data source here.

## Out of Scope

The evaluation implementation (T-1009-7), the validation tool
(T-1009-8), HTTP routes, and result paging (EPIC-1010).
