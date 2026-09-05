# Tool Surface Status

What's actually registered on `/` today vs. what's built but switched off.
Source of truth: `src/lib/workbench/composition/workbenchCompositionRoot.ts`
(called by `src/routes/+page.svelte`). See
[New WebMCP Surface](new-webmcp-surface.md) for the broader design — that doc
predates the chart-demo trim below and is stale on tool counts.

## Active (9 tools)

**Panel tools (3 of 15)** — `registerPanelTools()`, filtered by
`TOOLS_OFF_MVP_SURFACE` (`registerPanelTools.ts`) against
[tool-surface-mvp.md](tool-surface-mvp.md)'s served set:
`create_panel`, `remove_panel`, `set_panel_layout`

**Results tools (1 of 2)** — same call, same filter: `get_screener_results`

**Chart (1)** — `registerResolveTickerTool()`, always on: `resolve_ticker`

**Discovery (1)** — `registerSearchCatalogTool()`, added standalone by
T-0026-2, always on: `search_catalog`

**Workbench-core (1)** — `registerCanvasStateTool()`, T-0026-5: pulls just
`get_canvas_state` out of `registerWorkbenchTools`' full `buildWorkbenchTools`
output rather than registering that group wholesale: `get_canvas_state`

**Screener (2)** — `registerScreenerTools()`, T-0026-5: `group.ts`'s
`buildScreenerTools` now builds exactly `SCREENER_TOOL_NAMES`
(`define_screener` absorbed the five sequential mutation tools this group
used to register — see `group.ts`'s own header) — this call is no longer
commented out: `define_screener`, `run_screener`

## Filtered at `registerPanelTools()` (13 tools)

`buildPanelTools()`/`buildResultsTools()` still build their full rosters —
each tool stays defined and unit-tested at its own module
(`panelTools.test.ts`, `resultsTools.test.ts`, etc.) — but `TOOLS_OFF_MVP_SURFACE`
drops these before registration, matching
[tool-surface-mvp.md](tool-surface-mvp.md)'s "deliberately absent" table:

| Tool | Doc's reason |
|---|---|
| `duplicate_panel`, `apply_layout_template`, `split_panel`, `maximize_panel`, `reset_layout` | Expressible via `create_panel` + `set_panel_layout`, or client-only UI state |
| `bind_panel_source`, `set_panel_renderer`, `configure_chart_grid`, `configure_panel_view` | Mutate-in-place config; MVP creates with the right source/renderer and recreates if it changes |
| `link_panels`, `unlink_panels`, `set_panel_selection` | List → chart is a copy-out, not a live link; selection stays a human UI affordance |
| `explain_result` | Correct and valuable, but not exercised by the MVP use case — first candidate after MVP |

`reset_layout` (added by #23, after this doc's last tool-count sync) was
never in the 14/21-tool counts above — a genuine gap this pass closed, not
just a rename.

## Commented out in `workbenchCompositionRoot.ts` (3 groups)

Left in place as a straight uncomment (imports + call sites both commented),
per the "Trim the WebMCP tool surface to a chart-only demo set" plan.
Unchanged by T-0026-5 — out of that ticket's scope:

| Group | Register call | Tools |
|---|---|---|
| Chart authoring | `registerChartTools` | `capture_chart_setup`, `add_chart_annotation`, `get_chart_data` |
| Similarity | `registerSimilarityTools` | `find_similar_setups`, `explain_similarity`, `compare_setups` |
| Follow-up authoring | `registerFollowupAuthoringTools` | `create_computed_field`, `create_custom_study` |

## Registered but not called at all (8 tools)

`registerWorkbenchTools()` itself (the full group behind
`WORKBENCH_TOOLS_ENABLED`) is never called from this composition root — not
even commented — now that `registerCanvasStateTool()` pulls out the one MVP
tool it needs. The other eight tools that group would register have no
caller here:

`get_app_context`, `create_workspace`, `save_workspace`, `undo_change`,
`get_change_history`, `restore_workspace_revision`,
`preview_workspace_changes`, `apply_previewed_changes`

Similarly, `registerScreenerTools()`'s full pre-T-0026-5 group (the five
sequential mutation tools `define_screener` replaced) is not registered
anywhere on this route: `create_screener`, `edit_filter_tree`,
`set_screener_ranking`, `set_screener_universe`, `validate_screener`
(`validate_screener`'s own module was deleted outright — see `group.ts`'s
header — the other four still exist and are exercised only by other
tickets' test fixtures).

## Built but not wired into this composition root at all (10 tools)

Watchlist, alerts, backtest, and export tools exist and have their own
builders, but they're only ever registered through
`workbench/followup/tools/registerAllFollowupTools.ts`'s own
`registerAllFollowupTools()` — a separate composition root with no caller
anywhere in the app (only its own tests exercise it). Not referenced from
`workbenchCompositionRoot.ts`, not even as a comment.

`upsert_watchlist`, `save_results_to_watchlist`, `create_alert_draft`,
`edit_alert_draft`, `enable_alert`, `disable_alert`, `preview_alert`,
`backtest_screener`, `get_backtest_results`, `export_results`

## Restoring the full surface

Drop a name from `TOOLS_OFF_MVP_SURFACE` (`registerPanelTools.ts`) to restore
one panel/results tool — no other change needed, its module and tests are
untouched. For the other three groups: uncomment the three import blocks and
call sites in
`registerWorkbenchComposition()` (`workbenchCompositionRoot.ts`) for
chart-authoring/similarity/follow-up-authoring. For the rest of
workbench-core, call `registerWorkbenchTools(workbenchDeps)` instead of (or
alongside) `registerCanvasStateTool(workbenchDeps)`; for the rest of the
screener surface, register the pre-T-0026-5 tool group instead of (or
alongside) `group.ts`'s narrowed `buildScreenerTools`. No new plumbing
needed — `buildWorkbenchDeps`/`buildScreenerDeps` already exist and are
exercised by that file's own tests. The watchlist/alerts/backtest/export
group needs new wiring: either fold it into `workbenchCompositionRoot.ts` or
call `registerAllFollowupTools()` from the route directly.
