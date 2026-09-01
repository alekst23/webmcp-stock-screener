# T-1007-4: Panel mutation use cases over the common contract

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Open
**Depends on**: T-1007-1, T-1007-2, T-1007-3
**Blocks**: T-1007-5

## Description

Wave 1 produced three independent pure modules — the panel entity and
kind registry, the grid geometry, and the link graph. This ticket
composes them into the fourteen actual panel operations against a live
workspace, and makes each one a well-behaved citizen of the common
mutation contract EPIC-1006 owns: optimistic concurrency via
`expected_revision`, replay safety via `idempotency_key`, a standard
result envelope, and a registered inverse so the change can be undone.

The operations split into three groups: panel lifecycle and layout
(`create_panel`, `duplicate_panel`, `remove_panel`, `set_panel_layout`,
`apply_layout_template`, `split_panel`, `maximize_panel`) built entirely
from T-1007-1 and T-1007-2; linking and selection (`link_panels`,
`unlink_panels`, `set_panel_selection`) built from T-1007-3; and
source/renderer mutation (`bind_panel_source`, `set_panel_renderer`,
`configure_panel_view`, `configure_chart_grid`), which additionally
depends on T-1007-7's source/renderer contract registry to validate
source-type compatibility and renderer configuration — those four use
cases cannot be finished until T-1007-7 lands, though they can be
scaffolded against its contract in parallel.

Done looks like: fourteen use cases that each take a workspace and a
request and return the standard envelope, unit-tested against a fake
workspace, with no WebMCP or UI involvement.

## User Story

As an agent mutating a workspace,
I want every panel operation to either apply completely or not at all,
tell me exactly what changed, refuse to act on a stale view of the
workspace, and be reversible,
so that I can compose a layout confidently and recover from a mistake in
one call.

## Acceptance Criteria

1. `create_panel` validates the kind against the registry, validates the
   initial source and renderer against T-1007-7's contract registry,
   validates the configuration against that kind and renderer, resolves a
   footprint — the caller's if supplied, an auto-chosen free one
   otherwise — validates the placement, and adds the panel with a newly
   minted stable ID; a failure at any step leaves the workspace untouched.
2. `duplicate_panel` copies an existing panel's kind, configuration,
   source, and renderer to a new panel with a fresh stable ID and an
   auto-chosen footprint, optionally overriding the symbol or source
   supplied in the request; the original panel is untouched.
3. `configure_panel_view` can change a panel's title, visibility,
   collapsed state, and renderer-specific view configuration
   independently and in combination; view configuration is validated
   against the panel's active renderer contract (T-1007-7).
4. `bind_panel_source` changes a panel's source, rejecting a source type
   the panel's kind or active renderer does not accept.
5. `set_panel_renderer` changes a panel's renderer without changing its
   source, preserving configuration fields the new renderer's contract
   still recognizes and clearing the rest with a warning.
6. `configure_chart_grid` sets rows, columns, item count, pagination,
   shared studies, and chart settings for a panel whose renderer is
   `chart_grid`, validated against the chart-renderer contract.
7. `set_panel_layout` applies a batch of footprints all-or-nothing, and
   panels absent from the batch are unmoved. `apply_layout_template`
   applies a named template's footprints to every panel in one
   all-or-nothing batch. `split_panel` divides one panel's footprint into
   two, creating a new panel. `maximize_panel` changes only the rendered
   state, never the stored footprint, and is reversible without consuming
   a revision on the way back.
8. `link_panels` validates each panel's kind against the requested
   channel before any link is created, and supports joining a channel's
   group; `unlink_panels` supports leaving one, affecting only the named
   channel. `set_panel_selection` propagates a selection to every panel
   linked on the `result_selection` channel.
9. `remove_panel` deletes the panel, frees its cells, drops it from every
   channel's group, and dissolves groups left with fewer than two
   members.
10. Every operation returns the common mutation envelope: a change ID,
    the new revision, the affected stable IDs, a human-readable diff
    summary, warnings, and an undo token — except `maximize_panel`,
    which is a rendering-only toggle and does not consume a workspace
    revision (see T-1007-6).
11. `affected_ids` names every panel the change actually touched — the
    subject panel plus, for a removal or an unlink, the panels whose link
    groups changed as a result.
12. An operation whose `expected_revision` does not match the workspace's
    current revision is rejected as a conflict and changes nothing.
13. An operation repeated with an `idempotency_key` already applied
    returns the original envelope and applies no second change.
14. Each revisioned operation registers an inverse such that redeeming
    the returned undo token restores the workspace's panels, footprints,
    sources, renderers, and link groups to their prior state — verified
    for every operation in AC10's set, including that an undone removal
    restores the panel's original ID, configuration, footprint, and link
    memberships.
15. A failed operation never consumes a revision and never emits an undo
    token.

## Design References

- `docs/design/panel-system/spec.md` — every scenario for add, update,
  lay out, link, and remove
- `docs/design/panel-system/technical.md` — "Consumed from EPIC-1006"
  table and the use-case list
- `docs/plan/EPIC-1006/_epic.md` — the workspace/revision model, stable-ID
  minting, mutation envelope, `expected_revision`, `idempotency_key`, and
  undo token contracts this ticket consumes
- `docs/reference/tool-spec.md` — the canonical envelope shape
- `docs/plan/EPIC-1007/T-1007-7-panel-source-renderer-registry.md` — the
  source/renderer contract registry that `bind_panel_source`,
  `set_panel_renderer`, `configure_panel_view`, and `configure_chart_grid`
  validate against

## Technical Considerations

- **This ticket is blocked until EPIC-1006 lands.** Do not re-implement
  revisions, ID minting, the envelope, idempotency storage, or the undo
  store — consume them. If a needed piece of EPIC-1006's surface is
  missing, raise it rather than building a local copy.
- Keep each use case at or under the project's method size limit;
  validation sequences belong in the Wave 1 domain modules, not inlined
  here.
- `diff_summary` is read by a human in the activity log — it should name
  the panel and what changed, not restate the request.
- New files only. Do not modify the existing 11-tool surface,
  `src/lib/workspace/store.ts`, or the current UI.

## Out of Scope

Tool schemas and agent-facing error shaping (T-1007-5), rendering
(T-1007-6), and any panel-kind-specific behavior beyond calling the
kind's own validator.
