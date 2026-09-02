# T-1007-2: Logical grid layout model

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: In Progress
**Depends on**: —
**Blocks**: T-1007-4

## Description

`set_panel_layout` must position and size panels in logical grid
coordinates, never pixels — so an agent can say "put the chart in the top
two-thirds" without knowing anything about the viewport, and so the same
layout survives any screen. This ticket delivers the geometry that makes
that safe: bounds checking, minimum-size checking, overlap detection,
deterministic auto-placement for newly added panels, and all-or-nothing
batch application.

Done looks like: a pure, unit-tested geometry module that knows about
rectangles on a fixed-column grid and nothing else.

## User Story

As an agent arranging a workspace,
I want to place and resize panels in grid cells and be told precisely
what is wrong when a placement is impossible,
so that I can compose a layout without guessing at pixels and without
silently corrupting the arrangement.

## Acceptance Criteria

1. A panel's footprint is expressed as a column, a row, a column span,
   and a row span — all whole numbers, with spans of at least one.
2. Columns are bounded by a fixed grid width and rows are unbounded; a
   footprint extending past the last column is rejected with an error
   stating the grid's bounds.
3. A footprint smaller than the minimum size declared for that panel's
   kind is rejected with an error stating the minimum.
4. Two footprints are detected as overlapping when they share at least
   one cell, and as not overlapping when they merely touch edges.
5. A placement that overlaps an existing panel is rejected with an error
   naming the occupying panel.
6. A batch of placements is applied only if every one of them is valid
   and none of them conflict with each other or with unmoved panels;
   otherwise nothing is applied and the error identifies the specific
   violation, including the conflicting pair when two placements in the
   same batch collide.
7. Panels not named in a batch keep their existing footprints exactly.
8. Given a required size and the set of occupied footprints, a free
   footprint is chosen deterministically — the same inputs always yield
   the same placement — and never overlaps an occupied one.
9. Hidden panels' footprints are excluded from occupancy, so a placement
   over a hidden panel's cells is accepted.

## Design References

- `docs/design/panel-system/spec.md` — "Lay out panels" scenarios and
  Open Questions 1 (grid dimensions), 4 (overlap policy), and 5
  (hidden panels)
- `docs/design/panel-system/technical.md` — the grid layout contract
  table and the fixed column count

## Technical Considerations

- Pure functions with no state, no I/O, and no imports from the registry,
  the link graph, WebMCP, or Svelte. Kind minimum sizes are passed in as
  data, not looked up.
- Overlap uses half-open intervals; adjacency is not overlap. This is the
  single most likely off-by-one in the epic — test the touching-edges
  case explicitly.
- Auto-placement must be deterministic so that a replayed idempotent
  `create_panel` yields the identical layout.
- New files only.

## Out of Scope

Rendering the grid (T-1007-6), the panel entity and kind registry
(T-1007-1), revision/envelope handling (T-1007-4), and any responsive or
pixel-level concern.

## Solution Approach

**AC2 superseded.** "Rows are unbounded" is wrong — see the Superseded
note in `_epic.md`. T-1007-8 (owned in this same branch) corrects the row
bound to `GRID_ROWS = 4`, exactly mirroring the column-bound check. This
ticket's implementation is written against the corrected 6x4 grid from
the start; there is no intermediate "unbounded rows" code path.

**New files** (pure domain, no I/O, no Svelte, no registry/link-graph
imports):

- `src/lib/panels/domain/layout.ts` — geometry: `rectsOverlap`,
  `validatePlacement`, `findFreeRect`, `applyLayout`, `splitRect`,
  `fullGridRect`, plus the `OccupiedRect`, `PlacementViolation`,
  `PlacementResult`, `Placement`, `LayoutResult`, `SplitResult` types.
- `src/lib/panels/domain/layoutTemplates.ts` — a separate named-template
  registry (`three_columns`, `quad`, `chart_wall_3x3`,
  `focus_with_sidebar`), independent of `layout.ts`'s geometry so the
  templates can be swapped/extended without touching placement logic.
- `src/lib/panels/domain/layout.test.ts`, `layoutTemplates.test.ts`.

**`validatePlacement`** runs four checks in this fixed order, returning
the first that fails: (1) `invalid_size` — non-integer or `<1` spans; (2)
`out_of_bounds` — footprint extends past column 6 or row 4 (or has a
negative origin); (3) `below_minimum` — either span is below the kind's
declared `minSize`; (4) `overlap` — intersects an `OccupiedRect` other
than `ignorePanelId`, via half-open-interval `rectsOverlap`. `occupied`
is documented as caller-pre-filtered (hidden panels already excluded) —
this module has no concept of "hidden".

**`findFreeRect`** scans row-major from `(0,0)`: outer loop over
candidate `row` in `[0, GRID_ROWS - size.rowSpan]`, inner loop over
`col` in `[0, GRID_COLUMNS - size.colSpan]`, returning the first
candidate with no overlap against `occupied`. If `size` itself exceeds
either grid dimension the loop bounds go negative and the function
naturally returns `null` with no special-casing — the "grid is full"
path and the "requested size too big for the grid" path are the same
code path. Never throws.

**`applyLayout`** batch algorithm: (1) split `current` into panels named
in `placements` (moving) vs. not (unmoved, kept verbatim); (2) validate
each placement's rect via `validatePlacement` against only the unmoved
set (a panel moving out of its old cell must not block itself or its
batch-mates); first individual violation short-circuits the whole call;
(3) once every placement individually validates, pairwise-check the
placements against each other for `batch_conflict`, naming both panel
ids in the order encountered; (4) on success, return the full resulting
`OccupiedRect[]` — moved panels at their new rects, unmoved panels
unchanged.

**`splitRect`** divides one rect by a line through its middle:
`vertical` splits along a vertical line into left (`original`) / right
(`created`) halves dividing `colSpan`; `horizontal` splits along a
horizontal line into top (`original`) / bottom (`created`) halves
dividing `rowSpan` — the common pane-splitting convention (the split
line's orientation names the direction, not the resulting arrangement).
The midpoint is `Math.ceil(span / 2)`, so `original` gets the equal or
larger half. Both resulting rects are checked against their own
`minSize` (`originalMinSize` / `createdMinSize`); a span that rounds to
`0` (splitting a span of `1`) is naturally caught by the minimum check
since every real `minSize` is `>= 1` — no separate zero-span guard
needed. No bounds/overlap re-check is needed: both halves are subsets of
an already-valid parent rect, so they cannot leave the grid or overlap
each other.

**`fullGridRect`** is a pure constant-shape helper
(`{ col: 0, row: 0, colSpan: GRID_COLUMNS, rowSpan: GRID_ROWS }`) — never
stored on a panel, computed fresh each call for `maximize_panel`'s
render-only state.
