# T-0020-11: Human-triggered "Run" action in the filter panel

**Epic:** EPIC-0020
**Status:** Done
**Depends on:** T-0020-10

## Goal

`FilterBuilderPanel.svelte` is fully read-only today — there is no way for a human
to run the current screener without an agent calling `run_screener`. This was
observed live (2026-09-04): a user asked "why isn't there a button that does
this?" `docs/design/screener-core/spec.md`'s Non-Goal ("human editing... is
agent-driven only") is scoped to *editing* the screener definition, not *running*
it — this ticket adds execution only, and does not touch that non-goal.

Follow the existing human-action precedent in `src/lib/panels/shell/panelController.ts`
(`createChartFromDrop`, `removePanelByHuman`): call the same execution path the
`run_screener` tool uses (including T-0020-10's create-or-rebind step), tagged
`actor: 'human'`, then refresh. See `docs/design/workbench-composition-root/spec.md`'s
"Human-triggered run" section for the full behavioral spec.

## Acceptance criteria

- A "Run" control appears in `FilterBuilderPanel.svelte`'s header/toolbar area.
- Clicking it while a screener is currently defined runs that screener through the
  same execution path `run_screener` uses, producing/recycling the results panel
  per T-0020-10.
- While a run triggered by this control is in flight, the control is disabled and
  shows a running/loading state; a second activation during that window does not
  trigger a second concurrent run.
- When no screener is currently defined (`WorkspaceDocument.screenerId` is unset),
  the control is disabled with an explanation (e.g. a tooltip) rather than being
  clickable and failing.
- The run is recorded in the workspace's action log/activity feed the same way an
  agent's `run_screener` call is, attributed to the human actor (e.g. distinguishable
  from an agent-run entry by actor, matching the existing `actor: 'human'` /
  `actor: 'agent'` convention).
- A test proves the disabled-when-undefined state, the in-flight disabled state,
  and that a successful click produces an action-log entry attributed to the human
  actor.

## Solution Approach

Implements the "Human-triggered run" scenarios from
`docs/design/workbench-composition-root/spec.md`. Depends on T-0020-10 landing
first (the create-or-bind path this control triggers).

- Add a `runScreenerByHuman(deps, ...)` function to
  `src/lib/panels/shell/panelController.ts`, alongside `removePanelByHuman` /
  `createChartFromDrop` (~line 325-390), following the exact same shape: calls
  the same execution `run_screener`'s tool handler performs (evaluate via the
  injected `ScreenerEvaluationPort`, `runStore.putRun`, then T-0020-10's
  create-or-rebind), tagged `context: { actor: 'human' }`. `run_screener`'s
  `execute()` in `runScreener.ts` is currently only reachable through the tool
  wire boundary (`rawInput: unknown`) — this new function should call the same
  underlying pieces `execute()` calls (evaluation port, `runStore.putRun`,
  `bindRunToResultsPanel`) directly with typed arguments, not round-trip through
  the tool's JSON wire shape, matching how other `panelController.ts` human
  actions call use cases directly rather than through a tool's wire format.
- `FilterBuilderPanel.svelte`: add a header "Run" button. Wire it to call the new
  `runScreenerByHuman` (via whatever prop/context `PanelContainer.svelte` already
  threads action functions through to panel bodies — follow the pattern
  `removePanelByHuman`/chart-drop actions already use to reach their panel
  components). Button states:
  - Disabled + explanatory tooltip when `doc.screenerId` is unset.
  - Disabled + loading/spinner state while a run triggered by this control is
    in flight (track in local component state; re-enable on completion or
    error).
  - Otherwise enabled.
- Action-log entry: `bindRunToResultsPanel`/`bindPanelSource` already record
  through `RevisionService`/change-history when `context.actor` is set — confirm
  the action log's existing read path (`readActionLog` in `panelController.ts`)
  surfaces the `actor` field so a human-run entry is visually distinguishable
  from an agent one; if the log's rendering doesn't already show actor, add it
  there rather than inventing a separate log entry format.
