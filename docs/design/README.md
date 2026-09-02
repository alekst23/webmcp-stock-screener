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
- [Market Data Storage](market-data-storage/spec.md) — how the historical
  price panel is stored, loaded, and queried so memory is bounded by the
  query rather than the size of the dataset.

## New WebMCP Surface (full replacement, in progress)

Specs for the tool surface described in `docs/reference/tool-spec.md`, built
alongside the Core Product surface above and cut over at the end.

- [Workspace & Revisions](workspace-revisions/spec.md) — the workspace
  document, stable IDs, revisions, the mutation envelope, idempotency,
  undo, and the operation registry every other feature here builds on.
- [Discovery & Catalog](discovery-and-catalog/spec.md) — resolve free text
  to canonical instrument IDs, and search/describe the typed catalog of
  fields, operators, studies, indicators, patterns, intervals, universes,
  and templates. Owns the catalog registry the filter-tree and chart-study
  features validate against.
- [Panel System](panel-system/spec.md) — the agent-driven panel container:
  add, update, lay out on a logical grid, link, and remove panels, plus the
  typed panel-kind registry other features plug into.
- [Chart Tools](chart-tools/spec.md) — configure charts, edit studies, read
  bounded OHLCV and study output, annotate, and capture a reference setup.
- [Screener Core](screener-core/spec.md) — screener definition, universe,
  the typed filter tree with all eight condition types, ranking,
  validation, and pinned runs.
- [Results & Explain](results-and-explain/spec.md) — the results table,
  bounded reads from a pinned run that never silently rerun, selection, and
  per-filter pass/fail with ranking contributions.
- [Similarity Search](similarity-search/spec.md) — find historical windows
  resembling a captured setup, explain a match feature by feature, and
  compare candidates as overlays or small multiples.
- [Safety: Preview & Apply](safety-preview-apply/spec.md) — validate a
  typed batch of proposed operations, return the exact diff, then apply it
  atomically. Preview honesty and atomicity are structural.
- [Screener Follow-up Tools](screener-followup-tools/spec.md) — computed
  fields, custom studies, derived filters, similarity refinement,
  backtesting, watchlists, the alert draft/review/enable gate, and export.
- [Legacy Surface Cutover](legacy-surface-cutover/spec.md) — retire the
  original 11-tool surface once the above reaches capability parity,
  keeping the WebMCP transport layer.

## Presentation

- [Terminal UI Theme](terminal-ui-theme/spec.md) — the single dark,
  high-density visual treatment shared by every route: the named palette,
  the measured contrast floor, and the shell the workbench lays out in.
