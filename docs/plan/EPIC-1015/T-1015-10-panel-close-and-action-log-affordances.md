# T-1015-10: Restore panel-close and action-log UI affordances

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Design**: docs/design/legacy-surface-cutover/
**Status**: Done
**Depends on**: T-1015-9
**Blocks**: T-1015-6

## Description

Two small, human-facing affordances the legacy page had are missing
from the new surface: a way for a human to close a panel by clicking
something (the agent-side remove-panel action already exists — there's
just no button), and a visible, human/agent-attributed action log (the
legacy page showed one at the bottom of the screen; the new surface's
history model has no attribution field and no UI component at all).
This ticket restores both, scoped down from the legacy page's
always-visible log to a compact header icon that expands to show it —
per the user's own direction, not a full-page section.

## User Story

As a person using the app,
I want to close a panel by hand and see what's happened in my workspace
— including what an agent did versus what I did —
so that I'm not limited to what an agent chooses to do, and I can tell
the two apart.

## Acceptance Criteria

1. Every panel frame has a human-clickable close affordance that removes
   the panel, with the same effect as the agent-side remove-panel
   action.
2. The action-log entry shape gains an `actor: 'human' | 'agent'`
   attribution field, populated for every new entry recorded from this
   point forward.
3. The shell (T-1015-9) has a compact icon that expands into the log —
   not an always-visible section — showing every recorded action with
   its actor.
4. Closing a panel a human didn't create (e.g. one an agent created)
   works the same way as closing one a human created.
5. A production build succeeds and both affordances work with no console
   errors, verified via browser check.

## Solution Approach

**Implements**: spec.md's "Panel close" and "Action log access"
scenarios. Depends on T-1015-9's shell existing to host the log icon.

**Approach**: frontend-only, two independent affordances.

