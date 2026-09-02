# T-1007-6: Panel container rendering and tool wiring

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Open
**Depends on**: T-1007-5
**Blocks**: —

## Description

The integration ticket. Everything before it is testable but invisible:
this one renders the panel workspace on the logical grid, delegates each
panel's body to whatever its kind and active renderer registered, honours
hidden, collapsed, and maximized state, propagates linked-channel changes
to the right panels, and registers the fourteen tools so an agent can
drive all of it live in the browser.

Done looks like: an agent creates a chart and a results table, links them
on result selection, arranges them side by side with `apply_layout_template`,
collapses one, switches the chart to `chart_grid` and back, maximizes and
un-maximizes the table, removes the chart, and undoes that — and a human
watching the page sees each step happen.

## User Story

As a researcher watching my agent work,
I want to see panels appear, move, connect, collapse, and disappear on
the page as the agent composes my workspace,
so that the agent's changes are something I can follow and trust rather
than a description I have to take on faith.

## Acceptance Criteria

1. The workspace renders every visible panel at its stored grid position
   and size, mapping logical grid cells onto the viewport.
2. A panel's body is rendered by the component its kind and active
   renderer registered; the container itself contains no knowledge of any
   specific panel kind or renderer.
3. A panel renders its title, and a collapsed panel renders as a header
   only while retaining its stored size, restored on expand. A maximized
   panel renders at full grid size without altering any panel's stored
   footprint, and un-maximizing restores the prior rendered arrangement
   exactly.
4. A hidden panel is not rendered and leaves no gap in the layout, while
   keeping its position for when it is shown again.
5. Creating, duplicating, configuring, laying out, splitting, linking,
   selecting, and removing panels through the agent-facing tools is
   reflected on the page without a reload.
6. A change on a linked channel updates every other panel in that
   channel's group and no panel outside it, with the receiving panel's
   kind — not the container — deciding how to apply the value.
7. The fourteen panel tools are registered against the browser's WebMCP
   bridge and are reported as available to the agent.
8. Undoing a mutation through its undo token restores the rendered
   workspace to its prior appearance.
9. A panel kind that fails to load or throws while rendering leaves the
   rest of the workspace usable and shows an error in that panel's frame
   rather than blanking the page.
10. The existing page, the existing 11 tools, and
    `src/lib/workspace/store.ts` are unmodified, and the app builds and
    runs.

## Design References

- `docs/design/panel-system/spec.md` — the full behavioral spec this
  ticket makes observable
- `docs/design/panel-system/technical.md` — the data flow for a linked
  change and the registry's lazy body loader
- `src/lib/webmcp/register.ts` — how tools are registered against
  `document.modelContext`, how ownership across mounts is tracked, and
  how the available-tool set is reported to the page
- `src/lib/webmcp/status.ts` — how bridge/tool availability is surfaced
  to the human
- `src/lib/workspace/GridPanel.svelte` and
  `src/lib/workspace/WorkspaceView.svelte` — existing panel-rendering
  conventions to follow (props, `$state`, scoped styles), read for
  reference only
- `src/routes/+page.svelte` — the existing page, for how the current
  surface is mounted

## Technical Considerations

- The new container must be reachable without changing the existing page.
  Prefer a new route for the new surface; if it must appear on the
  existing page, it goes behind a feature flag per the project's dead
  code policy — new behavior in existing code requires one.
- Components stay thin: any logic worth testing belongs in the Wave 1–3
  modules, matching this codebase's existing split between untested thin
  wiring components and unit-tested logic modules.
- The registry's body loader is asynchronous; the container needs a
  loading and an error state per panel frame (AC9).
- Rendering must derive entirely from workspace state, so an agent-driven
  change and a human-driven change take the same path.

## Out of Scope

Real panel bodies for the eight kinds — sibling epics replace the
placeholder registrations. Drag-to-resize and responsive breakpoint
behavior. Retiring the existing surface (EPIC-1015).

## Solution Approach

New route, new files only, under `src/lib/panels/shell/` — nothing in
`src/routes/+page.svelte`, `src/lib/webmcp/`, `src/lib/workspace/`, or any
existing `src/lib/panels/` file is touched (AC10). A brand-new route is
new-files-only under the project's dead-code policy, so no feature flag.

**`panelController.ts`** carries every testable behavior; the `.svelte`
files stay thin wiring, matching the codebase's existing split:

- `initializeWorkspace(deps)` decides create-vs-load by asking the
  repository for an active workspace id, *not* by inspecting panel count
  — the gate T-1007-9 needs. Creating calls the same building blocks
  `workbench/tools/index.ts`'s `create_workspace` tool uses
  (`recordCommit` + `emptyWorkspace`, imported read-only from
  `workbench/application/changeHistory` and `workbench/domain/workspace`)
  so the resulting document is indistinguishable from one made through
  the real tool — no change to EPIC-1006's contract, no new tool.
  Returns `{ workspaceId, justCreated }`; `justCreated` is a property of
  *which code path ran*, never derived from `panels.length`.
