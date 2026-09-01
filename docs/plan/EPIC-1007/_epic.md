# EPIC-1007: Panel System

**Depends on**: EPIC-1006 (common workspace contract — must land first)
**Blocks**: EPIC-1009 (screener), EPIC-1010 (results table), EPIC-1011 (chart), EPIC-1012 (similarity) — each plugs a panel kind into this epic's registry. EPIC-1010 and EPIC-1011 additionally depend on this epic's source/renderer contract registry (T-1007-7) landing before their table-renderer and chart-renderer contracts can register into it.
**Design**: docs/design/panel-system/

## Description

The new WebMCP surface described in `docs/reference/tool-spec.md` treats the
workbench as a configurable, Bloomberg-style canvas of panels an agent
composes: add a filter builder next to a chart, wire the results table's
selection into that chart, collapse the study library, take the alerts
panel away, or turn the same screener run into a table, a chart grid, or a
heatmap without re-running anything. Today the app has a fixed panel
arrangement with no addressable container — an agent can create a grid or
a chart, but cannot name a panel kind, place it, resize it, hide it,
retitle it, link it, or remove it.

The spec's key architectural idea is that a panel's **source** and its
**renderer** are independent axes: the source (a screener run, a
watchlist, a symbol list, or another panel) says what data the panel
shows; the renderer (table, chart grid, heatmap, scatter plot, and so on)
says how it is shown. Either can change without touching the other.

This epic delivers the panel *container*: the panel entity and stable-ID
addressing, a logical grid layout model, a per-channel panel link graph,
an extensible source/renderer contract registry, and the fourteen panel
tools — `create_panel`, `duplicate_panel`, `remove_panel`,
`set_panel_layout`, `apply_layout_template`, `split_panel`,
`maximize_panel`, `bind_panel_source`, `set_panel_renderer`,
`configure_chart_grid`, `configure_panel_view`, `link_panels`,
`unlink_panels`, and `set_panel_selection` — plus the typed panel-kind
registry sibling epics plug a panel kind into and the source/renderer
contract registry they plug a renderer contract into, without editing
anything in this epic.

Everything is built in new files alongside the existing 11-tool
pattern-research surface, which is retired separately by EPIC-1015. `main`
stays deployable throughout.

## User Story

As a researcher working with an AI agent,
I want the agent to compose, arrange, connect, and tear down the panels of
my workspace by name,
so that I can ask for a research layout in words and watch it assemble,
rearrange, and stay in sync — without losing track of what changed or
being unable to undo it.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1007-1 | Panel entity and typed panel-kind registry | — | Open |
| 2 | T-1007-2 | Logical grid layout model | — | Open |
| 3 | T-1007-3 | Panel link graph | — | Open |
| 4 | T-1007-4 | Panel mutation use cases over the common contract | T-1007-1, T-1007-2, T-1007-3 | Open |
| 5 | T-1007-7 | Panel source and renderer contract registry | T-1007-1 | Open |
| 6 | T-1007-5 | The fourteen panel WebMCP tools | T-1007-4, T-1007-7 | Open |
| 7 | T-1007-6 | Panel container rendering and tool wiring | T-1007-5 | Open |

## Dependency Graph

```
T-1007-1 ──┐
T-1007-2 ──┼──> T-1007-4 ──┐
T-1007-3 ──┘               │
                            ├──> T-1007-5 ──> T-1007-6
T-1007-1 ──────> T-1007-7 ──┘
```

## Wave Plan

- **Wave 1** (parallel): T-1007-1, T-1007-2, T-1007-3 — three independent
  pure-domain modules with no dependency on each other
- **Wave 2** (parallel): T-1007-4 — composes all three over EPIC-1006's
  workspace, revision, envelope, and undo contracts; T-1007-7 — the
  source/renderer contract registry, which only needs T-1007-1's panel
  entity and runs independently of T-1007-4
