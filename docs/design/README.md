# Design Docs Index

Feature behavioral specs, organized by concept — not by epic. A single
feature spec may be touched by multiple epics as it evolves.

## Core Product

- [Pattern Research Workbench](pattern-research-workbench/spec.md) — the
  shared human-agent research session: define studies and temporal setups,
  search history for matches, measure and visualize outcomes.
- [Workspace Snapshots](workspace-snapshots/spec.md) — save the current
  workspace under a name and recall/switch between saved snapshots,
  local to one browser.

## New WebMCP Surface (full replacement, in progress)

- [Panel System](panel-system/spec.md) — the agent-driven panel
  container: add, update, lay out on a logical grid, link, and remove
  panels, plus the typed panel-kind registry other features plug into.
- [Discovery & Catalog](discovery-and-catalog/spec.md) — resolve free text
  to canonical instrument IDs, and search/describe the typed catalog of
  fields, operators, studies, indicators, patterns, intervals, universes,
  and templates. Owns the catalog registry the filter-tree and chart-study
  epics validate against.
- [Screener Core](screener-core/spec.md) — create a screener, set its
  universe, build a nested filter tree from typed conditions, rank and
  validate it, and execute one revision into a pinned `run_id`.
