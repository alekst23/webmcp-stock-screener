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