- **Wave 3**: T-1007-5 — tool specs and JSON schemas over the use cases
  and the source/renderer registry
- **Wave 4**: T-1007-6 — renders the container and registers the tools

## Acceptance Criteria

1. A panel of any of the eight kinds (`filter_builder`, `chart`,
   `study_library`, `results_table`, `similar_opportunities`,
   `watchlist`, `alerts`, `symbol_details`) can be created via
   `create_panel` with an initial source and renderer, and receives a
   stable ID, a default title, a default configuration, and a
   non-overlapping position on the grid.
2. `duplicate_panel` copies a panel's kind, configuration, source, and
   renderer to a new panel with a fresh stable ID, optionally overriding
   the symbol or source; the original panel is unaffected.
3. A panel's title, visibility, and collapsed state can each be changed
   independently, addressed by stable ID, through `configure_panel_view`.
4. Panels are positioned and sized exclusively in logical grid
   coordinates via `set_panel_layout`; no pixel value appears anywhere in
   the panel model or in any tool's input schema.
5. `apply_layout_template` arranges the workspace's panels according to a
   named template (`three_columns`, `quad`, `chart_wall_3x3`,
   `focus_with_sidebar`), replacing every named panel's footprint
   atomically; an unknown template name is rejected and lists the
   registered templates.
6. `split_panel` divides an existing panel's region horizontally or
   vertically, creating a new panel in the freed cells and shrinking the
   original's footprint; a split that would leave either resulting
   footprint below its kind's minimum size is rejected.
7. `maximize_panel` temporarily gives one panel the full grid without
   altering any panel's saved footprint; unmaximizing restores the prior
   rendered layout exactly, and the saved layout was never mutated by
   maximizing.
8. A batch layout change (`set_panel_layout` or `apply_layout_template`)
   applies to every named panel or to none of them; out-of-bounds,
   below-minimum, and overlapping placements are rejected with an error
   naming the specific violation.
9. `bind_panel_source` connects a panel to a screener run, a watchlist, a
   symbol list, or another panel, validated against the source types the
   panel's kind and active renderer accept; an incompatible source type
   is rejected and lists the accepted types.
10. `set_panel_renderer` converts a panel's presentation between table,
    chart grid, heatmap, scatter plot, and any other registered renderer
    without changing its source; configuration is preserved where the
    new renderer's contract accepts it and cleared, with a warning,
    where it does not.
11. `configure_panel_view` and `configure_chart_grid` validate their
    input against the configuration contract the panel's active renderer
    registered (AC16), rather than against renderer knowledge hardcoded
    in this epic.
12. Two or more panels can be linked via `link_panels` on any of
    `symbol`, `timeframe`, `result_selection`, `crosshair`, or `filters`;
    a change on a channel propagates to every other panel in that
    channel's group and to no panel outside it. `unlink_panels` removes a
    panel from one named channel's group without affecting its
    membership in any other channel.
13. `set_panel_selection` selects one or more results in a panel and
    propagates the selection to every panel linked to it on the
    `result_selection` channel.
14. `remove_panel` frees the removed panel's grid cells, drops it from
    every link group, dissolves any group left with fewer than two
    members, and supports undo.
15. Every one of the fourteen tools accepts `expected_revision` and
    `idempotency_key` and returns the EPIC-1006 mutation envelope; a
    stale revision is rejected as a conflict and a replayed idempotency
    key returns the original result without applying a second change.
16. A new panel kind can be contributed by registering a kind
    definition — title, default and minimum size, default configuration,
    configuration validator and schema, link channels, binding types, and
    a body component — with no change to any file in this epic's
    container, layout, link, use-case, or tool modules. A new source type
    or renderer type can likewise be contributed to the source/renderer
    contract registry without editing this epic's tool implementations.
17. The eight kinds are addable, layoutable, linkable, and rendered
    end-to-end in the browser through the WebMCP tool surface, including
    at least one non-default renderer (chart grid) reachable on a `chart`
    panel via `set_panel_renderer`.
