# T-0027-2: Drag a results row onto the canvas

**Epic**: EPIC-0027 (Screener Widget and Drag-to-Chart)
**Design**: docs/design/panel-system/
**Status**: Done
**Depends on**: —
**Blocks**: —
**Resolves**: #27

## Description

Lets a human drag a row from the results table directly onto the canvas
to create or bind a chart, without going through the agent. Every
behavioral branch reuses an existing, already-specified panel-system rule
rather than introducing a new one:

- Drop on an empty grid cell → creates a chart panel there (`create_panel`,
  same use case an agent's tool call uses), at the exact cell dropped on
  — not wherever auto-placement would otherwise choose.
- Drop on an existing chart panel, bound or unbound → rebinds its source
  (`bind_panel_source`'s existing "bind or rebind" semantics — nothing
  new).
- Drop on a panel/renderer that doesn't accept an instrument source →
  rejected via the existing source-type validation `bind_panel_source`
  already enforces.
- Drop when no empty cell exists → rejected via the existing "grid is
  full" case already in the panel-system spec's layout behavior.

## User Story

As a human browsing screener results,
I want to drag a row onto the canvas to see it as a chart,
so that turning a result into a chart doesn't require asking the agent.

## Acceptance Criteria

1. Dropping a results row on an empty grid cell creates a chart panel at
   that exact cell, bound to that row's instrument.
2. Dropping a results row on an existing chart panel (whether empty or
   already bound to a different instrument) rebinds that panel's source
   to the dropped instrument; no new panel is created.
3. Dropping on a panel kind/renderer that doesn't accept an instrument
   source is rejected — shown as a not-allowed drop target — and changes
   nothing.
4. Dropping when the grid has no empty cell is rejected with the same
   semantics as the existing agent-facing "grid is full" case.
5. The resulting panel/binding is indistinguishable from one produced by
   the equivalent agent tool call (`create_panel` / `bind_panel_source`) —
   same use case, same mutation shape.

## Out of Scope

- Dragging multiple selected rows at once — "make charts from the top 5"
  stays a text/agent path for MVP.
- Drag-to-resize or any other drag gesture — already a panel-system
  non-goal, unrelated to this ticket.

## Solution Approach

Native HTML5 drag-and-drop, carrying a generic `PanelSourceRef` (the exact
`{ type, ref }` shape `createPanel`/`bindPanelSource` already accept as
`request.source`) on a dedicated MIME type — so the panel-system's own drop
handling never needs to know "results row" or "instrument" as concepts;
`bindPanelSource`'s existing `validateSource` is still the one place
acceptance is decided, for this entry point exactly as for the agent's
tools.

- `src/lib/panels/domain/dragSource.ts` — `PANEL_SOURCE_DRAG_MIME`,
  `serializePanelSourceDrag`/`parsePanelSourceDrag` (never throws on a
  malformed/foreign payload).
- `src/lib/results/panel/resultRowDrag.ts` — `resultRowToPanelSource`
  builds the `instrument` source ref from a `ResultRow`. This project has
  no live reference-data source (see `chart/tools/resolveTicker.ts`'s own
  header): a result's `instrumentId` is already canonical, but `exchange`/
  `assetType` aren't carried on `ResultRow`, so this follows
  `resolveTicker.ts`'s own established convention — `exchange: 'XUNK'`
  (its own sentinel), `assetType: 'equity'` — rather than inventing a new
  one. **Flagged for review**: this is a real gap (dragged charts render
  with a fabricated exchange/asset type) inherited from a project-wide
  constraint, not introduced by this ticket.
- `src/lib/results/panel/ResultsTableRow.svelte` — `draggable`, sets the
  drag payload via `dragstart`.
- `src/lib/panels/shell/dropGeometry.ts` — pure `resolveDropCell(point,
  containerBounds, columns, rows)`, mapping a raw drop point to a
  `GridPosition` using the same uniform-fraction geometry `gridStyle.ts`
  renders.
- `src/lib/panels/shell/panelController.ts` — two new human-triggered
  use-case wrappers, matching the existing `removePanelByHuman`/
  `resetLayoutByHuman` pattern (actor: 'human', same use case an agent tool
  calls):
  - `bindPanelSourceFromDrop(deps, panelId, source)` → `bindPanelSource`
    (AC2, AC3, AC5).
  - `createChartFromDrop(deps, source, anchor, occupied)` → `createPanel`
    with `kind: 'chart'` and an explicit `rect` built from the kind's own
    `defaultSize` anchored at the dropped-on cell (AC1) — a bare 1x1 rect
    at the drop point would fail chart's 2x2 `minSize`, so "the exact cell
    dropped on" means the panel's top-left corner, not a 1x1 footprint.
    When `occupied` covers every cell (`computeEmptyCells` is empty),
    `rect` is omitted so `createPanel`'s own auto-placement raises the
    identical `grid_full` `PanelOperationError` agent-driven `create_panel`
    would (AC4), reused rather than reimplemented.
- `src/lib/panels/shell/PanelFrame.svelte` — `data-panel-id`/
  `data-panel-kind` on the panel's root element, the drop target's DOM hit
  test.
- `src/lib/panels/shell/PanelContainer.svelte` — `ondragover`/`ondrop` on
  the container (never on the empty-cell outlines, which stay
  `pointer-events: none` by deliberate hotfix/empty-grid-canvas design and
  so are unreachable drop targets). `ondragover` sets `dropEffect: 'none'`
  over a panel whose `bindingTypes` doesn't include `'instrument'` (AC3's
  "shown as a not-allowed drop target"). `ondrop` resolves the target via
  `closest('[data-panel-id]')` (rebind) or `resolveDropCell` (create), and
  catches `PanelOperationError` from either controller call — a rejection
  changes nothing rather than surfacing as an uncaught error.

Tests: `dragSource.test.ts`, `resultRowDrag.test.ts`, `dropGeometry.test.ts`
(pure); `ResultsTableRow.test.ts` (drag payload);
`panelController.dropOnCanvas.test.ts` (the two controller functions
against a harness with the real chart kind + real `instrument` source
type); `PanelContainer.dropOnCanvas.test.ts` (end-to-end: real mounted
component, simulated drop events, one test per AC1/AC2+AC5/AC3).
