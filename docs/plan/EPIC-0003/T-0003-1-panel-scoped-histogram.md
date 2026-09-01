# T-0003-1: Panel-scoped histogram action

**Epic**: EPIC-0003 (Panel Action Set)
**Design**: docs/design/pattern-research-workbench/
**Status**: Done
**Depends on**: —
**Blocks**: —
**Issue**: #3

## Description

`+page.svelte` currently renders one `HistogramPanel` per entry in
`$workspaceStore.instanceSets`, each showing an identical "Show histogram
(10d forward return)" toggle with no connection to the grid panel
representing that same instance set. This ticket attaches the histogram
toggle directly to its panel and removes the standalone list.

## User Story

As a user with an open chart panel,
I want to toggle that panel's own outcome histogram from the panel itself,
so that I don't have to guess which of several identical buttons applies
to which result set.

## Acceptance Criteria

1. A grid panel tied to an instance set exposes a control to show/hide a
   histogram of that same instance set's outcome distribution.
2. The histogram, when shown, is visibly grouped with the panel it
   belongs to (e.g. rendered within or immediately alongside it), not in
   a separate section of the page.
3. The standalone per-instance-set button list in `+page.svelte` is
   removed.
4. Existing histogram behavior (data fetched via
   `resolveBackendInstanceSet`/`fetchInstanceWindows`, `10d forward
   return` computation) is unchanged — only where and how the toggle is
   surfaced changes.

## Design References

- `docs/design/pattern-research-workbench/spec.md` — "Panel-scoped
  histogram" scenario (feature #7)
- `src/lib/workspace/GridPanel.svelte`, `src/lib/workspace/HistogramPanel.svelte`,
  `src/routes/+page.svelte`

## Solution Approach

Implements the "Panel-scoped histogram" scenario (spec.md, feature #7).
Purely a composition change — no new store, engine, or backend contract.

- `GridPanel.svelte` renders a `HistogramPanel` inside its own
  `<section class="grid-panel">`, passing `instanceSetId={panel.instanceSetId}`
  along with the `engine`/`config` props `GridPanel` already receives.
  `HistogramPanel`'s existing toggle button becomes that panel's own
  histogram control (AC1, AC2) — no changes to `HistogramPanel.svelte`
  itself; its props (`instanceSetId`, `engine`, `config`, `horizonDays`)
  already match what `GridPanel` has in scope.
- `+page.svelte` deletes the standalone
  `{#each $workspaceStore.instanceSets as set}<HistogramPanel .../>{/each}`
  loop and its `HistogramPanel` import (AC3).
- `resolveBackendInstanceSet`/`fetchInstanceWindows` and the 10d forward
  return computation are untouched (AC4) — only where the toggle renders
  changes.

**Contracts:** none — no new types, store functions, or engine methods.
Existing `HistogramPanel` props are reused as-is.

## Test Plan

No new pure logic is introduced (see Solution Approach — pure template
composition), and this repo has no Svelte component-render test harness
(no `@testing-library/svelte`; `store.test.ts`/`visualization.test.ts`
only exercise store/engine logic, never mounted components) — that is
the established convention here, not a gap introduced by this ticket.

| Scenario | Tier | How verified |
|----------|------|--------------|
| AC1/AC2: histogram toggle visibly attached to its own panel | UI (browser) | `/at-browser-check T-0003-1` at ticket close |
| AC3: standalone per-instance-set list removed from `+page.svelte` | UI (browser) | `/at-browser-check T-0003-1` — confirms no disconnected histogram list remains |
| AC4: `resolveBackendInstanceSet`/`fetchInstanceWindows`/10d forward-return computation unchanged | regression | existing `src/lib/workspace/visualization.test.ts` and `src/lib/workspace/store.test.ts` suites, which already cover these functions, must remain green |

No new test stubs for this ticket.

## Out of Scope

Individual panel close (T-0003-2). New panel kinds.
