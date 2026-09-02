# T-1007-9: Seed new workspaces with the default layout

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Open
**Depends on**: T-1007-6
**Blocks**: —

## Description

Per the panel-system spec's "Seed a new workspace with the default
layout" feature (added 2026-09-02), a newly created, still-empty
workspace should never present a blank canvas to the researcher watching
it: it should already contain a `filter_builder` panel (left), a
`results_table` panel (center), and a `chart` panel (right), pre-arranged
on the grid, before the human ever sees it. This is a T-1007-6 extension
— no other existing ticket's AC covers workspace-creation-time seeding —
so it lands as its own ticket rather than editing T-1007-6.

Done looks like: creating a fresh workspace through the agent-facing
surface (or the UI) always yields these three panels already in place,
with no extra tool call, and re-loading, restoring, or duplicating a
workspace never re-triggers seeding.

## User Story

As a researcher opening a fresh workspace,
I want to immediately see a working screener-and-chart layout rather than
an empty grid,
so that I can start working right away instead of having to ask an agent
to build the same starting arrangement every time.

## Acceptance Criteria

1. A newly created, empty workspace has exactly three panels immediately
   after creation completes: `filter_builder`, `results_table`, and
   `chart`, positioned left/center/right respectively within the 6x4
   grid, with no additional tool call.
2. Each seeded panel starts unbound (no source), renders its kind's
   normal empty/not-yet-bound state, and behaves identically to a panel
   added via `create_panel` for every subsequent operation (configure,
   bind, rebind, remove, undo, etc.).
3. Seeding happens exactly once, at creation of a genuinely new, empty
   workspace. Loading an existing workspace, restoring a prior revision,
   or duplicating a workspace never re-applies it, even if the loaded
   state happens to be empty.
4. The default layout is not registered as, or reachable through,
   `apply_layout_template` — no template name resolves to it.
5. Seeding does not require or introduce any change to EPIC-1006's
   `create_workspace` contract; it is implemented entirely within this
   epic's composition root.

## Design References

- `docs/design/panel-system/spec.md` — "Seed a new workspace with the
  default layout" feature and behavioral scenarios
- `docs/design/panel-system/technical.md` — "Default workspace layout
  (seeding, not a tool)"
- `docs/plan/EPIC-1007/T-1007-6-panel-container-rendering-and-wiring.md`
  — the composition root this ticket's seeding logic runs inside

## Technical Considerations

- Runs client-side, immediately after a `create_workspace` call resolves
  to a workspace with zero panels, before first paint of the panel
  container — the human should never see the momentarily-empty state.
- Uses the same `createPanel` use case every other panel-creation path
  uses; no parallel/bespoke panel-construction code.
- Must not fire on workspace load/restore/duplicate — gate on "workspace
  was just created", not merely "workspace currently has zero panels."

## Out of Scope

Real panel bodies for the three seeded kinds (sibling epics), and any
named template registration for this arrangement (spec explicitly
excludes it from `apply_layout_template`).
