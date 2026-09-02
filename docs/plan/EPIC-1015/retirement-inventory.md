# EPIC-1015 Retirement Inventory (T-1015-1)

**Status**: audit deliverable — no file listed below has been deleted or
modified by this ticket.

Legend:

- **retire** — deleted in this epic.
- **keep** — infrastructure that survives and serves the new surface (or
  both surfaces) today, verified by a real, current import from new-surface
  code — not a hoped-for future use.
- **absorb** — logic that must move somewhere else in the new surface
  before its source file is deleted. Every absorb entry below names the
  destination or the decision it is contingent on; per T-1015-1 AC4, an
  absorb candidate with no real destination is downgraded to retire rather
  than left open.

This inventory corrects several places where the epic's starting
classification (`T-1015-1-retirement-inventory.md`'s "Technical
Considerations") was wrong or incomplete once checked against real import
graphs on the code that actually exists on `main` today. Corrections are
marked **(correction)**.

## 1. WebMCP transport — verified keep

These modules have a real, current importer on both surfaces today. All
paths verified to exist.

| Path | Classification | Reason |
|---|---|---|
| `src/lib/webmcp/bridge.ts` | keep | `ensureModelContext()` — the `document.modelContext` polyfill and bridge-replacement notification — is imported today by every composition root on **both** surfaces: legacy (`status.ts`, `spike.ts`, `register.ts`), and new (`panels/shell/registerPanelTools.ts`, `panels/shell/panelController.ts`, `panels/tools/panelTools.ts`, `webmcp/screener/registerScreenerTools.ts`, and every `workbench/*/tools/register*Tools.ts`). No product coupling. |
| `src/lib/webmcp/types.ts` (transport slice only) | keep | `ModelContext`, `ModelContextToolDescriptor`, `ToolResult`, `ToolSpec`, the ambient `declare global { interface Document }` block. Used by `bridge.ts` and by new-surface tool files. **Must be split out of the same-named file's product half before that half retires** (see §2). |

## 2. WebMCP transport — corrected from "keep" to "absorb, contingent on a product decision"

**Correction, resolving a real disagreement found during this audit.** The
epic's starting classification called `register.ts`/`session.ts`/`status.ts`
"keep — transport, needs re-pointing/genericizing." A first pass at this
audit verified their *current* import graph and found **zero real callers
outside the legacy chain** (`session.ts` → `register.ts` → `tools.ts`/
`types.ts`, reached only by `src/routes/+page.svelte`) and, on that basis,
classified all three as retire. A second pass argued the opposite — "keep,
needs edit" — on the grounds that the code is generic enough to serve the
new surface once genericized.

Both are half right. **Verified fact**: none of these three files, as they
stand, serves the new surface today — every one of the nine new-surface
tool groups (`panels`, `screener`, `workbench`, `chart`, `similarity`,
`backtest`, `alerts`, `watchlist`, `followup`) independently calls
`ensureModelContext()` directly and registers its tools in one static pass,
bypassing `register.ts`'s diffing entirely. This was not an oversight in
one epic — nine independent implementations made the same choice, which is
itself a signal, not noise. Declaring these files "keep" without a real
current importer would be exactly the kind of speculative entry AC6
prohibits.

**But** the logic in these files is the codebase's only implementation of
two capabilities the capability-parity check (T-1015-2) either requires
outright or flags as a live drop: `register.ts`'s desired-vs-registered
diffing is the only progressive-tool-availability mechanism that exists
anywhere, and `status.ts`'s formatting (already duck-typed on `{name}[]`,
not coupled to legacy types) is the only implementation of the
workspace-status header the epic's own design spec requires on `/workbench`
regardless of legacy parity. Retiring them outright forecloses a decision
that belongs to T-1015-2's sign-off and T-1015-3's design, not to a
file-level mechanical audit.

