# T-1007-6: Panel container rendering and tool wiring

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Open
**Depends on**: T-1007-5
**Blocks**: —

## Description

The integration ticket. Everything before it is testable but invisible:
this one renders the panel workspace on the logical grid, delegates each
panel's body to whatever its kind registered, honours hidden and
collapsed state, propagates linked-channel changes to the right panels,
and registers the five tools so an agent can drive all of it live in the
browser.

Done looks like: an agent adds a chart and a results table, links them on
result selection, arranges them side by side, collapses one, removes the
other, and undoes that — and a human watching the page sees each step
happen.

## User Story

As a researcher watching my agent work,
I want to see panels appear, move, connect, collapse, and disappear on
the page as the agent composes my workspace,
so that the agent's changes are something I can follow and trust rather
than a description I have to take on faith.

## Acceptance Criteria

1. The workspace renders every visible panel at its stored grid position
   and size, mapping logical grid cells onto the viewport.
2. A panel's body is rendered by the component its kind registered; the
   container itself contains no knowledge of any specific panel kind.
3. A panel renders its title, and a collapsed panel renders as a header
   only while retaining its stored size, restored on expand.
4. A hidden panel is not rendered and leaves no gap in the layout, while
   keeping its position for when it is shown again.
5. Adding, updating, laying out, linking, and removing panels through the
   agent-facing tools is reflected on the page without a reload.
6. A change on a linked channel updates every other panel in that
   channel's group and no panel outside it, with the receiving panel's
   kind — not the container — deciding how to apply the value.
7. The five panel tools are registered against the browser's WebMCP
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
