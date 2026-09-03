# Design Docs Index

Feature behavioral specs, organized by concept — not by epic. A single
feature spec may be touched by multiple epics as it evolves.

## Core Product

EPIC-1015 cut the app over from the original 11-tool event-atom workbench
to this surface; it is what `/` runs today. Specs for the retired surface
live under "Superseded", below, not deleted outright.

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
  Only `create_computed_field`/`create_custom_study` are live; the rest of
  this group is merged but not yet wired into the app — see
  `docs/tools.md`'s "Not yet part of the live tool surface".
- [Legacy Surface Cutover](legacy-surface-cutover/spec.md) — the cutover
  itself: route migration onto this surface, the shared shell, the
  11-tool removal, backend reconciliation, and this documentation pass.
- [Workbench Composition Root](workbench-composition-root/spec.md) — the
  shared runtime that lets `/`'s tool groups actually talk to each other
  (one `WorkspaceRepository`/`PinnedRunStore` instead of each tool group
  building its own), plus auto-binding a completed screener run to the
  results panel.
- [Market Data Storage](market-data-storage/spec.md) — how the historical
  price panel is stored, loaded, and queried so memory is bounded by the
  query rather than the size of the dataset.

## Presentation

- [Terminal UI Theme](terminal-ui-theme/spec.md) — the single dark,
  high-density visual treatment shared by every route: the named palette,
  the measured contrast floor, and the shell the workbench lays out in.

## Superseded

Retired concepts, kept rather than deleted per project convention (specs
are amended or marked superseded, not stripped out — see each file's own
banner for what replaced it and why). Not current behavior; do not build
against these.

- [Pattern Research Workbench](pattern-research-workbench/spec.md) — the
  original event-atom research session (studies, temporal setups, instance
  search/measurement). Superseded by Screener Core, Panel System, and
  Chart Tools above; see `docs/tools.md`'s "Capability changes" for what
  did and did not carry over.
- [Workspace Snapshots](workspace-snapshots/spec.md) — named,
  `localStorage`-local point-in-time snapshots. Superseded by Workspace &
  Revisions' `save_workspace`/`restore_workspace_revision`/
  `get_change_history`/`undo_change`.
