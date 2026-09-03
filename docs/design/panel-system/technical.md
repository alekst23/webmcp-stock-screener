# Panel System — Technical Design

All new code lives under `src/lib/panels/` (domain + registry + layout +
links) and `src/lib/webmcp/v2/` (tool surface). Nothing in
`src/lib/webmcp/tools.ts` or `src/lib/workspace/` is modified — the panel
system is built alongside the existing 11-tool surface, which EPIC-1015
retires separately.

Layering: `panels/domain` (pure, no I/O) ← `panels/registry` (panel-kind
registry and source/renderer registry) ← `panels/application` (use cases
producing mutation envelopes) ← `webmcp/v2` (tool specs) ← Svelte
components. Domain never imports from either registry's concrete
definitions or from any component.

## Consumed from EPIC-1006 (not defined here)

| Contract | Provided by | Used for |
|----------|-------------|----------|
| `WorkspaceId`, `Revision`, stable-ID minting | EPIC-1006 | panel IDs (`panel_<kind>_<n>`) |
| `MutationEnvelope` | EPIC-1006 | every panel mutation's return value |
| `MutationRequest` (`expected_revision`, `idempotency_key`) | EPIC-1006 | conflict + replay handling |
| `UndoToken` / inverse-operation registration | EPIC-1006 | `remove_panel` and friends being reversible |
| `Provenance` (`as_of`, source, delayed/live) | EPIC-1006 | passed through by panel bodies; not produced here |

EPIC-1007 must not re-implement any of these. If EPIC-1006 has not
landed, T-1007-4 is blocked.

## Contracts

### `PanelKind` and the registry (`src/lib/panels/registry.ts`)

The plug-point sibling epics use. A sibling registers its kind at module
load; the panel container never imports the sibling's module directly.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `PanelKindDefinition<TConfig>` | interface | everything the container needs to create, validate, place, link, and render a panel of one kind |
| `registerPanelKind` | `(def: PanelKindDefinition) => void` | throws on duplicate `kind` rather than overwriting |
| `getPanelKind` | `(kind: string) => PanelKindDefinition \| undefined` | lookup for validation and rendering |
| `listPanelKinds` | `() => PanelKindDefinition[]` | powers the "unknown kind" error and catalog discovery |
| `createPanelRegistry` | `() => PanelRegistry` | isolated registry instance so tests never touch module-global state |

`PanelKindDefinition<TConfig>` fields:

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `string` | unique key, e.g. `'chart'` |
| `defaultTitle` | `string` | title given to a new panel of this kind |
| `defaultSize` | `GridSize` | logical cells, used when `create_panel` omits a size |
| `minSize` | `GridSize` | rejected below this by `set_panel_layout` and `split_panel` |
| `defaultConfig` | `() => TConfig` | configuration for a freshly added panel |
| `validateConfig` | `(input: unknown) => ConfigValidation<TConfig>` | `{ ok: true, value }` or `{ ok: false, errors }` — errors carry field paths and reasons; for a data-bearing kind this delegates to the active renderer's own `validateConfig` from the source/renderer registry below |
| `configSchema` | `object` | JSON Schema fragment merged into `create_panel`'s per-kind schema and returned by catalog discovery |
| `linkChannels` | `PanelLinkChannel[]` | channels this kind may join |
| `bindingTypes` | `string[]` | source type names (registered in the source/renderer registry below) that `bind_panel_source` accepts for this kind (empty = not bindable) |
| `component` | `() => Promise<Component>` | lazy loader for the panel body |

Sibling epics call `registerPanelKind` from their own module; EPIC-1007
ships all eight kinds as placeholder definitions (real `defaultSize`,
`linkChannels`, `bindingTypes`, and `configSchema`; a stub body and a
permissive `validateConfig`) so the fourteen tools work end-to-end from
day one. A sibling replaces its kind's definition by owning the
registration — no edit to the container.

### Source/renderer registry (`src/lib/panels/sourceRendererRegistry.ts`)

