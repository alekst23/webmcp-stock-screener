# T-1003-2: Individual panel close

**Epic**: EPIC-1003 (Panel Action Set)
**Design**: docs/design/pattern-research-workbench/
**Status**: Open
**Depends on**: —
**Blocks**: —
**Issue**: #3

## Description

Today the only way to remove a panel is `ChartToolbar`'s "Clear panels,"
which wipes every open panel and resets focus. This ticket adds the
ability to close a single panel without affecting the others — there is
currently no store-level function for removing one panel by id (only the
engine's `clearPanels()`, which empties the whole array).

## User Story

As a user with several open chart panels,
I want to close just the one I no longer need,
so that I don't have to clear my whole workspace to tidy it up.

## Acceptance Criteria

1. Each open panel has a control to close/remove just that panel.
2. Closing one panel does not affect any other open panel.
3. If the closed panel was focused, focus is cleared (mirrors
   `clearPanels()`'s existing focus-reset behavior for the single-panel
   case).
4. "Clear panels" continues to remove all panels at once, unchanged.

## Design References

- `docs/design/pattern-research-workbench/spec.md` — "Individual panel
  removal" scenario (feature #7)
- `src/lib/workspace/store.ts` — existing panel/focus state shape
- `src/lib/workspace/apiEngine.ts`'s `clearPanels()` — existing
  all-panels removal pattern to follow for the single-panel case

## Solution Approach

Implements the "Individual panel removal" scenario (spec.md, feature #7).

- Add `removePanel(store: Writable<WorkspaceState>, panelId: string): void`
  to `src/lib/workspace/store.ts`, mirroring `selectInstance`'s existing
  pattern: a plain function taking the store, called directly from the UI
  on human interaction — not a WebMCP tool, since there's no agent-facing
  need to close one panel (`clearPanels` already covers the agent's
  all-panels case, per `apiEngine.ts`'s `ResearchEngine` contract, which
  this ticket leaves unchanged).
  - Filters the closed panel out of `ws.panels` (AC1, AC2).
  - If `ws.focus?.panelId === panelId`, sets `ws.focus = null` — mirrors
    `clearPanels()`'s full focus reset, scoped to just the closed panel's
    case (AC3).
  - Leaves `ws.instanceSets`/`ws.studies`/`ws.setups` untouched — per
    spec.md's non-goals, closing a panel never touches the result set it
    was built from.
- `GridPanel.svelte` renders a "Close" button in its header, calling
  `removePanel(store, panel.id)` using the `store` prop it already
  receives (same prop `selectInstance` already uses there).
- `ChartToolbar.svelte`'s `clearPanels()` call and `apiEngine.ts`'s
  `clearPanels()` engine method are unchanged (AC4).

**Contracts:**
- `removePanel(store: Writable<WorkspaceState>, panelId: string): void` →
  `src/lib/workspace/store.ts` — single-panel removal, human-driven (not
  a `ResearchEngine`/WebMCP tool method), following `selectInstance`'s
  existing precedent for direct store mutations from UI interaction.

## Out of Scope

Panel-scoped histogram action (T-1003-1). Reordering or resizing panels.
