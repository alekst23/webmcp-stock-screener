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

## Solution Approach

Two new files under `src/lib/panels/registry/`, mirroring T-1007-1's
structure but with independent storage (two `Map`s closed over inside
`createSourceRendererRegistry()` — one for source types, one for renderer
types) — never merged into `panelKindRegistry`'s map, per the technical
design's explicit "deliberately separate" note.

- `registry/sourceRendererRegistry.ts` — `SourceTypeDefinition`,
  `RendererTypeDefinition`, `ConfigError`/`ConfigValidation` reused from
  `panelKindRegistry.ts` (imported, not redefined, since AC7 asks for the
  identical error shape) rather than duplicated. Four typed error
  classes (`SourceTypeConflictError`, `RendererTypeConflictError`,
  `UnknownSourceTypeError`, `UnknownRendererTypeError`) mirror
  `PanelKindConflictError`/`UnknownPanelKindError`'s shape:
  `readonly name`/`readonly sourceType`/`readonly renderer` plus, for the
  "unknown" pair, `readonly registeredTypes: string[]`.
  - `validateSource` looks up every registered source type, filters to
    those whose `isCompatible({ panelKind, renderer })` is true, and
    either validates the input against the named type (when `source` is
    a `{ type, ref }` shape naming one of them and compatible) or returns
    `{ ok: false, errors, acceptedSourceTypes }` where
    `acceptedSourceTypes` is that compatible-name list — computed the
    same way on both the "wrong type" and "unknown type" failure paths
    so the AC6 error always lists real accepted types, not just a static
    per-source list.
  - `validateRendererConfig` is a thin `requireRendererType(renderer)
    .validateConfig(input)` — AC7 wants exactly the kind registry's
    validator shape, so no new error type is needed here beyond
    `UnknownRendererTypeError` when the renderer name itself is
    unregistered.
  - `migrateConfig({ from, to, config })`: resolves `to`'s
    `RendererTypeDefinition` (throws `UnknownRendererTypeError` if
    unregistered), then calls a small private helper
    `recognizedFieldNames(configSchema)` that reads
    `(configSchema as { properties?: object }).properties &&
    Object.keys(properties)` — schema-driven, not hardcoded per renderer,
    because a renderer's config contract is *defined* by its schema and a
    second hardcoded field list would drift from it. Fields in `config`
    whose key is in that set carry over; the rest are collected into
    `dropped`. `from` is accepted but unused beyond documenting intent
    (the migration only needs the *old* config values and the *new*
    schema) — kept in the signature because T-1007-4's call site has it
    on hand and it reads clearly at the call site.
  - `renderersAcceptingSource(sourceType)` scans registered renderer
    types for `acceptedSourceTypes.includes(sourceType)`.
- `registry/defaultSourceRendererTypes.ts` —
  `registerDefaultSourceRendererTypes(registry)` registers:
  - Sources: `screener_results` (`{ run_id: string }`), `watchlist`
    (`{ watchlist_id: string }`), `symbol_list` (`{ symbols: string[] }`),
    `panel_reference` (`{ panel_id: string }`). Each `isCompatible`
    checks the renderer accepts that source type (via a closure over the
    registry's own `getRendererType`, using `renderer === null` as
    "compatible if any registered renderer would accept it" — a source
    can be bound before a renderer is chosen) — implemented by checking
    `renderer === null || requireRendererType(renderer)
    .acceptedSourceTypes.includes(name)`, so isCompatible does not need
    to know about specific panel kinds; `panelKind` is accepted in the
    signature for forward compatibility (a future kind-specific
    restriction) but unused by the four shipped types, matching the
    ticket's "provisional... obviously replaceable" instruction.
  - Renderers: `table` (`acceptedSourceTypes: ['screener_results',
    'watchlist', 'symbol_list']`), `chart_grid` (all four source types;
    config schema covers `rows`, `columns`, `itemCount`, `page`,
    `pageSize`, `sharedStudies: string[]`, `chartSettings: object` per
    T-1007-4 AC6/T-1007-5 AC6), `heatmap` (`screener_results`,
    `watchlist`, `symbol_list`), `scatter_plot` (`screener_results`,
    `symbol_list`). Each `validateConfig` provisionally checks the input
    is an object and every present key is a declared schema property
    (same provisional strategy as T-1007-1's kind validators).

Extensibility test (AC16 epic-level evidence) lives in
`sourceRendererRegistry.test.ts`: constructs an isolated registry via
`createSourceRendererRegistry()`, registers a fictional
`'fringe_signal'` source type and `'sparkbars'` renderer type defined
entirely in the test file, and exercises lookup, list, `validateSource`,
`validateRendererConfig`, `migrateConfig`, and
`renderersAcceptingSource` against them — proving no file in this ticket
needs to change for a sibling epic to plug in. A twin test in
`panelKindRegistry.test.ts` does the same for a fictional panel kind.
