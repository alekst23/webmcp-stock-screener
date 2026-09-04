# T-0026-5: Register the MVP tool set in the composition root

**Epic**: EPIC-0026 (Agent Screener Loop)
**Design**: docs/design/screener-core/, docs/architecture/tool-surface-mvp.md
**Status**: Not started
**Depends on**: T-0026-3, T-0026-4
**Blocks**: T-0026-6 (engine deletion/status doc need the final registered set to know what's actually dead)
**Resolves**: #26

## Description

_Split out of the original T-0026-3 — see that ticket's note. This is the
registration/cleanup change alone, after the data shape (T-0026-3) and the
real evaluation port (T-0026-4) both exist to register._

`workbenchCompositionRoot.ts` currently registers only panel tools,
`resolveTicker`, and `search_catalog` (T-0026-2) — `registerWorkbenchTools`
and `registerScreenerTools` (which includes `run_screener`,
`get_canvas_state`, and the old five-tool legacy screener surface) have
been commented out since EPIC-1015's "chart-demo trim," predating this
epic. `define_screener` (T-0026-1) was never registered anywhere either.

This ticket makes the composition root register exactly
`docs/architecture/tool-surface-mvp.md`'s core seven —
`search_catalog`, `define_screener`, `run_screener`, `get_screener_results`,
`create_panel`, `get_canvas_state`, `remove_panel` — plus `set_panel_layout`
if kept (decide at implementation time; it's harmless and already active).
Every tool the MVP doesn't need, including the old five-tool legacy
screener group, chart/similarity/follow-up-authoring tool groups, and any
workbench-lifecycle tools not in the list, is **removed from the file, not
left commented** — the doc's explicit requirement, and the thing the
original bundled ticket never got to.

## User Story

As the composition root,
I want to register exactly the tools the MVP use case needs, with
everything else actually deleted rather than dormant,
so that what's live matches what's documented, and an agent calling
`define_screener` → `run_screener` → `get_screener_results` →
`create_panel` gets a working loop end to end.

## Acceptance Criteria

1. `define_screener`, `run_screener`, and `get_canvas_state` are
   registered and reachable from `/workbench`'s real entry point (not just
   exercised by a test harness).
2. `run_screener`'s default port is T-0026-4's `HttpScreenerEvaluationPort`
   (no override needed for a real call to work).
3. The old five-tool legacy screener group (`create_screener`,
   `set_screener_universe`, `edit_filter_tree`, `set_screener_ranking`,
   `validate_screener`) is deleted from the composition root — not
   commented out — along with any now-fully-unreferenced code that backed
   only those tools.
4. `registerWorkbenchTools`'s commented-out call site is either restored
   (if `get_canvas_state` is its only MVP-relevant export and the rest is
   pruned) or replaced with a narrower registration — decide and document
   which, but leave nothing commented either way.
5. Chart/similarity/follow-up-authoring tool groups remain exactly as they
   are today (registered or not) — this ticket's scope is the screener/
   workbench-core groups only; do not change chart tool registration as a
   side effect.
6. An end-to-end integration test proves `define_screener` → `run_screener`
   → `get_screener_results` → `create_panel` against the real (not
   overridden) composition root, using a fake backend response at the HTTP
   boundary rather than an `evaluationPort` override — this is what proves
   T-0026-4's default wiring, not just its unit behavior.
7. `npm run typecheck` and the full frontend suite are clean after the
   deletions — a removed-but-still-imported symbol is a build break, not a
   warning.

## Out of Scope

- Deleting the in-browser screener engine itself (only the tool
  registrations that call it) — T-0026-6.
- `PinnedRunStore` retention policy — T-0026-6.
- `docs/architecture/tool-surface-status.md` — T-0026-6.