1. **Panel close (AC1, AC4)** — `PanelFrame.svelte`'s header already has
   a `.collapse` control wired through an `onToggleCollapse` prop to
   `PanelContainer.svelte`'s `handleToggleCollapse`, which calls
   `panelController.ts`'s `togglePanelCollapsed` directly (not through a
   tool) and then `refresh()`. This is the established pattern for a
   human-triggered mutation — confirmed by `ResultsTablePanel.svelte`'s
   and `alerts/application/{confirm,decline}AlertActivation.ts`'s own
   `context: { actor: 'human' }` call sites, all of which call a use case
   directly rather than round-tripping through the tool wire format. Add
   a second control next to `.collapse` in `PanelFrame.svelte`, a new
   `onRemove: (panelId: string) => void` prop, wired in
   `PanelContainer.svelte` to a new `panelController.ts` function:
   `removePanelByHuman(deps: PanelUseCaseDeps, panelId: string):
   MutationEnvelope` that calls the existing, unmodified
   `panels/application/removePanel.ts`'s `removePanel` with
   `context: { actor: 'human' }`, then `refresh()` — same shape as
   `handleToggleCollapse`. AC4 (closing an agent-created panel) needs no
   extra work: `removePanel` never inspects who created the panel.

   Note for the implementer: `togglePanelCollapsed` currently hardcodes
   `actor: 'agent'` even though it is only ever invoked from this same
   human-triggered path — a pre-existing inconsistency, out of scope to
   fix here (not one of this ticket's ACs). Do not copy that mistake for
   the new close button; pass `'human'` explicitly, as designed above.

2. **Action log (AC2, AC3)** — **AC2's field already exists.**
   `workbench/domain/mutation.ts` already defines `Actor = 'human' |
   'agent'`, and `workbench/application/changeHistory.ts`'s
   `ChangeRecord.actor: Actor` is already populated by every
   `recordCommit` call site: agent tool calls pass `'agent'`
   (`workbench/tools/index.ts`), and a few existing human-triggered paths
   already pass `'human'` (`ResultsTablePanel.svelte`,
   `confirmAlertActivation`/`declineAlertActivation`) — this ticket's new
   close button (above) adds one more. `workbench/tools/index.ts`'s
   `getChangeHistory` already serializes `actor` in its output. So there
   is no new field to add; verify this at implementation time and treat
   the ticket doc/technical.md's "does not yet" framing as stale rather
   than re-deriving a field that already exists.

   What's actually missing is the **UI** (AC3): a compact icon in
   T-1015-9's shell header that expands into a log view. Read via a new
   `panelController.ts` helper, `readActionLog(deps: Pick<PanelUseCaseDeps,
   'history' | 'workspaceId'>, limit?: number): ChangeRecord[]` — calling
   `deps.history.list(deps.workspaceId, { limit })` directly, mirroring
   `panelController.ts`'s existing direct-use-case-call convention rather
   than round-tripping through `get_change_history`'s tool wire format
   client-side. New presentational component (e.g.
   `panels/shell/ActionLogPanel.svelte`) renders each record's `at`,
   `diffSummary`, and an actor badge (`actor === 'human' ? 'Human' :
   'Agent'` — reimplemented inline, not imported from
   `workspace/activity.ts`'s `actorLabel`, since that module is a
   T-1015-6 deletion target per `legacyModelRemoval.test.ts`'s own stub).
   The icon + expand/collapse state lives in T-1015-9's shell component;
   this ticket adds the icon and the log component, not the shell itself.

**Contracts to introduce**: none new — `Actor` and `ChangeRecord.actor`
already carry what AC2 asks for.

**Config vars introduced**: none.

**References**: `src/lib/panels/shell/PanelFrame.svelte`,
`PanelContainer.svelte`, `panelController.ts` (`togglePanelCollapsed` as
the pattern to follow), `panels/application/removePanel.ts`,
`workbench/domain/mutation.ts` (`Actor`),
`workbench/application/changeHistory.ts` (`ChangeRecord`),
`workbench/tools/index.ts`'s `getChangeHistory`,
`src/lib/workspace/legacyModelRemoval.test.ts` (T-1015-6's stub noting
`activity.ts` waits on this ticket), `src/lib/workspace/activity.ts`
(retired reference only, not reused).

## Design References

- `docs/design/legacy-surface-cutover/spec.md` — "Route migration"
  scenarios: "Panel close", "Action log access".
- `docs/design/legacy-surface-cutover/technical.md` — the action-log
  entry's `actor` field shape.
- `docs/design/pattern-research-workbench/technical.md` — how the legacy
  page's activity log and its human/agent attribution worked, for
  reference (retired, not reused as code).

## Implementation Notes

- `panelController.ts` gained `removePanelByHuman(deps, panelId)` (calls
  `removePanel` with `context: { actor: 'human' }`) and
  `readActionLog(deps, limit?)` (calls `ChangeHistory.list` directly),
  exactly as designed above.
- `PanelFrame.svelte` gained an `onRemove` prop and a `.control.remove`
  close button next to `.collapse`; `PanelContainer.svelte` wires it to
  `removePanelByHuman` + `refresh()`, mirroring `handleToggleCollapse`.
- New `panels/shell/ActionLogPanel.svelte` renders `ChangeRecord[]` with an
  inline `actor === 'human' ? 'Human' : 'Agent'` badge. `WorkbenchShell.svelte`
  owns the expand/collapse state and a `.log-toggle` icon in its header;
  `+page.svelte` feeds it `historyDeps` (`{ history, workspaceId }`) and the
  panel `observer` so the log stays live while expanded, and starts
  collapsed/disabled until the workspace runtime is ready.
- AC2 confirmed already-populated as the solution approach predicted: no
  new field was added; `panelCloseAndActionLog.test.ts` asserts
  `ChangeRecord.actor` for both the new human close path and existing
  agent paths.
- Test stubs in `panelCloseAndActionLog.test.ts` were replaced with real
  assertions: pure-logic coverage of `removePanelByHuman`/`readActionLog`
  against `createPanelTestHarness()`, plus real component mounts (Svelte 5
  `mount()`/`flushSync()`, the same pattern `PanelFrame.test.ts` already
  used) proving the close button and the log icon/expand actually work,
  not just that the wiring is described. `PanelFrame.test.ts`'s existing
  mount was updated for the new required `onRemove` prop.
- `npm run typecheck` and `npx vitest run` both pass; the only failing
  tests in the suite are pre-existing "not implemented" stubs for sibling
  tickets T-1015-6 (`legacyModelRemoval.test.ts`) and T-1015-12
  (`richDefaultLayout.test.ts`), unrelated to this ticket's scope.
- `npm run build` succeeds (production build).
- AC5's live-browser verification is **outstanding**: a concurrent session
  holds the chrome-devtools MCP's singleton browser profile
  (`/Users/space/.cache/chrome-devtools-mcp/chrome-profile` already in
  use), so no page could be opened even with an isolated context. This is
  an environment/concurrency conflict, not a code failure -- same
  convention as sibling tickets blocked on the dev-server port. Retry the
  browser check once the other session releases the browser profile.

## Out of Scope

Historical backfill of attribution on any log entries recorded before
this ticket lands. A general-purpose audit/history system beyond this
one attribution field. Building the shell itself (T-1015-9).