| Path | Classification | Reason |
|---|---|---|
| `src/lib/webmcp/register.ts`, `register.test.ts` | **absorb, contingent** | Generic desired-vs-registered diffing (`connectWebmcp`, generation ownership, dispose semantics) currently imports `buildTools`/`ResearchEngine` directly (lines 3, 8) — that coupling must be genericized to take a `ToolSpec[]` rather than an engine. No current new-surface caller. Kept alive as an absorb candidate only if T-1015-2's sign-off decides progressive tool availability must survive; if that capability is accepted as a deliberate drop, downgrade to retire. |
| `src/lib/webmcp/session.ts`, `session.test.ts` | **absorb, contingent** | Bridge connect/failure state machine (`startBridgeSession`); reports the four bridge states the required status header needs. No current new-surface caller. Same contingency as `register.ts` — needed only if a status header/progressive-availability rebuild reuses this state machine rather than being written fresh in T-1015-3. |
| `src/lib/webmcp/status.ts`, `status.test.ts` | **absorb, contingent** | `buildWebmcpStatus`/`formatBridgeStatus`/`formatAgentToolsContext`; already decoupled from `tools.ts`/`types.ts` (takes `{name}[]`). This is the most likely of the three to actually get reused, since the workspace-status header is a hard requirement of this epic's own design spec (`docs/design/legacy-surface-cutover/spec.md`'s Route Migration behavioral spec), not merely a legacy-parity nicety — see T-1015-2. |
| `src/lib/webmcp/testSupport.ts` | retire | Test double for `ModelContext`, used only by `register.test.ts`/`session.test.ts`. Every new-surface tool group already has its own separate test fixture (`panels/tools/testSupport.ts`, `discovery/testSupport.ts`, `workbench/testSupport.ts`, etc.) — this one is not shared, and its disposition doesn't need to track `register.ts`/`session.ts`'s contingency. |

## 3. WebMCP product surface — retire (with one mandatory extraction)

| Path | Classification | Reason |
|---|---|---|
| `src/lib/webmcp/types.ts` (product slice) | retire | `StudySummary`, `SetupStep`, `SetupSummary`, `InstanceEvent`, `InstanceSetSummary`, `PanelSummary`, `FocusState`, `WorkspaceState`, every `*Input`/`*Result` type, `ResearchEngine`, `FUNCTION_CATALOG`, `ExpressionError`. Only consumed by files also retiring in this table. Requires splitting this file into a transport file (§1) and deleting the rest — it cannot be deleted whole. |
| `src/lib/webmcp/tools.ts` — **the 11 tool builders** (`buildTools` and its per-tool schemas) | retire | Product surface itself. |
| `src/lib/webmcp/tools.ts` — **`ok()`/`fail()` helpers** | **mandatory extraction, not a plain retire** | Verified: `ok`/`fail` are generic `ToolResult` constructors imported today by 19 new-surface files (`grep -rl "from '.*webmcp/tools'"` — `workbench/tools/index.ts`, `safetyTools.ts`, `backtest/tools/{backtestScreener,getBacktestResults}.ts`, every `alerts/tools/*.ts`, `watchlist/tools/*.ts`, `chart/tools/{getChartData,captureChartSetup,addChartAnnotation}.ts`, `followup/tools/{registerAllFollowupTools,createCustomStudy,createComputedField}.ts`, `screener/tools/deriveFiltersFromSetup.ts`, `export/tools/exportResultsTool.ts`, plus legacy `+page.svelte`/`dev/+page.svelte`/`ChartToolbar.svelte`). Deleting `tools.ts` wholesale breaks 17 new-surface files' builds. `ok`/`fail` must be extracted to a small transport-side module (e.g. `src/lib/webmcp/toolResult.ts`, alongside the `ToolResult` type they construct) **before** the rest of `tools.ts` is deleted. |
| `src/lib/webmcp/tools.test.ts` | retire | Tests only the 11-tool builders. |
| `src/lib/webmcp/integration.test.ts` | retire | Couples `createApiEngine` (retiring) to `buildTools` (retiring); both sides retire together. |
| `src/lib/webmcp/spike.ts`, `spike.test.ts` | retire | T-0001-2 throwaway scaffolding. |
| `src/routes/spike/+page.svelte` | retire | Renders the spike tool; nothing else links to it. |

