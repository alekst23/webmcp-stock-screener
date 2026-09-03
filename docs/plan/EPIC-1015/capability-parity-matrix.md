# T-1015-2: Capability-Parity Check (Deletion Gate)

**Verdict: NO-GO.**

## Headline finding, before the matrix

Every legacy capability mapping below has to be read against one
program-wide fact, confirmed independently against code (not just
`docs/plan/project.md`, which already documents it): **almost none of the
new surface is reachable from any route on `main` today.**

`src/routes/workbench/+page.svelte` calls exactly one composition root,
`registerPanelTools()`, which registers 14 panel tools + 2 results tools
(`get_screener_results`, `explain_result`). Every other new-surface tool
group exists as real, merged, tested code, gated behind its own flag, and
is called from nowhere except its own module and its own tests:

| Flag | File | External callers (non-test) |
|---|---|---|
| `SCREENER_TOOLS_ENABLED = false` | `webmcp/screener/registerScreenerTools.ts` | none |
| `WORKBENCH_TOOLS_ENABLED = false` | `workbench/tools/registerWorkbenchTools.ts` | none |
| `CHART_TOOLS_ENABLED = false` | `workbench/chart/tools/registerChartTools.ts` | none |
| `SIMILARITY_TOOLS_ENABLED = false` | `workbench/similarity/tools/registerSimilarityTools.ts` | none |
| `BACKTEST_TOOLS_ENABLED = false` | `workbench/backtest/tools/registerBacktestTools.ts` | none |
| `ALERT_TOOLS_ENABLED = false` | `workbench/alerts/tools/registerAlertTools.ts` | none |
| `WATCHLIST_TOOLS_ENABLED = false` | `workbench/watchlist/tools/registerWatchlistTools.ts` | none |
| `FILTER_DRAFT_TOOLS_ENABLED = false` | `workbench/screener/tools/registerFilterDraftTools.ts` | none |
| `FOLLOWUP_AUTHORING_TOOLS_ENABLED = false` | `workbench/followup/tools/registerFollowupTools.ts` | none |

This is a known, documented, program-level gap — `docs/plan/project.md`'s
Blockers table and `docs/architecture/new-webmcp-surface.md` both already
name it: **no ticket anywhere in EPIC-1006 through EPIC-1015 owns wiring
every epic's `build<Area>Tools()` into one composition root and flipping
the flags.** This audit corroborates that independently, by tracing every
`register*Tools` call site to confirm zero external callers.

Practically, this means most rows below carry a caveat: the code path
*exists* (real, merged, tested), but is not *live*. Per the capability-parity
spec's own "Doc-only tool" rule (a design-doc-named tool that was never
implemented counts as a drop, not a match) — a tool that **is** implemented
but is unreachable from the running app is functionally identical to a drop
*as of today*, and is recorded as such below, with a note that it flips to a
match once the composition-root ticket lands and the relevant flag is
flipped.

## Parity matrix

Capability rows follow `docs/design/pattern-research-workbench/spec.md`'s
Behavioral Specifications section headings.

