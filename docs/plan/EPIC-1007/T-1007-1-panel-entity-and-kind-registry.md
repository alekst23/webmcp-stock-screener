# T-1007-1: Panel entity and typed panel-kind registry

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Done
**Depends on**: —
**Blocks**: T-1007-4, T-1007-7

## Description

Four sibling epics need to contribute a panel kind — screener, results
table, chart, similarity — without any of them editing the panel
container. This ticket introduces the panel entity itself and the typed
registry that makes that possible: a kind declares its title, sizes,
default and validated configuration, the link channels it participates
in, the resource types it can bind to, and the body to render, and the
container learns everything it needs from that declaration.

It also ships all eight kinds from the tool spec as registered
placeholder definitions — real sizing, channels, and schemas, stub bodies
— so the rest of the epic can be built and demonstrated end-to-end before
any sibling epic lands.

Done looks like: a pure, unit-tested registry plus panel entity, with no
knowledge of the grid, the link graph, or WebMCP.

A panel's kind (what it *is*) and its source/renderer (what it *shows*
and *how*) are separate registries — T-1007-7 owns the latter. This
ticket's kind definition should leave room for a panel to carry an
active source and renderer reference, but does not itself validate
source or renderer compatibility; that is T-1007-7's contract, consumed
by T-1007-4's use cases.

## User Story

As a feature epic that owns one kind of panel,
I want to declare my panel kind to the workspace once and have it become
addable, configurable, layoutable, linkable, and renderable,
so that contributing a panel kind never means changing the panel
container.

## Acceptance Criteria

1. A panel has a stable ID, a kind, a title, an opaque configuration, a
   grid footprint, a hidden flag, a collapsed flag, and an optional bound
   resource reference.
2. A panel kind can be registered by declaring its name, default title,
   default size, minimum size, default configuration, a configuration
   validator, a configuration schema, the link channels it participates
   in, the resource types it accepts as a binding, and how to obtain its
   body for rendering.
3. Registering two kinds under the same name reports a conflict rather
   than silently replacing the first.
4. A registered kind can be looked up by name, and the full set of
   registered kinds can be enumerated with each one's configuration
   schema and supported link channels.
5. Looking up an unregistered kind reports that it is unknown and lists
   every kind that is registered.
6. A kind's configuration validator either returns validated
   configuration or returns errors that each identify the rejected field
   and the reason it was rejected.
7. All eight kinds from the tool spec — `filter_builder`, `chart`,
   `study_library`, `results_table`, `similar_opportunities`,
   `watchlist`, `alerts`, `symbol_details` — are registered with the
   default link channels documented in the technical design.
8. A registry can be created in isolation, so a test can register kinds
   without affecting any other test or the application's own registry.

## Design References

- `docs/design/panel-system/spec.md` — "Register a panel kind" scenarios
  and the supported kind and channel lists
- `docs/design/panel-system/technical.md` — the `PanelKindDefinition`
  field table, the default kind → link channel matrix, and the panel
  entity's fields
- `src/lib/webmcp/types.ts` — existing type-declaration style (shape of
  summaries, opaque IDs, comments explaining WHY)

## Technical Considerations

- Pure domain code: no imports from infrastructure, WebMCP, Svelte, or
  the layout and link modules. The registry stores a body *loader*, not a
  component, so the domain never depends on the rendering layer.
- Sizes here are declarative only — the geometry that consumes them is
  T-1007-2. Do not implement placement or overlap logic in this ticket.
- The eight placeholder definitions must carry real sizes, channels, and
  schemas; only the body and configuration validation are permitted to be
  provisional, and each must be obviously replaceable by its owning epic.
- New files only. Do not modify `src/lib/webmcp/tools.ts`,
  `src/lib/webmcp/types.ts`, or `src/lib/workspace/`.

## Out of Scope

Grid geometry (T-1007-2), link groups (T-1007-3), workspace mutation and
revisions (T-1007-4), tool schemas (T-1007-5), and any real panel body
(sibling epics).

## Solution Approach

Two new files under `src/lib/panels/`, both pure and side-effect-free
beyond module-level registration:

- `domain/panel.ts` — the `Panel` entity and `PanelSourceRef` shape (a
  panel's source is an opaque `{ type, ref }` pair; T-1007-7 owns
  validating it). `makePanel` is a plain constructor with defaults for
  `hidden`, `collapsed`, `source`, `renderer` — it does not mint IDs or
  validate `kind`/`config` against a registry; that is the use case
  layer's (T-1007-4) job, consistent with domain never importing
  `registry/`.
- `registry/panelKindRegistry.ts` — `PanelKindDefinition`,
  `ConfigValidation`/`ConfigError`, `PanelKindConflictError`,
  `UnknownPanelKindError`, and a `PanelRegistry` interface backed by a
  `Map<string, PanelKindDefinition>` closed over inside
  `createPanelRegistry()`. The module-global `panelKindRegistry` is one
  such instance; `registerPanelKind`/`getPanelKind`/`listPanelKinds` are
  thin wrappers over it, per technical.md's symbol table. Generic
  variance: registry storage and signatures use
  `PanelKindDefinition<Record<string, unknown>>`; `register` accepts
  `PanelKindDefinition<never>` so a caller with a narrower `TConfig` can
  pass its definition without a cast (a function whose parameter type is
  narrower is assignable to a wider parameter position through
  contravariance-safe `never`).
- `registry/defaultPanelKinds.ts` — `registerDefaultPanelKinds(registry)`
  registers the eight kinds from the tool spec with real `defaultSize`,
  `minSize` (defaulting to `{ colSpan: 2, rowSpan: 2 }` unless the kind's
  natural minimum is smaller, e.g. `filter_builder` and `alerts` at
  `{ colSpan: 1, rowSpan: 1 }`), the technical.md link-channel matrix
  reproduced exactly, and `bindingTypes` drawn from which T-1007-7 source
  types make sense for that kind (`chart`/`similar_opportunities` accept
  `screener_results`, `watchlist`, `symbol_list`, `panel_reference`;
  `results_table` accepts `screener_results`, `watchlist`,
  `panel_reference`; `watchlist` kind accepts `watchlist`, `symbol_list`;
  `study_library`/`symbol_details`/`alerts` accept `symbol_list`,
  `panel_reference`; `filter_builder` is not data-bound — `[]`).
  `defaultRenderer` is `'table'` for `results_table`, `'chart_grid'` for
  `chart`/`similar_opportunities`, and `null` for the rest (not yet
  rendering bound data). `component()` returns a placeholder marker
  object; `validateConfig` provisionally accepts any object matching the
  schema's declared top-level property names.
- Config schemas are minimal-but-real JSON Schema objects (`type: object`,
  `properties`, no `required` beyond what's obviously fixed) — enough for
  catalog discovery and `create_panel`'s generated schema (T-1007-5) to
  merge, not a full validation contract.

Kept out: no reference to `GridRect`'s consumers, no reference to
`bindPanelSource`/`setPanelRenderer` semantics (T-1007-4), no Svelte
import anywhere in `domain/` or `registry/`.

Isolation for AC8/AC16 extensibility: `createPanelRegistry()` allocates a
fresh `Map`; the exported `panelKindRegistry` singleton and
`registerDefaultPanelKinds` are never called from within
`createPanelRegistry()` itself — only from a composition root (future
ticket) and from tests that explicitly want the seeded defaults.