## 4. Legacy workspace model (`src/lib/workspace/`)

| Path | Classification | Reason |
|---|---|---|
| `store.ts`, `store.test.ts` | retire | The legacy workspace store (`WorkspaceState`-typed). Only consumer: `+page.svelte`, `dev/+page.svelte`. |
| `apiEngine.ts` | retire | `createApiEngine`, the legacy `ResearchEngine` HTTP client; calls `backend/api/routes/research.py` exclusively. |
| `WorkspaceView.svelte`, `GridPanel.svelte`, `PriceChart.svelte`, `FocusChart.svelte`, `ChartToolbar.svelte`, `ActivityFeed.svelte`, `SnapshotPicker.svelte` | retire | Legacy-model components; each imports `WorkspaceState`/`ResearchEngine`-shaped types and is used only by `+page.svelte`/`dev/+page.svelte`. |
| `visualization.ts`, `visualization.test.ts` | retire, not absorb | `computeChartGeometry`/`axisTicks`/`axisTickIndices`/`nearestBarIndex`/`sliceBarsForRange` are pure chart math with no legacy-type coupling, but nothing imports this file today — `workbench/chart/components/chartScales.ts` reimplements the same technique independently (its own comment cites this file as the prior art, not as a dependency). Per AC4, an absorb candidate with no real destination downgrades to retire; there is nothing left to port. |
| `activity.ts`, `activity.test.ts` | retire | The action-log store; `summarizeToolCall` is legacy-tool-name-specific. No new-surface module reproduces an attributed action log today — flagged as a likely capability drop, not silently absorbed; see T-1015-2. |
| `snapshots.ts`, `snapshots.test.ts`, `snapshotGuard.ts`, `snapshotGuard.test.ts` | retire | Superseded in intent, not in code, by `save_workspace`/`restore_workspace_revision` (`src/lib/workbench/application/revisionService.ts`, EPIC-1006) — an independently-built replacement, not a destination this file's code moves into. Nothing to port. |
| `apiConfig.ts`, `apiConfig.test.ts` | **keep (correction)** | Not in the epic's starting classification. `resolveApiBaseUrl` is imported today by `+page.svelte`/`dev/+page.svelte` **and** by `workbench/followup/tools/registerAllFollowupTools.ts`, `workbench/similarity/tools/registerSimilarityTools.ts`, `workbench/backtest/tools/registerBacktestTools.ts`. Genuinely shared; its directory is legacy but the file is not — the clearest example in the codebase of why AC5 forbids classifying by directory. |
| `panelStatus.ts`, `panelStatus.test.ts` | retire | Calls `GET /api/research/panel` (legacy backend route) exclusively. Only consumer: `+page.svelte`. Not in the epic's starting list. This is the data-freshness half of the workspace-status header — its removal with no replacement is a candidate parity gap; see T-1015-2. |
| `TickerSearch.svelte`, `tickerSearch.ts`, `tickerSearch.test.ts` | retire | Not in the epic's starting classification (added by `hotfix/marketpane-rebrand`). Only consumer: `+page.svelte`. No new-surface UI component offers human-driven ticker search today. |
| `testSupport.ts` | retire | Used only by legacy `workspace/*.test.ts` files. |

## 5. Shared UI shell / theme / routes

| Path | Classification | Reason |
|---|---|---|
| `src/lib/shell/AppShell.svelte` | retire | Not in the epic's starting classification — lives outside `workspace/`, exactly the directory-classification trap AC5 warns against. Pure 3-region layout (`topBar`/`children`/`log` snippets) with no store access, but its only consumer today is `+page.svelte`; `workbench/+page.svelte` renders no shell at all (confirmed by reading it in full — it renders only a loading message and `PanelContainer`). No current new-surface consumer to absorb into. |
| `src/lib/theme/**`, `src/lib/assets/*` | keep | Used by `src/routes/+layout.svelte`, shared identically by every route including `/workbench`. Not legacy. |
| `src/routes/dev/+page.svelte` | retire | The manual tool-harness route; every import is legacy (`workspace/store`, `apiEngine`, `webmcp/tools`, `GridPanel`, `FocusChart`, `WorkspaceView`) except the kept `apiConfig.ts`. No new-surface equivalent harness exists — flagged for T-1015-2 as a capability with no replacement, not silently dropped. |
| `src/routes/+page.svelte` | retire | The legacy route itself; every import is either retiring (§2 contingent items aside) or a kept shared module. |

