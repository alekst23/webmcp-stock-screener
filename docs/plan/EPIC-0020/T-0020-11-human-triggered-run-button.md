# T-0020-11: Human-triggered "Run" action in the filter panel

**Epic:** EPIC-0020
**Status:** Open
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
