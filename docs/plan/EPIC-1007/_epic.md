# EPIC-1007: Panel System

**Depends on**: EPIC-1006 (common workspace contract — must land first)
**Blocks**: EPIC-1009 (screener), EPIC-1010 (results table), EPIC-1011 (chart), EPIC-1012 (similarity) — each plugs a panel kind into this epic's registry
**Design**: docs/design/panel-system/

## Description

The new WebMCP surface described in `docs/reference/tool-spec.md` treats the
workbench as a workspace of panels an agent can compose: add a filter
builder next to a chart, wire the results table's selection into that
chart, collapse the study library, take the alerts panel away. Today the
app has a fixed panel arrangement with no addressable container — an
agent can create a grid or a chart, but cannot name a panel kind, place
it, resize it, hide it, retitle it, link it, or remove it.

This epic delivers the panel *container*: the panel entity and stable-ID
addressing, a logical grid layout model, a per-channel panel link graph,
the five workspace tools `add_panel`, `update_panel`, `set_panel_layout`,
`link_panels`, and `remove_panel`, and — the piece four sibling epics
depend on — a typed panel-kind registry that lets a feature contribute a
new panel kind without editing anything in this epic.

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
| 5 | T-1007-5 | The five panel WebMCP tools | T-1007-4 | Open |
| 6 | T-1007-6 | Panel container rendering and tool wiring | T-1007-5 | Open |

## Dependency Graph

```
T-1007-1 ──┐
T-1007-2 ──┼──> T-1007-4 ──> T-1007-5 ──> T-1007-6
T-1007-3 ──┘
```

## Wave Plan

- **Wave 1** (parallel): T-1007-1, T-1007-2, T-1007-3 — three independent
  pure-domain modules with no dependency on each other
- **Wave 2**: T-1007-4 — composes all three over EPIC-1006's workspace,
  revision, envelope, and undo contracts
- **Wave 3**: T-1007-5 — tool specs and JSON schemas over the use cases
- **Wave 4**: T-1007-6 — renders the container and registers the tools

## Acceptance Criteria

1. A panel of any of the eight kinds (`filter_builder`, `chart`,
   `study_library`, `results_table`, `similar_opportunities`,
   `watchlist`, `alerts`, `symbol_details`) can be added to a workspace
   and receives a stable ID, a default title, a default configuration,
   and a non-overlapping position on the grid.
2. A panel's title, configuration, visibility, collapsed state, and bound
   resource can each be changed independently, addressed by stable ID.
3. Panels are positioned and sized exclusively in logical grid
   coordinates; no pixel value appears anywhere in the panel model or in
   any tool's input schema.
4. A batch layout change applies to every named panel or to none of them;
   out-of-bounds, below-minimum, and overlapping placements are rejected
   with an error naming the specific violation.
5. Two or more panels can be linked on any of `symbol`, `timeframe`,
   `result_selection`, `crosshair`, or `filters`; a change on a channel
   propagates to every other panel in that channel's group and to no
   panel outside it.
6. Removing a panel by ID frees its grid cells, drops it from every link
   group, and dissolves any group left with fewer than two members.
7. Every one of the five tools accepts `expected_revision` and
   `idempotency_key` and returns the EPIC-1006 mutation envelope; a stale
   revision is rejected as a conflict and a replayed idempotency key
   returns the original result without applying a second change.
8. Every one of the five mutations can be reversed with the undo token it
   returned, restoring the workspace to its prior panel, layout, and link
   state.
9. A new panel kind can be contributed by registering a kind definition —
   title, default and minimum size, default configuration, configuration
   validator and schema, link channels, binding types, and a body
   component — with no change to any file in this epic's container,
   layout, link, use-case, or tool modules.
10. The eight kinds are addable, layoutable, linkable, and rendered
    end-to-end in the browser through the WebMCP tool surface.
11. The existing 11-tool surface, `src/lib/workspace/store.ts`, and the
    current UI are unmodified, and the app remains deployable.

## Design References

- `docs/design/panel-system/spec.md` — behavioral spec: the six features,
  their scenarios, and the five recorded open questions with stated
  assumptions
- `docs/design/panel-system/technical.md` — the registry surface sibling
  epics plug into, the grid and link contracts, and what is consumed from
  EPIC-1006 rather than built here
- `docs/reference/tool-spec.md` — program-level source of truth for the
  ~33-tool surface and the common mutation contract
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

- The *contents* of any panel: the filter tree (EPIC-1009), the results
  table's columns and selection semantics (EPIC-1010), chart
  configuration and studies (EPIC-1011), similarity search (EPIC-1012).
  This epic ships each of the eight kinds as a registered placeholder
  definition those epics replace.
- The common workspace contract itself — owned by EPIC-1006.
- Reference/fundamental market data (sectors, industries, indexes,
  exchanges, countries, fundamentals, earnings calendars) — a separate
  parallel workstream. Panel bodies receive it through EPIC-1006's
  provenance type; this epic builds no data pipeline for it.
- Retiring the existing 11 tools and the current UI — EPIC-1015.
- Saving/restoring named workspace revisions, `preview_workspace_changes`
  / `apply_previewed_changes`, and `get_workspace` / `get_app_context`.
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