| Capability | Legacy tool(s) | New-surface equivalent | Verdict |
|---|---|---|---|
| Study definition | `defineStudy` | `create_computed_field`/`create_custom_study` (`workbench/followup/tools/`, EPIC-1014) | **Partial, unreachable.** Code exists and is more capable (named computed fields + custom studies with their own validator), but `FOLLOWUP_AUTHORING_TOOLS_ENABLED = false` and it is not called from any route. Once wired: partial, not exact — legacy studies are referenceable directly inside pattern/setup expressions; confirm at wiring time whether computed fields compose into filter-tree conditions the same way. |
| Temporal setup definition | `defineSetup` (sequence of condition steps, each with a `within`/`sustained` trading-day window measured from the prior step) | `edit_filter_tree`'s `TemporalCondition` (`screener/conditions.ts`): `{ type: 'temporal', condition, event: 'crossed_above'\|'crossed_below'\|'became_true', withinBars }`, combined via `GroupNode`'s AND/OR | **Partial — confirmed by reading the type and validator, not assumed.** `TemporalCondition` is a single-predicate lookback ("did this condition cross/become-true within the last N bars"), evaluated independently per node; `GroupNode` combines multiple conditions with boolean AND/OR at one evaluation point. Neither expresses the legacy model's defining feature: **step 2's window is anchored to the date step 1 resolved on**, i.e. genuine ordered, inter-step sequencing. A screener can express "A happened recently AND B happened recently" but not "A happened, then within N days after *that specific occurrence*, B happened." This is a real, structural reduction, not just an unreached-code caveat — flipping `SCREENER_TOOLS_ENABLED` does not close this gap. |
| Instance search | `findInstances` (returns completed + partial/in-progress matches with completion scores, dedup rules for repeated/redundant occurrences) | `run_screener` (`webmcp/screener/runScreener.ts`) | **Partial, unreachable.** Even setting aside the temporal-matching gap above, `run_screener` evaluates the filter tree per-instrument at a point in time (a screener), not a search over historical `(ticker, date)` occurrences. No partial/in-progress-match concept, no completion score, no occurrence-level dedup rule — those are specific to sequential pattern matching over history, which the new surface does not model. Also unreachable today (`SCREENER_TOOLS_ENABLED = false`). |
| Instance sampling | `sampleInstances` (random/recent/best/worst over a result set) | none found | **Drop.** No sampling-strategy tool exists anywhere in the new surface; `get_screener_results` (live, wired) returns a paginated result set with no strategy-based sampling. |
| Outcome measurement | `measure` (arbitrary metric across a result set, compared against the same statistic over the broader universe; excludes partial instances, states how many were excluded) | `backtest_screener`/`get_backtest_results` (`workbench/backtest/tools/`, backed by `backend/domain/backtest_engine.py`'s `PortBacktestEngine`) | **Partial at best, unreachable today.** Read the actual engine: it computes forward-return distributions, drawdown stats, and rebalance-date match-frequency — a portfolio-style backtest of "buy every match, hold N days" — not an arbitrary metric-across-set-vs-universe-base-rate comparison. There is no generic "measure this statistic on this set vs. the universe" operation. `BACKTEST_TOOLS_ENABLED = false` and zero external callers. This is the capability the epic's Open Question 2 flagged in advance, and the flag confirms it: **a real, user-visible drop**, not a naming difference. |
| Instance splitting | `splitInstances` (winners/losers or by-condition child sets, each independently usable by other tools) | none found | **Drop.** No tool partitions a result set into labeled child sets. The backtest engine's return distribution is a different shape (aggregate stats over one run, not a set-of-sets an agent can hand to another tool). |
| Grid visualization | `showGrid`, `showTickerCharts`, panel-scoped histogram, individual panel close (human-clickable) | `results_table` panel kind (live), `capture_chart_setup`/chart panel kind (`CHART_TOOLS_ENABLED = false`, unreachable) | **Partial.** Results rendering exists and is live; small-multiples-at-anchor-date chart grids exist in code but are unreachable. No panel-scoped histogram action was found anywhere. Panel *removal* has an agent-side tool (`remove_panel`, live) but **no human-clickable close/remove control** — `panels/shell/PanelFrame.svelte` (the new panel chrome) has only a collapse/expand toggle, confirmed by reading the component; there is no close button. This is a real UI-affordance drop as of today, not a technicality — see also the Route Migration spec's "Surviving capability... reachable from the UI" requirement. |
| Instance focus | `focusInstance` (does not affect human's independent UI selection) | none found as a distinct concept | **Drop / not modeled.** The new surface has no separate "focus" state distinct from selection; `results/panel/selection.ts` is row-selection only (toggle a row's id in/out of a selected-id list), with no agent-driven "zoom to this one" operation independent of what the human has selected. |
| Human-side grid/result selection | Click a grid instance to select it (`GridPanel.svelte`'s `selectInstance`) | `results/panel/selection.ts`'s `toggleSelection`, wired into `setPanelSelection.ts`/results table row click | **Match, live.** Confirmed: this is part of the panel/results stack that *is* wired into `/workbench` today (unlike almost everything else in this matrix). Different UI shape (table row vs. small-multiples tile) but the underlying "human clicks, selection state updates, agent can read it" behavior survives. |
| Single-panel close (human-side) | Click one panel's close button; only that panel is removed | No human-clickable close button in `PanelFrame.svelte` (collapse/expand only) | **Drop, confirmed by reading the component.** Agent-side `remove_panel` tool exists and is live, but the human-facing affordance the legacy spec requires does not exist yet. |
| Shared workspace read (`getWorkspace`) | Full state incl. human's current focus/selection | `get_canvas_state` (EPIC-1006) | **Partial, and a documented pre-existing bug.** `docs/plan/project.md`'s Blockers table records that `get_canvas_state` can't project panel state for any of EPIC-1007's panel kinds — panel state lives in `doc.extensions['panel_system']`, and `normalizeWorkspace` silently drops unknown kinds when projecting into `doc.panels`/`layout`/`links`. An agent reading the new surface's workspace state today cannot see panels through this tool. Must be resolved (the closed `PanelKind` union needs opening) before this counts as parity, independent of any composition-root wiring. |
| Persistence across reload | Workspace state restored from `localStorage` on reload | `workbench/infra/workspaceRepository.ts`'s `createLocalWorkspaceRepository` | **Match** (mechanism-level). Not independently verified end-to-end in a browser in this audit — flagged for T-1015-3's browser-check gate. |
| Unified action log, human/agent attribution | Every human UI action and every agent tool call appended to one ordered, attributed log; visible at page bottom; persists across reload; clearable | `workbench/application/changeHistory.ts` | **Drop, confirmed by reading the model.** `changeHistory.ts`/`workspace.ts` record mutations for undo/revision purposes with no actor field at all — there is no way to say "a human did this" vs. "an agent did this." No `ActivityFeed`-equivalent component exists anywhere under `panels/`, `results/`, or `workbench/` (checked by filename search for `*Feed*`/`*Log*`/`*History*.svelte` — only the legacy `ActivityFeed.svelte` exists). This is a named, deliberate demonstration capability in the legacy spec with no replacement in progress under any current epic. |
| Manual tool-harness route (`/dev`) | Hand-invoke any tool with raw JSON, outside the human-actions UI | none | **Drop.** No equivalent dev/test route exists for the new surface. Low product impact (a developer convenience, not a researcher-facing feature) but it is a capability the legacy surface has today and the new one does not; listed for completeness per the ticket's explicit instruction to check it. |
| Workspace-status header (tool counts, bridge state) | `buildWebmcpStatus`: defined/available tool counts, four bridge states, click-to-reveal names, HTML comment for agent context | none | **Drop, and a gap against the design spec itself, not only against legacy.** `src/routes/workbench/+page.svelte` was read in full: it renders only a "Preparing workspace…" loading message, then `PanelContainer` — no status header, no tool counts, no bridge-state reporting. This capability is explicitly required by `docs/design/legacy-surface-cutover/spec.md`'s own Route Migration behavioral spec ("Status header... reports defined tool count, available tool count, and bridge state"), so this is not a question of whether to accept a drop — it is unbuilt work T-1015-3 must do regardless of what this gate decides. |
| Progressive tool availability | Tools requiring a result set (sampling, measuring, splitting, grid) are absent until a search produces one; the header's available-count updates live via `register.ts`'s diffing, no reload | `registerPanelTools()` registers all 14+2 tools in one static pass at page load; no diffing, no unregister, no observed state-gated re-registration anywhere in `panels/shell/` | **Drop, confirmed by reading the composition root.** This was flagged in advance as Open Question 3 and the epic's own author called it "a deliberate demonstration of the WebMCP `toolchange` story." The mechanism that implemented it (`register.ts`'s desired-vs-registered diff) retires with the rest of the legacy chain (see inventory) and nothing in the new surface reimplements it — every new tool group is either fully registered or fully absent, gated by a build-time flag, not runtime workflow state. This is a genuine product-behavior regression from the legacy surface's headline feature, not a wiring gap that disappears once flags flip. |
| Backend address resolution | Whitespace-trimmed, falls back to localhost default | `apiConfig.ts`'s `resolveApiBaseUrl` | **Match, exact, shared code.** Confirmed as genuinely shared infrastructure (see inventory) — both surfaces call the same function. |
| Save/recall/delete/browse named snapshots | `localStorage`-backed named snapshots, unsaved-changes guard | `save_workspace`/`restore_workspace_revision`/`get_change_history`/`undo_change` (`workbench/application/revisionService.ts`, EPIC-1006) | **Partial, unreachable.** A superset in intent (full revision history vs. named point-in-time snapshots) per the epic's own Open Question 3, but `WORKBENCH_TOOLS_ENABLED = false` and this module's register function has zero external callers. Not independently verified whether an unsaved-changes-guard equivalent exists; not found in `workbench/domain/` during this pass — flag for follow-up if this capability is accepted as in-scope for parity. |

## Drops and partial matches — for user sign-off

Everything below either has no new-surface equivalent today, or survives
only in materially reduced form. Grouped by whether flipping the known
feature flags and shipping the pending composition-root ticket would close
the gap, since that distinction changes what "sign-off" actually means for
each row.

**Structural gaps — flipping flags does not help; would need new design/code:**

1. Multi-step temporal setup matching with inter-step windows anchored to a
   specific prior occurrence. (Partial — single-predicate lookbacks only.)
2. Outcome measurement as arbitrary metric-vs-universe-base-rate comparison
   (`measure`). The backtest engine computes something related but
   differently shaped (forward-return/drawdown after a signal).
3. Instance splitting into labeled, independently-usable child sets
   (`splitInstances`). No equivalent operation exists.
4. Instance focus as a concept distinct from human selection
   (`focusInstance`). Not modeled.
5. Human-clickable single-panel close. Agent-side tool exists; UI affordance
   does not.
6. Unified, human/agent-attributed action log. No attribution field exists
   anywhere in the new surface's history model; no UI component exists.
7. Progressive tool availability (the `toolchange` demonstration). The new
   registration model is static; nothing observes workflow state to
   register/unregister tools at runtime.
8. Manual tool-harness route (`/dev`). No replacement; low impact.
9. Workspace-status header (tool counts, bridge state). Required by this
   epic's own design spec and not yet built at all — not a legacy-parity
   question so much as outstanding work.
10. `get_canvas_state` cannot see panel state (pre-existing, documented bug
    — closed `PanelKind` union). Blocks "shared workspace read" parity
    regardless of flags.

**Reachability gaps — the code exists and may close these once wired:**

11. Study definition (`create_computed_field`/`create_custom_study`) —
    behind `FOLLOWUP_AUTHORING_TOOLS_ENABLED`.
12. Instance search / setup search (`run_screener`, `edit_filter_tree`) —
    behind `SCREENER_TOOLS_ENABLED`, and still only a partial match per
    item 1 above even once wired.
13. Named snapshots vs. workspace revisions — behind
    `WORKBENCH_TOOLS_ENABLED`.
14. Grid/chart visualization (`capture_chart_setup`, chart panel kind) —
    behind `CHART_TOOLS_ENABLED`.
15. Instance sampling (`sampleInstances`) — no equivalent found in any tool
    group, wired or not; listed here rather than in the structural section
    only because a sampling strategy over `get_screener_results`'s paginated
    output is plausible future work behind the existing results surface,
    unlike items 1-10 which need new design thinking regardless.

## Go/No-Go Verdict

**NO-GO.**

Reasons, in order of severity:

1. **The composition-root wiring ticket does not exist.** This is not a
   new finding — `docs/plan/project.md`'s Blockers table and
   `docs/architecture/new-webmcp-surface.md` already document it, and this
   audit independently confirmed it by tracing every `register*Tools` call
   site. Without it, cutting over to "the new surface" today would ship a
   `/workbench` route with 16 of the spec's ~46 tools reachable and every
   flag-gated group silently dark. T-1015-2's own AC3 ("verified against
   code that actually exists... a tool named in a design doc but never
   implemented counts as a drop") applies with equal force to a tool that
   exists but is never registered.
2. **Two structural capability losses have no path to closing via wiring
   alone**: multi-step temporal setup matching, and outcome
   measurement/splitting (`measure`/`splitInstances`). These were the two
   hard cases the epic's authors flagged in advance, and both are
   confirmed real by reading the actual type definitions and engine code,
   not assumed.
3. **Progressive tool availability, the action log's human/agent
   attribution, human-side panel close, and the workspace-status header**
   are all either dropped or simply not yet built, independent of flags.

**What would change a no-go to a go:**

- File and land the composition-root ticket (owner: EPIC-1006 or EPIC-1015
  per the existing blocker note), flip every `_ENABLED` flag, and re-run
  this parity check's "reachability gap" rows against the now-live surface.
- Get explicit user sign-off on each of the ten structural-gap rows above —
  either "acceptable to drop" or "must be built before cutover" — since
  several (temporal sequencing, measure/split, progressive availability)
  were product-defining behaviors of the original hackathon submission, not
  incidental.
- Resolve the `get_canvas_state` panel-state bug, since it blocks agent
  read-access to the workspace on the new surface regardless of any other
  decision.
- Build the workspace-status header, since the epic's own design spec
  requires it for T-1015-3 independent of this gate's outcome.

Per this run's scope, none of the above is this agent's to build — T-1015-3
onward is explicitly out of scope for this pass, and deletion must not
proceed until the orchestrator brings this verdict to the user.

## Addendum: one Blockers-table claim in `docs/plan/project.md` is stale

`docs/plan/project.md`'s Backlog entry for EPIC-1015 (line ~80-81) says
`render.yaml`'s health check "still points at the route EPIC-1015 plans to
delete" (i.e. `/api/spike/ping`). **Verified false as of this branch**:
`render.yaml` line 57 reads `healthCheckPath: "/health"`, and
`backend/api/routes/health.py` (T-0016-2) is a real liveness endpoint whose
own docstring says it "deliberately imports nothing from api.routes.spike
or api.routes.research," specifically so retiring either does not break it.
This hazard is already resolved by EPIC-0016 and should not block T-1015-4;
`docs/plan/project.md` needs its Blockers/Backlog table updated to drop this
item, but that edit is outside this ticket's scope (T-1015-1/T-1015-2 only)
and is left for the orchestrator.