18. The existing 11-tool surface, `src/lib/workspace/store.ts`, and the
    current UI are unmodified, and the app remains deployable.

## Design References

- `docs/design/panel-system/spec.md` — behavioral spec: the six features,
  their scenarios, and the five recorded open questions with stated
  assumptions
- `docs/design/panel-system/technical.md` — the registry surface sibling
  epics plug into, the grid and link contracts, and what is consumed from
  EPIC-1006 rather than built here
- `docs/reference/tool-spec.md` — program-level source of truth for the
  ~33-tool surface and the common mutation contract; its "Panels: source
  and renderer are separate" section is this epic's central design idea
- `docs/plan/EPIC-1006/_epic.md` — the workspace/revision model, stable
  IDs, mutation envelope, `expected_revision`, `idempotency_key`, undo
  tokens, and provenance type this epic consumes
- `src/lib/webmcp/tools.ts` — existing `ToolSpec` factory, `ok`/`fail`
  result shaping, and availability-gating conventions to follow in the
  new surface
- `src/lib/webmcp/register.ts` — how tools are registered against
  `document.modelContext` and kept in sync with workspace state
- `src/lib/webmcp/types.ts` — existing `ToolSpec` / `ToolResult` /
  `ModelContext` shapes

## Out of Scope

- The *contents* of any panel: the filter tree (EPIC-1009), similarity
  search (EPIC-1012). This epic ships each of the eight kinds as a
  registered placeholder definition those epics replace.
- The renderer-specific *catalogs and validation contracts* — available
  result columns, available studies/indicators, their defaults and
  formatting rules — that `configure_panel_view` and `configure_chart_grid`
  validate against. EPIC-1010 registers the table-renderer contract and
  EPIC-1011 registers the chart-renderer contract into this epic's
  source/renderer registry; this epic builds the registry mechanism, not
  the contracts.
- The common workspace contract itself — owned by EPIC-1006.
- Reference/fundamental market data (sectors, industries, indexes,
  exchanges, countries, fundamentals, earnings calendars) — a separate
  parallel workstream. Panel bodies receive it through EPIC-1006's
  provenance type; this epic builds no data pipeline for it.
- Retiring the existing 11 tools and the current UI — EPIC-1015.
- Saving/restoring named workspace revisions, `preview_workspace_changes`
  / `apply_previewed_changes`, and `get_canvas_state` / `get_app_context`.
- Drag-to-resize gestures and responsive breakpoint behavior beyond
  mapping the logical grid onto the viewport.

## Open Questions

Carried from `docs/design/panel-system/spec.md`, each with a stated
assumption already applied to the tickets — none blocks implementation:

1. Grid column count is unspecified in the tool spec — assuming a fixed
   12-column, unbounded-row grid.
2. Link directionality is unspecified — assuming symmetric per-channel
   link groups.
3. "Bound resource" is not enumerated — assuming an opaque
   `{ type, id }` reference validated by the panel kind.
4. Overlap policy is unspecified — assuming overlap is rejected rather
   than auto-reflowed.
5. Hidden-vs-removed semantics are unspecified — assuming a hidden panel
   keeps its state and stored position but does not reserve grid space.
6. **The "collection" kind.** `docs/reference/tool-spec.md`'s `create_panel`
   example uses `"kind": "collection"`, which does not match any of the
   eight registered kinds (a `collection` reads as many items sharing one
   `chart_grid`/heatmap renderer — e.g. the top nine matches from a
   screener run, each as its own small chart). *Assumption*: no new kind
   is added: an existing kind (`chart`) is reused with its `renderer`
   field set to `chart_grid`, and the source/renderer contract, not the
   kind, is what determines whether a panel shows one item or a
   collection. This is a stated assumption, not a resolved decision — the
   user should confirm before T-1007-1's placeholder registrations are
   finalized.
