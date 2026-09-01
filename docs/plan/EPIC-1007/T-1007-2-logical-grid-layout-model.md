# T-1007-2: Logical grid layout model

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Open
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