- `seedDefaultWorkspace(panelDeps, justCreated)` — T-1007-9; see that
  ticket's Solution Approach.
- `readSnapshot(deps)` reads `PanelSystemState` via the existing
  `readPanelState` export and pairs it with the current maximized id via
  `renderedRects` (AC1, AC3, AC4) — one function, no component-side
  derivation.
- `resolvePanelBody(definition)` awaits `definition.component()` inside a
  try/catch and classifies the settled value: a function, or an object
  whose `default` is a function, is `{ kind: 'component', value }`;
  anything else (including every EPIC-1007 placeholder, whose
  `component()` resolves to `{ placeholderKind }`) or a thrown/rejected
  load is `{ kind: 'placeholder' }` / `{ kind: 'error', message }`. Pure
  and directly testable without mounting Svelte (AC2, AC9).
- `broadcastLinkedValue(controller, channel, sourcePanelId, value)` calls
  `propagationTargets` and updates an in-memory `linkedValues` map
  (`panelId -> { channel, value }`), scoped to exactly the channel's
  group — this is client-render state layered over the workspace, the
  same shape as `maximized`, not a workspace mutation (AC6). The
  container has no per-kind branch: every placeholder body receives
  whatever arrived for its own id through one uniform prop and decides
  for itself whether/how to show it (here: display it), which is what
  "the receiving panel's kind decides" means when every shipped kind is
  the same placeholder.
- A small observable store (`subscribe`/`notify`) so a tool call —
  routed through a thin wrapper this module puts around each
  `ToolSpec.execute` — triggers `readSnapshot` again and pushes the
  result to every subscriber; this is how AC5's "no reload" and AC8's
  "undo re-renders" both work: every mutation, human or agent, ends at
  the same `notify()`.

**`gridStyle.ts`** — pure functions mapping a `GridRect` to CSS: the
container's own style string (`display:grid; grid-template-columns:
repeat(6, 1fr); grid-template-rows: repeat(4, 1fr)`) and a panel's
`grid-column`/`grid-row` from its zero-based rect (T-1007-8 AC4). Kept
separate from `panelController.ts` so the CSS-mapping tests stand apart
from the workspace-logic tests.

**`registerPanelTools.ts`** is the composition root: builds real infra
(`createLocalWorkspaceRepository`, `createRevisionService`,
`createChangeHistory`, `createIdempotencyCache`, `createIdSequencer`,
fresh `createPanelRegistry` + `registerDefaultPanelKinds`, fresh
`createSourceRendererRegistry` + `registerDefaultSourceRendererTypes`,
fresh `createLayoutTemplateRegistry` + `registerDefaultLayoutTemplates`,
`createMaximizedPanelState()`), calls `panelController.initializeWorkspace`
and (T-1007-9) `seedDefaultWorkspace`, builds `PanelToolDeps`, and
registers `buildPanelTools(deps)` — wrapped to call the controller's
`notify()` after each execute — against `ensureModelContext()`. Mirrors
`workbench/tools/registerWorkbenchTools.ts`'s `createDefault*Deps()` +
register-function shape; no flag, since this route is the new-files path
that shape was written for.

**Svelte layer**: `PanelContainer.svelte` subscribes to the controller,
renders `containerGridStyle()` as the outer grid, and for each rendered
rect (from `renderedRects`, so hidden panels are already excluded and a
maximized panel already occupies the full grid — AC3, AC4) renders a
`PanelFrame` positioned via `gridStyle.ts`. `PanelFrame.svelte` renders
the title bar, a collapse toggle (calling `configurePanelView` through
the controller then `notify()`), and — unless collapsed — a body region
wrapped in `<svelte:boundary>` (Svelte 5) so a real body that throws
during render is caught at that one frame, not the page (AC9's render-time
half; `resolvePanelBody`'s try/catch covers the load-time half).
`PlaceholderPanelBody.svelte` is the fallback: shows kind, active
renderer, and bound/unbound state, and shows anything recorded via
`broadcastLinkedValue` for this panel.

**Route**: `src/routes/workbench/+page.svelte` calls
`registerPanelTools()` once on mount and renders `PanelContainer` once it
resolves; `src/routes/+page.svelte` is untouched (AC10).

**Undo (AC8)**: `undo_change` is an EPIC-1006 workbench tool, not one of
the fourteen panel tools, so it is out of this ticket's registration list
per the design doc's tool inventory — but the same repository backs both,
so calling it through the same `notify()`-wrapped path (exposed as a
`panelController.undo(undoToken)` helper that calls the workbench
`undo_change` logic against the shared repository/history/clock) re-renders
the workspace to its prior state through the same read path as any other
mutation. Tested at the controller level: apply a change, undo it,
confirm the snapshot matches the pre-change snapshot.
