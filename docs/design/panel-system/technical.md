# Panel System — Technical Design

All new code lives under `src/lib/panels/` (domain + registry + layout +
links) and `src/lib/webmcp/v2/` (tool surface). Nothing in
`src/lib/webmcp/tools.ts` or `src/lib/workspace/` is modified — the panel
system is built alongside the existing 11-tool surface, which EPIC-1015
retires separately.

Layering: `panels/domain` (pure, no I/O) ← `panels/registry` ←
`panels/application` (use cases producing mutation envelopes) ←
`webmcp/v2` (tool specs) ← Svelte components. Domain never imports from
the registry's concrete kind definitions or from any component.

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
| `defaultSize` | `GridSize` | logical cells, used when `add_panel` omits a size |
| `minSize` | `GridSize` | rejected below this by `set_panel_layout` |
| `defaultConfig` | `() => TConfig` | configuration for a freshly added panel |
| `validateConfig` | `(input: unknown) => ConfigValidation<TConfig>` | `{ ok: true, value }` or `{ ok: false, errors }` — errors carry field paths and reasons |
| `configSchema` | `object` | JSON Schema fragment merged into `add_panel`/`update_panel` tool schemas and returned by catalog discovery |
| `linkChannels` | `PanelLinkChannel[]` | channels this kind may join |
| `bindingTypes` | `string[]` | resource types `update_panel`'s rebind accepts (empty = not bindable) |
| `component` | `() => Promise<Component>` | lazy loader for the panel body |

Sibling epics call `registerPanelKind` from their own module; EPIC-1007
ships all eight kinds as placeholder definitions (real `defaultSize`,
`linkChannels`, and `configSchema`; a stub body and a permissive
`validateConfig`) so the five tools work end-to-end from day one. A
sibling replaces its kind's definition by owning the registration —
no edit to the container.

### Grid layout (`src/lib/panels/layout.ts`)

Pure geometry over a fixed 12-column, unbounded-row logical grid.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `GridPosition` | `{ col: number; row: number }` | zero-based, `col` in `[0, GRID_COLUMNS)` |
| `GridSize` | `{ colSpan: number; rowSpan: number }` | both `>= 1` |
| `GridRect` | `GridPosition & GridSize` | a panel's footprint |
| `GRID_COLUMNS` | `12` | see spec Open Question 1 |
| `rectsOverlap` | `(a: GridRect, b: GridRect) => boolean` | half-open interval intersection |
| `validatePlacement` | `(rect, kind, occupied) => PlacementResult` | bounds, min-size, and overlap checks in one pass; error names the offending panel or bound |
| `findFreeRect` | `(size: GridSize, occupied: OccupiedRect[]) => GridRect` | deterministic top-left-first auto-placement for `add_panel` |
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
| `binding` | `{ type: string; id: string } \| null` | spec Open Question 3 |

### Use cases (`src/lib/panels/application/`)

One function per tool, each `(workspace, request) => MutationEnvelope`,
each registering an inverse operation with EPIC-1006's undo store:
`addPanel`, `updatePanel`, `setPanelLayout`, `linkPanels`, `removePanel`.

### Tool surface (`src/lib/webmcp/v2/panelTools.ts`)

Five `ToolSpec`s (`add_panel`, `update_panel`, `set_panel_layout`,
`link_panels`, `remove_panel`) built from the use cases, following the
existing `buildTools(engine)` factory shape and `ok`/`fail` result
shaping in `src/lib/webmcp/tools.ts` — reimplemented in `v2`, not
imported across the old/new boundary.

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

`add_panel` → validate kind in registry → validate config via the kind →
resolve a `GridRect` (explicit, else `findFreeRect`) → `validatePlacement`
→ mint ID → append to workspace panels → bump revision → envelope.

A linked change (e.g. the chart's symbol) reaches
`propagationTargets(graph, 'symbol', sourcePanelId)` and is applied to
each target's config by that target's kind, not by the container.

---

*Product design: [spec.md](spec.md)*
