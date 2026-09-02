# T-1009-2: Screener execution contracts and run provenance

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Done
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

## Solution Approach

**Binding architecture note**: this epic is implemented entirely in
browser-side TypeScript under `src/lib/screener/`, not in
`backend/`. Where this ticket's Description and Design References say
"backend" and cite `backend/domain/contracts/engine.py`, read that as the
Protocol-in-domain / adapter-in-infra *pattern*, not the location. AC1 and
AC2's "screener definition" and "condition types" are already satisfied by
T-1009-1 (`src/lib/screener/definition.ts`, `src/lib/screener/conditions.ts`)
— this ticket consumes those, adding only the strict parse AC2 calls for and
the run/validation/port contracts.

### Modules

**`src/lib/screener/ports.ts`** (types only, domain layer, new file)

- `ScreenerEvaluationPort` — `{ validate(definition): Promise<ScreenerValidationReport>; execute(input: { definition, runId }): Promise<ScreenerRunOutcome> }`. T-1009-7 implements it; nothing here performs I/O.
- `ScreenerMarketData` — the narrow port the (future) engine needs: resolve a universe to instruments, fetch a field value per instrument, fetch a series, detect a pattern, evaluate a study output, and report the `MarketDataProvenance` covering the read. Mirrors the shape of `src/lib/discovery/ports.ts`'s `InstrumentDirectory` (a port only, honest-unavailability default lives in the T-1009-7 adapter, not here — mirroring `src/lib/discovery/unavailableDirectory.ts`).
- `PinnedRunStore` — `{ getRun(runId): ScreenerRun | RunNotAvailable; getMatches(runId, offset, limit): ScreenerMatch[] | RunNotAvailable }`. No execute/rerun method exists on this interface — that structural absence is EPIC-1010's "no silent rerun" guarantee. `RunNotAvailable = { available: false; runId; reason: 'unknown' | 'evicted'; message }` distinguishes "gone" from "matched nothing" (an empty `ScreenerRun.matches` array). Retention is pluginable via `RunRetentionPolicy.shouldEvict(run, now, index)`, with an exported `keepAllRuns` policy implementing the working assumption (spec.md Open Question 1) that eviction is an explicit, off-by-default decision. T-1009-9 implements the store.

**`src/lib/screener/validation.ts`** (new file, imports `definition.ts`/`conditions.ts` types + `ResourceId`)

- `ProblemSeverity`, `ValidationProblem`, `PROBLEM_CODES` (one const per code this epic emits: invalid parameter, unknown catalog item, unavailable data, contradiction, expensive query, empty universe, unknown condition type).
- `CostEstimate`, `ScreenerValidationReport` (carries `detectionExhaustive: false` literal, documented as deliberate).
- `parseScreenerForExecution(value: unknown): { ok: true; screener: ScreenerDefinition } | { ok: false; problems: ValidationProblem[] }` — a strict sibling to T-1009-1's lenient `normalizeScreener`: walks the filter tree and rejects (rather than silently drops, per AC2) any condition node whose `type` is not one of the eight known variants, reporting `PROBLEM_CODES.unknownConditionType` with the offending `nodeId`. Does not modify `normalizeScreener`.

**`src/lib/screener/run.ts`** (new file, the cross-epic contract; imports `ResourceId` from `workbench/domain/ids`, `Revision` from `workbench/domain/workspace`, `MarketDataProvenance`/`toWireProvenance` from `workbench/domain/provenance`, `ValidationProblem` from `./validation`)

- `FilterNodeEvaluation`, `ScreenerWarning`, `ScreenerMatch`, `ScreenerRun`, `ScreenerRunRefusal`, `ScreenerRunOutcome` — exact shapes per the ticket brief above, each with a WHY comment.
- `makeScreenerRun(input): ScreenerRun` — enforces `truncated === returnedCount < matchedCount`, `returnedCount === matches.length`, ranks contiguous from 1 over `matches` in array order, and a runtime provenance-presence guard (checks `liveness`/`sourceId`/`engineVersion` are set) so a run built from an untyped/deserialized object with absent provenance throws rather than silently constructing (AC5). Throws `Error` with a descriptive message on any invariant violation — callers (T-1009-7) are expected to construct from validated data, so this is a programming-error guard, not a user-facing validation path (that's `validation.ts`).
- `toWireScreenerRun`/`toWireScreenerMatch` — snake_case serializers delegating to `toWireProvenance` for the `provenance` field.

### Test plan (`*.test.ts` alongside each module)

- `conditions.ts` is already tested by T-1009-1; `validation.test.ts` covers only this ticket's new surface:
  - `parseScreenerForExecution` accepts a screener carrying each of the eight condition variants (one test per variant, parameterized or individual).
  - rejects a definition with an unrecognized condition `type`, reporting `PROBLEM_CODES.unknownConditionType` and the node ID.
  - rejects/passes nested groups and disabled nodes correctly (disabled nodes are not walked for AC2 purposes, matching spec.md's "disabled nodes produce no problems").
- `run.test.ts`:
  - `makeScreenerRun` builds a valid run from well-formed input.
  - throws when `truncated`/`returnedCount`/`matches.length` are inconsistent.
  - throws when ranks are not contiguous from 1.
  - throws when provenance is `null`/`undefined`/a partial object cast through `unknown` (AC5, AC8 "refusal to construct a run with incomplete provenance").
  - `toWireScreenerRun`/`toWireScreenerMatch` produce snake_case keys and delegate provenance serialization to `toWireProvenance`.
  - `ScreenerRunRefusal` / `ScreenerRunOutcome` typecheck as a discriminated union on `status`.
- `ports.ts` holds only types (no logic), so per the ticket brief it gets no dedicated test file; its shapes are exercised indirectly wherever `run.ts`/`validation.ts` tests construct values matching them.

### Out of scope for this ticket (unchanged from ticket doc)

No adapter implementing `ScreenerEvaluationPort`/`ScreenerMarketData`/`PinnedRunStore`, no data source, no HTTP routes. Those are T-1009-7/8/9.
