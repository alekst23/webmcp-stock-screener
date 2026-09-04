# Tool Surface Status

What's actually registered on `/` today vs. what's built but switched off.
Source of truth: `src/lib/workbench/composition/workbenchCompositionRoot.ts`
(called by `src/routes/+page.svelte`). See
[New WebMCP Surface](new-webmcp-surface.md) for the broader design — that doc
predates the chart-demo trim below and is stale on tool counts.

## Active (17 tools)

**Panel tools (14)** — `registerPanelTools()`, always on:
`create_panel`, `duplicate_panel`, `remove_panel`, `set_panel_layout`,
`apply_layout_template`, `split_panel`, `maximize_panel`, `bind_panel_source`,
`set_panel_renderer`, `configure_chart_grid`, `configure_panel_view`,
`link_panels`, `unlink_panels`, `set_panel_selection`

**Results tools (2)** — same call: `get_screener_results`, `explain_result`

**Chart (1)** — `registerResolveTickerTool()`, always on: `resolve_ticker`

## Commented out in `workbenchCompositionRoot.ts` (23 tools)

Left in place as a straight uncomment (imports + call sites both commented),
per the "Trim the WebMCP tool surface to a chart-only demo set" plan:

| Group | Register call | Tools |
|---|---|---|
| Workbench-core | `registerWorkbenchTools` | `get_app_context`, `get_canvas_state`, `create_workspace`, `save_workspace`, `undo_change`, `get_change_history`, `restore_workspace_revision`, `preview_workspace_changes`, `apply_previewed_changes` |
| Screener | `registerScreenerTools` | `create_screener`, `edit_filter_tree`, `run_screener`, `set_screener_ranking`, `set_screener_universe`, `validate_screener` |
| Chart authoring | `registerChartTools` | `capture_chart_setup`, `add_chart_annotation`, `get_chart_data` |
| Similarity | `registerSimilarityTools` | `find_similar_setups`, `explain_similarity`, `compare_setups` |
| Follow-up authoring | `registerFollowupAuthoringTools` | `create_computed_field`, `create_custom_study` |

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

Uncomment the five import blocks and call sites in
`registerWorkbenchComposition()` (`workbenchCompositionRoot.ts`). No new
plumbing needed — `buildWorkbenchDeps`/`buildScreenerDeps` already exist and
are exercised by that file's own tests. The watchlist/alerts/backtest/export
group needs new wiring: either fold it into `workbenchCompositionRoot.ts` or
call `registerAllFollowupTools()` from the route directly.
