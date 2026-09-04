# T-0026-4: HttpScreenerEvaluationPort

**Epic**: EPIC-0026 (Agent Screener Loop)
**Design**: docs/design/screener-core/
**Status**: Not started
**Depends on**: T-0026-1, T-0026-2
**Blocks**: T-0026-5 (composition root wires this port in as the default)
**Resolves**: #26

## Description

_Split out of the original T-0026-3 — see that ticket's note. This is the
evaluation-port change alone, independent of the result-row shape change
(T-0026-3) and the composition-root registration (T-0026-5)._

`run_screener`'s default `ScreenerEvaluationPort` is still the in-browser
engine wired to `createUnavailableMarketData()` (`src/lib/screener/engine/
unavailableMarketData.ts`) — every real evaluation refuses with
`empty_universe`, which is the whole reason EPIC-0025's backend endpoint
exists. This ticket implements `ScreenerEvaluationPort` (`validate`,
`execute`) against `POST /api/screener/run`, including its `dry_run: true`
validate-only mode, and wires it as the composition root's default —
replacing the in-browser engine as the actual runtime path.

The existing `WorkbenchCompositionOverrides.evaluationPort` seam (used by
`workbenchCompositionRoot.test.ts` to substitute a fake) is unchanged by
this ticket — this only changes what the *default* resolves to when no
override is passed.

## User Story

As `run_screener`,
I want my default evaluation port to call the real backend endpoint,
so that a screener that matches real instruments returns real matches
instead of an `empty_universe` refusal.

## Acceptance Criteria

1. `HttpScreenerEvaluationPort` implements `ScreenerEvaluationPort.validate`
   and `.execute` against `POST /api/screener/run`, mapping the backend's
   `ScreenerRunResult` (`status: complete | refused | valid`) to the
   frontend's `ScreenerRun` / `ScreenerRunRefusal` types (EPIC-1009).
2. `.validate` calls the endpoint with `dry_run: true` and surfaces every
   reported problem, not just the first (matching the endpoint's own
   all-problems-together contract).
3. Composition root's default (no `overrides.evaluationPort` passed) is
   `HttpScreenerEvaluationPort` pointed at the same backend base URL the
   chart tool group already resolves (`resolveApiBaseUrl`), not a second,
   independent URL resolution.
4. `overrides.evaluationPort` still substitutes cleanly for tests — no
   change to that seam's shape or behavior.
5. A network or non-2xx failure from the endpoint surfaces as a refusal
   with a reason an agent/human can read, not an unhandled rejection.

## Out of Scope

- `ScreenerMatch`'s row shape — T-0026-3.
- Registering `run_screener` itself in the composition root, or removing
  the in-browser engine — T-0026-5/T-0026-6.
