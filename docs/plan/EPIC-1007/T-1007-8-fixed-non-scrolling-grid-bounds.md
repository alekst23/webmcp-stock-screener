# T-1007-8: Fixed, non-scrolling grid bounds

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: In Progress — geometry (AC1, AC2, AC3, AC5) delivered here,
alongside T-1007-2, in `src/lib/panels/domain/layout.ts`. AC4
(viewport-filling CSS rendering) is NOT delivered by this work — it is
owned by T-1007-6, which renders the grid container.
**Depends on**: —
**Blocks**: T-1007-4, T-1007-6

## Description

The panel-system spec's grid-dimensions open question was resolved
2026-09-02 to a fixed, non-scrolling 6-column by 4-row grid (24 cells)
that always exactly fills the viewport, replacing the earlier "12-column,
unbounded-row" assumption. T-1007-2's AC2 ("rows are unbounded") and
T-1007-6's AC1 (mapping cells onto the viewport, silent on scroll/fill
behavior) were both written against the superseded assumption — see the
**Superseded note** on T-1007-2 in `_epic.md`. This ticket delivers the
delta both of those tickets now need: a bounded row dimension with a
clean "grid is full" failure mode, and viewport-filling, non-scrolling
rendering.

Done looks like: the grid geometry module rejects any footprint or
auto-placement that would exceed 4 rows exactly the way it already
rejects exceeding 6 columns, `create_panel`'s auto-placement fails
cleanly (not by overflowing) when no free rect exists anywhere in the 24
cells, and the rendered container always fills the viewport's full
width and height with no scrollbar, at any window size.

## User Story

As an agent or the researcher watching it work,
I want the workspace to always fit on one screen with everything visible
at once, and to get a clear "no room" error instead of a panel silently
sliding off-screen,
so that the canvas behaves like a fixed dashboard, not a page that grows
without bound.

## Acceptance Criteria

1. `GRID_ROWS` is `4`; a footprint whose row plus row-span exceeds 4 is
   rejected with an error stating the grid's row bound, the same way an
   out-of-column-bounds footprint already is.
2. Given a required size and the set of occupied footprints, when no free
   footprint of that size exists anywhere within the 6x4 grid, the
   auto-placement function reports "no free rect" (not a thrown
   exception) rather than returning a rect that exceeds row 4.
3. `create_panel`'s auto-placement path surfaces that "no free rect"
   result as a failed mutation: nothing is created, no revision advances,
   and the error says the grid is full.
4. The rendered panel container occupies exactly 100% of the viewport's
   width and height — a panel spanning `colSpan` columns renders at
   `colSpan / 6` of the width, `rowSpan` rows at `rowSpan / 4` of the
   height — and the page never produces a scrollbar from panel content,
   at any window size the app supports.
5. `maximize_panel` and `split_panel`'s existing minimum-size and bounds
   checks are exercised against the 6x4 bounds (not the superseded
   12-column figure) and behave identically in kind to the column-bound
   case.

## Design References

- `docs/design/panel-system/spec.md` — "Open Questions" (grid dimensions,
  resolved) and the "Add a panel" table's "Grid is full" scenario
- `docs/design/panel-system/technical.md` — `GRID_COLUMNS`/`GRID_ROWS`,
  and `findFreeRect`'s `GridRect | null` return contract
- `docs/plan/EPIC-1007/T-1007-2-logical-grid-layout-model.md` — the
  geometry module this ticket corrects the row-bound AC of (see the
  Superseded note in `_epic.md`)
- `docs/plan/EPIC-1007/T-1007-6-panel-container-rendering-and-wiring.md`
  — the rendering ticket this ticket's AC4 extends

## Technical Considerations

- This is a correction to T-1007-2's geometry module and an extension of
  T-1007-6's rendering, not a new module — implement it as part of
  those same files/components rather than a parallel grid implementation.
- `findFreeRect`'s "not found" case must be a normal return value, not an
  exception — every other rejection path in this epic (out of bounds,
  below minimum, overlap) is a typed result too, and a full grid is not
  exceptional, it's an expected steady state once a workspace is busy.
- Viewport-filling layout is a CSS/rendering concern (grid-template
  rows/columns as fractions, not a JS-computed pixel table) — no new
  domain state beyond `GRID_ROWS`.

## Out of Scope

Drag-to-resize, responsive breakpoints below whatever minimum viewport
size the app already supports, and any change to the 6/4 constants
themselves once set here.

AC4 (the rendered container filling 100% of the viewport, CSS-only) is
explicitly NOT delivered here — it belongs to T-1007-6, which owns
`src/lib/panels`' rendering/composition layer. This ticket is geometry
only: correcting T-1007-2's row bound.

## Solution Approach

This ticket is delivered as a correction folded into T-1007-2's module
(`src/lib/panels/domain/layout.ts`), per the Technical Considerations
note — not a parallel grid implementation. `GRID_ROWS = 4` already lives
in the seeded `src/lib/panels/domain/grid.ts` (not modified here); this
ticket's job is making sure every geometry function in `layout.ts`
treats the row bound exactly like the column bound:

- **AC1**: `validatePlacement`'s `out_of_bounds` check tests
  `row + rowSpan > GRID_ROWS` the same way it tests
  `col + colSpan > GRID_COLUMNS`, and the violation's `message` states
  the row bound (`gridRows` is on the violation shape alongside
  `gridColumns`).
- **AC2**: `findFreeRect`'s row-major scan is bounded to
  `row <= GRID_ROWS - size.rowSpan`; when no candidate rect fits (either
  because the grid is full or because `size.rowSpan > GRID_ROWS`), it
  returns `null` — a normal return, never a thrown exception. Tested
  explicitly: a 6x4 grid fully occupied returns `null` rather than a
  rect that overflows row 4.
- **AC3**: out of scope for this agent — `create_panel`'s use case
  (T-1007-4, Wave 2) is the caller that turns `findFreeRect`'s `null`
  into a failed-mutation envelope. This ticket only guarantees the
  geometry primitive it depends on behaves correctly (AC2).
- **AC5**: `splitRect` and `fullGridRect` (backing `maximize_panel`) are
  both written directly against `GRID_ROWS = 4` / `GRID_COLUMNS = 6` —
  there is no separate "12-column" code path anywhere to have missed.
  Tests exercise `splitRect`'s minimum-size rejection and
  `fullGridRect`'s shape against the 6x4 bounds.

No new files beyond what T-1007-2 already introduces
(`layout.ts`, `layout.test.ts`) — this ticket does not own a separate
module.