- No config vars, no new contracts, no mock stubs.

### Contracts to define

None — new functions and UI wiring only, reusing `run_screener`'s existing
execution pieces and the panel system's existing human-action/action-log
conventions.

## Implementation Notes

**The actor-plumbing wrinkle.** `bindRunToResultsPanel` (runScreener.ts) took
an added `actor: Actor` parameter (no default — every call site now states
its actor explicitly) and was exported; its `deps` parameter was narrowed
from the full `WorkbenchDeps` to `Pick<WorkbenchDeps, 'repository' |
'revisions' | 'history' | 'clock' | 'ids'>` (the only fields it actually
reads), so `panelController.ts` could pass a `PanelUseCaseDeps`-shaped object
directly instead of assembling a fake `WorkbenchDeps`. `execute()`'s own call
site now passes `'agent'` explicitly — run_screener's agent-facing behavior
and its full pre-existing test suite (21/21) are unchanged. The new
`runScreenerByHuman` in `panelController.ts` replicates `execute()`'s own
orchestration (read the current screener, mint a run id, call
`ScreenerEvaluationPort.execute`, `PinnedRunStore.putRun`, then
`bindRunToResultsPanel(..., 'human')`) directly against typed arguments
rather than round-tripping through `run_screener`'s JSON tool-wire shape —
per the ticket's own Solution Approach.

**Concurrency guard.** Rather than relying solely on Svelte component-local
state to prevent a second concurrent run (which the ticket's own testing
note rules out testing directly, since this repo has no
`@testing-library/svelte`), `runScreenerByHuman` itself is single-flight:
a `WeakMap` keyed by the caller's `RunScreenerByHumanDeps` object caches the
in-flight promise, so two activations before the first settles share one
execution and one result. `FilterBuilderPanel.svelte`'s local `running`
`$state` boolean still drives the disabled/spinner UI affordance the AC
asks for, but the actual "never a second concurrent run" guarantee is
enforced at the function level, where it's directly testable.

**Wiring order.** `FilterBuilderPanel`'s runtime-deps singleton
(`filterBuilderPanelContext.ts`) is set at panel-kind registration time
(`createFilterBuilderPanelKindDefinition`, inside `createPanelShellRuntime`)
with only `useCaseDeps` — at that point the screener tool group's
`ScreenerEvaluationPort`/`PinnedRunStore` don't exist yet (they're built
later, in `workbenchCompositionRoot.ts`'s `buildScreenerDeps` call). A new
`FilterBuilderPanelRunDeps` (`evaluationPort`, `runStore`, `observer`) was
added as an optional second field (`run?`) on the runtime-deps interface,
filled in by a new `setFilterBuilderPanelRunDeps()` call from
`registerWorkbenchComposition()` once `screenerDeps` is built — always
before `/`'s `PanelContainer` (and this lazily-loaded panel body) ever
mounts, since `+page.svelte` awaits the whole composition first. The
`evaluationPort` instance is now resolved once in `registerWorkbenchComposition`
and reused for both `run_screener` and the human Run control, instead of
building two separate adapter instances.

**Test coverage** (`src/lib/panels/shell/runScreenerByHuman.test.ts`):
disabled-when-no-screener (function returns `no_screener`, engine never
called), in-flight prevents a second concurrent evaluation (a deferred fake
port proves only one `execute()` call happens across two overlapping
activations), a successful run creates-or-recycles the results panel
(T-0020-10) and records the bind/create as `actor: 'human'` in the action
log, and a refusal is forwarded without binding a panel. Also updated
`FilterBuilderPanel.test.ts`'s pre-existing AC4 assertion ("no controls that
mutate the screener") to allow exactly the new Run control, since AC4 is
about the screener *definition*, not execution (this ticket's own Goal
section).
