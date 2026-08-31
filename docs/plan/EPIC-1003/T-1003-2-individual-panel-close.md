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

Left to ticket design — e.g. a new store-level mutation (`removePanel(store, panelId)`
following the existing `selectInstance` pattern) called from a close
button rendered by `GridPanel.svelte`.

## Out of Scope

Panel-scoped histogram action (T-1003-1). Reordering or resizing panels.
