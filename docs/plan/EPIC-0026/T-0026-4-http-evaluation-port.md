# T-0026-4: HttpScreenerEvaluationPort

**Epic**: EPIC-0026 (Agent Screener Loop)
**Design**: docs/design/screener-core/
**Status**: Done
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

## Solution Approach

**Backend contract** (read off `epic/EPIC-0025-server-side-screener-evaluation`,
not yet merged into this branch — reading the contract does not require
merging the code): `POST /api/screener/run` takes a
`ScreenerRunRequest` (`universe`, `filter_tree`, `ranking`, `limit`,
`dry_run`) and always returns one flat `ScreenerRunResult` shape
discriminated by `status: complete | refused | valid`
(`backend/domain/models/screener_run.py`). `complete` carries
`matches`/`provenance`; `refused` and `valid` carry `problems`; `valid` is
what a `dry_run: true` call returns when nothing blocking was found.

**New module**: `src/lib/screener/infra/httpEvaluationPort.ts`, exporting
`createHttpScreenerEvaluationPort(deps: { baseUrl, fetchImpl?, now? })`.
Mirrors `workspace/panelStatus.ts`'s / `chart/infra/httpChartSeries.ts`'s
established fetch-check-`.ok`-parse-map convention, not a new HTTP style.

- Request builders translate the frontend's camelCase
  `ScreenerDefinition` (`definition.ts`, `conditions.ts`) into the
  backend's snake_case wire shape field-for-field, mirroring how
  `backend/domain/models/screener.py`'s own header already documents
  itself as "a field-for-field mirror of conditions.ts". The backend's
  `UniverseSpec` is deliberately smaller than the frontend's (no
  exchanges/countries/industries/indexes/watchlists — the backend's own
  docstring says so); those fields are simply not sent. `universe_id`/
  `label` are filled from `screenerId`/`name` since the backend model
  requires them but does not filter on them. `limit` on the request comes
  from `definition.ranking?.limit`, defaulting to the backend's own
  default (50) when there is no ranking.
- Response mappers translate `ScreenerRunResult` back into this repo's
  `ScreenerRun` / `ScreenerRunRefusal` (`run.ts`) and
  `ScreenerValidationReport` (`validation.ts`), reusing `run.ts`'s own
  `makeScreenerRun` invariant-checking constructor rather than
  hand-assembling a `ScreenerRun`. Fields the backend response does not
  carry (`warnings`, `rejectedEvaluations`) get honest empty defaults, not
  fabricated data — matching this ticket's scope boundary against
  `ScreenerMatch`/`ScreenerRun` shape changes owned by T-0026-3.
- AC5: `execute()` and `validate()` each wrap their fetch call (network
  failure, non-2xx, malformed JSON, or a `'complete'` response missing
  `provenance`) in a try/catch and return a normal `ScreenerRunRefusal` /
  invalid `ScreenerValidationReport` carrying a readable blocking problem
  (`code: 'network_error'`) instead of letting the rejection propagate —
  never an unhandled rejection out of either method.
- AC2: `validate()` maps every problem the backend reports (`problems.map(...)`),
  not just the first.

**Composition root wiring** (AC3/AC4): `workbenchCompositionRoot.ts`'s
`buildScreenerDeps` is the one place inside the actual composition root
module that currently decides `ScreenerToolDeps.evaluationPort` — today it
just forwards `overrides?.evaluationPort` (`undefined` on the real
call site), leaving `runScreener.ts`'s own internal fallback
(`createScreenerEngine` + `createUnavailableMarketData`) to apply. This
ticket changes only that one expression to
`overrides?.evaluationPort ?? createHttpScreenerEvaluationPort({ baseUrl: resolveApiBaseUrl(overrides?.chartBaseUrl) })`
— reusing the exact `chartBaseUrl` value `+page.svelte` already resolves
via `resolveApiBaseUrl(env.PUBLIC_API_BASE_URL)` for the chart tool group,
per AC3's "not a second, independent URL resolution". Nothing about
`buildScreenerTools`, `registerScreenerTools`, or which tools get
registered changes — that stays T-0026-5's job.
`runScreener.ts`'s/`registerScreenerTools.ts`'s own internal defaults are
untouched, so other callers (unit tests, `registerScreenerTools()`'s
standalone default) keep their existing in-browser-engine behavior.
