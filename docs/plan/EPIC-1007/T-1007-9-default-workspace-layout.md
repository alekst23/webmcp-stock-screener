# T-1007-9: Seed new workspaces with the default layout

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Done
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

## Solution Approach

Lands entirely inside T-1007-6's composition root and controller — no new
files beyond what that ticket already introduces.

**The gate (AC3, the subtle one)**: `panelController.initializeWorkspace`
returns `{ workspaceId, justCreated }`, where `justCreated` is set by
*which branch ran* — the create branch or the load branch — never by
inspecting `state.panels.length` on the result. `registerPanelTools.ts`
calls `seedDefaultWorkspace(panelDeps, justCreated)` with that flag
directly. Loading an existing (possibly empty) workspace, restoring a
revision, or duplicating one are all "load" as far as this function is
concerned — none of them is the code path that mints a new workspace id
via `create_workspace`'s own logic, so none of them can set
`justCreated: true`. This is checked with a mutation-check test: flip the
gate in the seeding call to `state.panels.length === 0` instead of the
`justCreated` flag, confirm the "load an existing empty workspace" test
now (wrongly) seeds, then restore the real gate.

**Seeding (AC1, AC2)**: `seedDefaultWorkspace` calls the same `createPanel`
use case three times with explicit, non-overlapping rects that partition
the 6x4 grid into three equal full-height columns — `filter_builder` at
`(col:0,row:0,colSpan:2,rowSpan:4)`, `results_table` at
`(col:2,row:0,colSpan:2,rowSpan:4)`, `chart` at
`(col:4,row:0,colSpan:2,rowSpan:4)` — each satisfying its kind's declared
`minSize`. No `source` is passed, so each panel is created exactly as
`create_panel` would leave an unbound panel: `source: null`, and whatever
`renderer` its kind's `defaultRenderer` specifies (`results_table` →
`table`, `chart` → `chart_grid`, `filter_builder` → `null`) — the same
values a bare `create_panel({kind})` call would produce, so a seeded
panel is byte-for-byte what `create_panel` makes (AC2). The placeholder
body already renders "no screener run yet"-style empty state for a
`source: null` panel (T-1007-6's `PlaceholderPanelBody.svelte`), so no
extra empty-state code is needed here.

**Not a template (AC4)**: the three rects above are inline literals in
`panelController.ts`, never passed to `layoutTemplateRegistry.register`.
A test asserts `registerDefaultLayoutTemplates`'s registry names
(`three_columns`, `quad`, `chart_wall_3x3`, `focus_with_sidebar`) do not
include anything resolving to this arrangement, and that
`apply_layout_template` has no fifth name to request.

**No EPIC-1006 change (AC5)**: workspace creation reuses
`recordCommit`/`emptyWorkspace` exactly as `workbench/tools/index.ts`'s
`create_workspace` does (see T-1007-6's Solution Approach) — this ticket
adds no field, flag, or hook to that path; seeding is purely "what this
epic's own composition root does right after, before paint," per the
technical doc's "Default workspace layout (seeding, not a tool)" section.