The second plug-point (T-1007-7), independent of the panel-kind registry
above: a panel's kind rarely changes after creation, but its source and
renderer change routinely, so they are looked up and revalidated on every
relevant mutation rather than fixed at creation time like a kind is.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `SourceTypeDefinition` | interface | `name`; the shape a valid source reference of that type must have (e.g. `screener_results` references a `run_id`, `panel_reference` references another panel's stable ID); a compatibility predicate deciding whether a given panel kind/renderer pair accepts it |
| `RendererTypeDefinition<TConfig>` | interface | `name`; `configSchema`; `validateConfig`; `defaultConfig`; the source types it accepts |
| `registerSourceType` | `(def: SourceTypeDefinition) => void` | throws on duplicate `name` rather than overwriting |
| `registerRendererType` | `(def: RendererTypeDefinition) => void` | throws on duplicate `name` rather than overwriting |
| `getSourceType` / `getRendererType` | `(name: string) => Definition \| undefined` | lookup for validation |
| `listSourceTypes` / `listRendererTypes` | `() => Definition[]` | powers the "unsupported source/renderer" error and catalog discovery |
| `createSourceRendererRegistry` | `() => SourceRendererRegistry` | isolated registry instance so tests never touch module-global state |

`bind_panel_source`, `set_panel_renderer`, `configure_panel_view`, and
`configure_chart_grid` all resolve through this registry rather than
switching on source or renderer type themselves. EPIC-1007 ships the four
source types (`screener_results`, `watchlist`, `symbol_list`,
`panel_reference`) and four renderer types (`table`, `chart_grid`,
`heatmap`, `scatter_plot`) named in the tool spec as placeholders — real
compatibility rules and schemas, provisional validators — so the tools
work end-to-end before EPIC-1009/1010/1011/1012 replace each validator by
re-registering its type, no edit to the container.

### Grid layout (`src/lib/panels/layout.ts`)

Pure geometry over a fixed 6-column by 4-row logical grid (24 cells,
bounded in both axes — resolved 2026-09-02, see spec's "Open Questions").
The container always renders the grid filling exactly 100% of the
viewport's width and height, so the page never scrolls: a panel spanning
`colSpan` columns occupies `colSpan / GRID_COLUMNS` of the width, and
`rowSpan` rows occupies `rowSpan / GRID_ROWS` of the height. Row/column
sizing is proportional, not fixed-pixel, so it holds at any viewport size
without introducing scroll — consistent with the spec's existing
pixel-layout/responsive-behavior non-goal.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `GridPosition` | `{ col: number; row: number }` | zero-based, `col` in `[0, GRID_COLUMNS)`, `row` in `[0, GRID_ROWS)` |
| `GridSize` | `{ colSpan: number; rowSpan: number }` | both `>= 1`; `colSpan <= GRID_COLUMNS`, `rowSpan <= GRID_ROWS` |
| `GridRect` | `GridPosition & GridSize` | a panel's footprint |
| `GRID_COLUMNS` | `6` | |
| `GRID_ROWS` | `4` | |
| `rectsOverlap` | `(a: GridRect, b: GridRect) => boolean` | half-open interval intersection |
| `validatePlacement` | `(rect, kind, occupied) => PlacementResult` | bounds, min-size, and overlap checks in one pass; error names the offending panel or bound |
| `findFreeRect` | `(size: GridSize, occupied: OccupiedRect[]) => GridRect \| null` | deterministic top-left-first auto-placement for `create_panel`; returns `null` — not a throw — when no free rect of that size exists anywhere in the bounded grid, so the caller reports "grid is full" rather than the search overflowing past `GRID_ROWS` |
| `applyLayout` | `(panels, placements) => LayoutResult` | all-or-nothing batch move/resize |

`occupied` excludes hidden panels (spec Open Question 5).

### Link graph (`src/lib/panels/links.ts`)

Undirected groups, one set per channel (spec Open Question 2).

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `PanelLinkChannel` | `'symbol' \| 'timeframe' \| 'result_selection' \| 'crosshair' \| 'filters'` | |
| `PanelLinkGroup` | `{ id: string; channel: PanelLinkChannel; panelIds: string[] }` | |
| `linkPanels` | `(graph, channel, panelIds) => LinkResult` | merges the panels' existing groups on that channel into one; rejects self-links and kinds that do not declare the channel |
| `unlinkPanel` | `(graph, channel, panelId) => LinkResult` | dissolves a group left with `< 2` members |
| `removePanelFromGraph` | `(graph, panelId) => LinkResult` | every-channel cleanup for `remove_panel` |
| `propagationTargets` | `(graph, channel, sourceId) => string[]` | who receives a broadcast; excludes the source |

### Panel entity (`src/lib/panels/panel.ts`)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | stable, minted via EPIC-1006 |
| `kind` | `string` | must resolve in the registry |
| `title` | `string` | |
| `config` | `unknown` | validated by the kind, opaque to the container |
| `rect` | `GridRect` | |
| `hidden` | `boolean` | |
| `collapsed` | `boolean` | |
| `source` | `{ type: string; ref: unknown } \| null` | resolved and validated via the source/renderer registry; spec Open Question 3 |
| `renderer` | `string \| null` | active renderer name, resolved via the source/renderer registry; `null` until a source is bound |

### Use cases (`src/lib/panels/application/`)

One function per tool, each `(workspace, request) => MutationEnvelope`,
each registering an inverse operation with EPIC-1006's undo store:
`createPanel`, `duplicatePanel`, `removePanel`, `setPanelLayout`,
`applyLayoutTemplate`, `splitPanel`, `bindPanelSource`,
`setPanelRenderer`, `configureChartGrid`, `configurePanelView`,
`linkPanels`, `unlinkPanels`, `setPanelSelection`. `maximizePanel` is the
one exception — it does not mutate the workspace or consume a revision;
it is rendering-only client state layered over the saved layout (T-1007-4
AC10).

### Default workspace layout (seeding, not a tool)

Owned entirely by this feature, no change to EPIC-1006's `create_workspace`
required: `seedDefaultWorkspace` in `src/lib/panels/shell/panelController.ts`
runs for a newly created, still-empty workspace (`justCreated === true`)
before first paint, so the human never sees the blank intermediate state.
Not registered as a named layout template — `apply_layout_template` has no
entry for it, since re-applying it later is a distinct, explicit action
(agent lays it out or picks an actual template), not this create-time
default.

_Amended by hotfix/empty-grid-canvas — `DEFAULT_SEED_PANELS` in
`panelController.ts` is reduced to a single entry, `filter_builder` at
`{ col: 0, row: 0, colSpan: 2, rowSpan: 4 }`. This replaces the six-panel
full-tile seed (`filter_builder`, `chart`, `similar_opportunities`,
`results_table`, `watchlist`, `alert_draft`) that T-1015-12 grew the
original three-panel seed into — see spec.md's amended "Seed a new
workspace with the default layout" section for the product intent behind
the change._

### Illustrate the empty grid

New in hotfix/empty-grid-canvas. A pure function,
`computeEmptyCells(occupied: OccupiedRect[], columns = GRID_COLUMNS, rows = GRID_ROWS): GridRect[]`,
added to `src/lib/panels/domain/layout.ts` alongside `findFreeRect` and
reusing its `rectsOverlap` check: walks all `columns * rows` unit cells and
returns the ones not covered by any occupied rect, each as a `{ col, row,
colSpan: 1, rowSpan: 1 }`. No Protocol — a single implementation, no test
fake needed.

`PanelContainer.svelte` calls `computeEmptyCells(snapshot.rects)` and
renders one outline element per result as a sibling to each `PanelFrame`,
positioned with the same `panelFrameStyle`-style grid-line mapping
`gridStyle.ts` already uses for occupied panels. Each outline element
carries `data-testid="empty-cell"` (the contract `PanelContainer.test.ts`
asserts against) and `pointer-events: none`, styled with the existing
`--separator` token (already used for `PanelFrame`'s subtle borders),
stacked behind panel content.

### Tool surface (`src/lib/webmcp/v2/panelTools.ts`)

Fourteen `ToolSpec`s (`create_panel`, `duplicate_panel`, `remove_panel`,
`set_panel_layout`, `apply_layout_template`, `split_panel`,
`maximize_panel`, `bind_panel_source`, `set_panel_renderer`,
`configure_chart_grid`, `configure_panel_view`, `link_panels`,
`unlink_panels`, `set_panel_selection`) built from the use cases and the
source/renderer registry, following the existing `buildTools(engine)`
factory shape and `ok`/`fail` result shaping in `src/lib/webmcp/tools.ts`
— reimplemented in `v2`, not imported across the old/new boundary.
`create_panel`'s schema is generated from the panel-kind and
source/renderer registries at build time, not written out by hand.

## Default kind → link channel matrix

Shipped by EPIC-1007; a sibling epic may widen its own kind's row.

| Kind | symbol | timeframe | result_selection | crosshair | filters |
|------|:------:|:---------:|:----------------:|:---------:|:-------:|
| `filter_builder` | | | | | ✓ |
| `chart` | ✓ | ✓ | ✓ | ✓ | |
| `study_library` | ✓ | | | | |
| `results_table` | ✓ | | ✓ | | ✓ |
| `similar_opportunities` | ✓ | ✓ | ✓ | | |
| `watchlist` | ✓ | | ✓ | | |
| `alerts` | ✓ | | | | |
| `symbol_details` | ✓ | | | | |

## Data Flow

`create_panel` → validate kind in the panel-kind registry → validate
source and renderer in the source/renderer registry → validate config via
the active renderer's contract → resolve a `GridRect` (explicit, else
`findFreeRect`) → `validatePlacement` → mint ID → append to workspace
panels → bump revision → envelope.

`bind_panel_source` → look up the panel by ID → validate the new source
reference against the panel's kind and active renderer via the
source/renderer registry → replace `source` → bump revision → envelope.
Rejected without changing the panel if the source type is not accepted.

`set_panel_renderer` → look up the panel by ID → validate the requested
renderer against the panel's current source via the source/renderer
registry → for each existing configuration field, keep it if the new
renderer's schema recognizes it, else drop it and add a warning → replace
`renderer` and `config` → bump revision → envelope.

A linked change (e.g. the chart's symbol) reaches
`propagationTargets(graph, 'symbol', sourcePanelId)` and is applied to
each target's config by that target's kind, not by the container.

---

*Product design: [spec.md](spec.md)*
