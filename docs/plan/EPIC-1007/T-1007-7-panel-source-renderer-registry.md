# T-1007-7: Panel source and renderer contract registry

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Open
**Depends on**: T-1007-1
**Blocks**: T-1007-5

## Description

`docs/reference/tool-spec.md` treats a panel's source (what data it shows)
and its renderer (how that data is shown) as independent, and gives four
tools that mutate them — `bind_panel_source`, `set_panel_renderer`,
`configure_panel_view`, `configure_chart_grid` — none of which this epic
should know the specifics of. A screener run's shape, a watchlist's shape,
and a symbol list's shape are different; a table's columns, a chart's
studies, and a heatmap's cells are different. This epic cannot hard-code
any of that without becoming the thing every sibling epic has to edit.

This ticket delivers the second registry the panel system needs,
alongside T-1007-1's panel-kind registry: an extensible registry where a
sibling epic registers a **source type** (what a source reference of that
type must contain, and how to validate one against a panel's kind) and a
**renderer type** (its configuration schema, validator, and defaults) —
without editing any file in this epic. `bind_panel_source`,
`set_panel_renderer`, `configure_panel_view`, and `configure_chart_grid`
all resolve through this registry rather than switching on source or
renderer type themselves.

It also ships the four source types and the four renderer types the tool
spec names — `screener_results`, `watchlist`, `symbol_list`,
`panel_reference` as sources; `table`, `chart_grid`, `heatmap`,
`scatter_plot` as renderers — as registered placeholder definitions with
real compatibility rules and schemas but provisional validators, so the
rest of the epic can be built and demonstrated end-to-end before any
sibling epic lands.

Done looks like: a pure, unit-tested registry, independent of the
panel-kind registry's storage but consistent with its pattern, with no
knowledge of the grid, the link graph, or WebMCP.

## User Story

As a feature epic that owns one renderer (a results table, a chart) or
contributes a new way to source panel data,
I want to declare my renderer's configuration contract, or my source
type's shape and compatibility rule, to the workspace once,
so that `configure_panel_view`, `configure_chart_grid`, and
`bind_panel_source` validate against my contract without this epic ever
needing to know it exists.

## Acceptance Criteria

1. A source type can be registered by declaring its name, the shape a
   valid source reference of that type must have (for example a
   `screener_results` source references a `run_id`; a `panel_reference`
   source references another panel's stable ID), and a compatibility
   predicate that decides whether a given panel kind/renderer pair
   accepts it.
2. A renderer type can be registered by declaring its name, a
   configuration schema, a configuration validator, default
   configuration, and the source types it accepts.
3. Registering two source types or two renderer types under the same name
   reports a conflict rather than silently replacing the first.
4. A registered source type or renderer type can be looked up by name;
   the full set of each can be enumerated with its schema and
   compatibility rules.
5. Looking up an unregistered source type or renderer type reports that
   it is unknown and lists every one that is registered.
6. Validating a source reference against a target panel's kind and
   renderer returns either a validated reference or an error naming the
   incompatibility and the accepted source types.
7. Validating a renderer configuration returns either validated
   configuration or errors that each identify the rejected field and the
   reason, exactly as T-1007-1's kind configuration validator does.
8. Changing a panel's renderer resolves, for each configuration field
   present under the old renderer, whether the new renderer's schema
   still recognizes it; recognized fields carry over, unrecognized ones
   are dropped and reported.
9. The four source types (`screener_results`, `watchlist`, `symbol_list`,
   `panel_reference`) and the four renderer types (`table`, `chart_grid`,
   `heatmap`, `scatter_plot`) named in the tool spec are registered with
   real compatibility rules and schemas; only their validators and
   defaults are permitted to be provisional, and each must be obviously
   replaceable by its owning epic (EPIC-1009 for `screener_results` as a
   source, EPIC-1010 for `table`, EPIC-1011 for `chart_grid`, EPIC-1012
   for the collection-of-setups case `chart_grid` also serves).
10. A registry can be created in isolation, so a test can register source
    and renderer types without affecting any other test or the
    application's own registry.

## Design References

- `docs/reference/tool-spec.md` — the "Panels: source and renderer are
  separate" section and the `bind_panel_source`, `set_panel_renderer`,
  `configure_panel_view`, `configure_chart_grid` rows
- `docs/design/panel-system/spec.md` and `technical.md` — extended (or, if
  not yet updated for this revision, treated as silent — proceed on the
  assumption stated in this ticket and record any conflict as a new open
  question rather than guessing further)
- `docs/plan/EPIC-1007/T-1007-1-panel-entity-and-kind-registry.md` — the
  sibling registry this ticket's structure mirrors
- `src/lib/webmcp/types.ts` — existing type-declaration style (shape of
  summaries, opaque IDs, comments explaining WHY)

## Technical Considerations

- Pure domain code: no imports from infrastructure, WebMCP, Svelte, or
  the layout and link modules — same constraint as T-1007-1.
- This registry is deliberately separate from T-1007-1's panel-kind
  registry rather than merged into it: a panel's kind rarely changes after
  creation, but its source and renderer change routinely (that is the
  whole point of the source/renderer split), so they are looked up and
  revalidated on every relevant mutation, not fixed at creation time like
  a kind is.
- The four renderer placeholders' validators can be as simple as "accept
  anything matching the declared schema" until EPIC-1010/EPIC-1011/
  EPIC-1012 replace them; do not build real column or study validation
  here.
- New files only. Do not modify `src/lib/webmcp/tools.ts`,
  `src/lib/webmcp/types.ts`, `src/lib/workspace/`, or T-1007-1's registry
  module.

## Out of Scope

The panel-kind registry itself (T-1007-1), grid geometry (T-1007-2), link
groups (T-1007-3), workspace mutation and revisions (T-1007-4), tool
schemas (T-1007-5), and the real table/chart/heatmap renderer contracts
(EPIC-1010, EPIC-1011, EPIC-1012 respectively) — this ticket builds the
registry mechanism and placeholder contracts, not the real ones.