## 6. Backend

| Path | Classification | Reason |
|---|---|---|
| `backend/api/routes/research.py`, `backend/api/schemas/research.py` | retire | The legacy 5-endpoint surface (find/sample/measure/split-instances, instance-windows) plus `GET /api/research/panel`. |
| `backend/domain/models/instance.py`, `measurement.py`, `pattern.py` | retire | Imported only by `research.py`/its schemas, `domain/contracts/engine.py`, `infra/pandas_engine.py`, and legacy-only tests/scripts — no similarity/backtest importer anywhere, verified. |
| `backend/domain/contracts/engine.py` | retire | `PatternResearchEngine` Protocol; imported only by `pandas_engine.py`, `api/schemas/research.py`, and `tests/mocks/mock_pattern_research_engine.py`. |
| `backend/infra/pandas_engine.py` | retire | Imported only by `research.py`, `main.py`'s legacy engine construction, and legacy-only scripts/tests (see cascade note below). |
| `backend/tests/mocks/mock_pattern_research_engine.py` | retire | Verified to have **no importer anywhere in the tree today** — already dead code independent of this cutover. |
| `backend/tests/functional/test_research_routes.py`, `backend/tests/unit/test_pattern_research_engine.py`, `backend/tests/unit/test_query_engine_stats.py` | retire | Test only the modules above. |
| `backend/tests/unit/test_universe_metadata.py` | retire, with a cascade note | Directly imports `domain.models.pattern` and `infra.pandas_engine`, but incidentally exercises `nasdaq_screener.py` parsing (shared, kept infra) in the same file — T-1015-4 must re-home that coverage into a surviving test file before deleting this one, or universe-metadata parsing loses test coverage. |
| `backend/scripts/measure_universe_scale.py`, `analyze_universe_scope.py`, `measure_container_memory.py` | keep, needs rework | Ops scripts that use `pandas_engine.py` purely as a memory-measurement harness. Deleting `pandas_engine.py` breaks these; T-1015-4 must give them a different harness or accept the measurement capability is lost. Not product surface — untouched by this ticket, flagged for T-1015-4. |
| `backend/api/routes/spike.py`, `backend/api/schemas/spike.py`, `backend/tests/functional/test_spike_ping.py` | retire | T-0001-2 throwaway scaffolding. **Correction to the epic's stated deployment risk**: `render.yaml:57`'s `healthCheckPath` is already `"/health"` (T-0016-2's real liveness endpoint, `backend/api/routes/health.py`, whose own docstring says it deliberately imports nothing from `api.routes.spike`/`api.routes.research` so deleting either cannot break it). The epic doc's "Deployment risk" section is stale — this hazard is already resolved, not a risk T-1015-4 still needs to manage. |
| `backend/tests/functional/test_health.py`'s `TestHealthRateLimitExemption`, `TestHealthIndependentOfSpikeStack`, `TestResearchPanelUnaffected` classes | keep, needs edit | Exercise shared rate-limit/CORS middleware and health liveness, but use `/api/spike/ping` or `/api/research/panel` as the vehicle — need repointing to a surviving endpoint, not deletion. The rest of `test_health.py` is unaffected. Deferred to T-1015-4. |
| `backend/domain/panel_disclosure.py`, `backend/tests/functional/test_panel_disclosure.py` | keep (tentative), final call deferred to T-1015-4 | Only current importer is `research.py` (retiring), but the function is generic (`PanelStatus`/`date` in, disclosure out; depends only on shared `trading_calendar.py`) and the new surface's own status header (§2) will need equivalent disclosure logic once built. Called out explicitly per AC7 rather than silently retired. |
| `backend/domain/errors.py` | keep | Core exception hierarchy (`ExpressionError` lives in frontend `types.ts`, not here). Imported by nearly every backend module on both surfaces (`eodhd_client.py`, `similarity_engine.py`, `panel_io.py`, `object_store.py`, `domain/backtest_engine.py`, `api/routes/similarity.py`, every `domain/contracts/*.py`). Cross-cutting core, not product-specific. |
| `backend/infra/expression.py` | keep | Imported by legacy `pandas_engine.py` **and** by `backend/infra/similarity_features.py` (EPIC-1012, new surface, live and merged). Cannot retire without breaking the similarity engine — resolves the epic's own Open Question ("plausibly reusable... decided in T-1015-4") with a concrete verified answer. |
| Everything else under `backend/domain/`, `backend/infra/`, `backend/application/`, `backend/api/routes/{similarity,backtest,health}.py` and their schemas | keep | Verified new-surface-only or genuinely shared ingestion/pipeline infrastructure (panel loading, EODHD client, object store, universe eligibility). None import from or are imported by the retiring set above. |
| `backend/main.py` | keep, needs edit | Wires the research/spike routers and constructs the legacy engine alongside the similarity/backtest engines and shared panel loading. At cutover, drop the `research_router`/`spike_router` registrations and the legacy engine construction; the shared panel-loading call and similarity/backtest wiring stay. |

## 7. Non-tool capabilities — verified today, flagged for T-1015-2

Not a retire/keep/absorb call (that belongs to T-1015-2), but recorded here
per this ticket's remit to distinguish product surface from infrastructure
precisely, since each of these was easy to miss by directory alone:

- **Progressive tool availability**: implemented only in `webmcp/register.ts` (§2, contingent). Its only real-world *use* today — `webmcp/tools.ts`'s per-tool `available(ws)` predicates — retires with the product surface. Every new-surface tool group registers statically instead. Whether anything reuses the kept-contingent diffing mechanism is T-1015-2/T-1015-3's decision.
- **Workspace-status header** (bridge-state banner, defined/available tool counts, click-to-reveal names, agent HTML comment): today rendered only on `/`. `/workbench` renders no header at all — confirmed by reading `src/routes/workbench/+page.svelte` in full.
- **Activity/action log with human-vs-agent attribution**: `activity.ts` (retiring, §4) has no new-surface counterpart. `workbench/application/changeHistory.ts`, the nearest analogue, records mutations with no actor field.
- **Human-side grid selection / single-panel close**: legacy `GridPanel.svelte` implements both. The new surface's `results_table` panel kind has a per-row selection toggle (a partial, panel-kind-scoped equivalent, confirmed live), but `panels/shell/PanelFrame.svelte` (the new panel chrome) has only a collapse/expand control — no human-clickable close button, confirmed by reading the component.

## 8. Deliberately untouched (AC7)

Not legacy, not new-surface product code — called out rather than omitted:

- Build/tooling config: `package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `.prettierrc*`, `backend/pyproject.toml`, `backend/uv.lock`.
- Deployment config: `render.yaml`, `wrangler.jsonc` (referenced only for the T-1015-4/8 health-check context above, not edited by this ticket).
- CI: `.github/workflows/*`.
- `backend/scripts/*` other than the three flagged in §6 as cascading from `pandas_engine.py`'s retirement.
- `src/routes/+layout.svelte`, `+layout.ts` — shared shell/theme injection, used identically by both routes today.

## Summary

| Classification | Frontend files | Backend files |
|---|---|---|
| retire | 35 | 10 |
| keep | 6, 3 needing an edit, 2 tentative pending T-1015-4 | ~40, 2 needing an edit, 2 tentative pending T-1015-4 |
| absorb, contingent on T-1015-2's sign-off | 3 (`register.ts`, `session.ts`, `status.ts`, plus their tests) | 0 |

Every path named above was verified to exist on this branch at time of
writing (`epic/EPIC-1015-legacy-surface-cutover`, forked from `main`
@ `c3ed17c`).
