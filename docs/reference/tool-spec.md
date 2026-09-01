## Recommended core tools

| Area        | Tool                        | Purpose                                                                                                                                       |
| ----------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Context     | `get_app_context`           | Return active workspace, selected screener, focused panel, permissions, data delay, timezone, and current revision.                           |
| Context     | `get_workspace`             | Return panels, layout, links, active symbol, screener configuration, and unsaved changes.                                                     |
| Discovery   | `search_instruments`        | Resolve ticker/company text to canonical instrument IDs, exchanges, and asset types.                                                          |
| Discovery   | `search_catalog`            | Search available fields, studies, indicators, patterns, intervals, operators, universes, and templates.                                       |
| Discovery   | `describe_catalog_item`     | Return parameters, units, valid ranges, defaults, outputs, and data availability for a catalog item.                                          |
| Workspace   | `create_workspace`          | Create a blank workspace or one based on a template.                                                                                          |
| Workspace   | `add_panel`                 | Add a `filter_builder`, `chart`, `study_library`, `results_table`, `similar_opportunities`, `watchlist`, `alerts`, or `symbol_details` panel. |
| Workspace   | `update_panel`              | Change panel title, configuration, visibility, collapsed state, or bound resource.                                                            |
| Workspace   | `set_panel_layout`          | Position and size panels using logical grid coordinates rather than pixels.                                                                   |
| Workspace   | `link_panels`               | Synchronize symbol, timeframe, result selection, crosshair, or filters between panels.                                                        |
| Workspace   | `remove_panel`              | Remove one panel using its stable ID.                                                                                                         |
| Chart       | `configure_chart`           | Set symbol, timeframe, range, candle type, scale, session, comparisons, and price-adjustment policy.                                          |
| Chart       | `edit_chart_studies`        | Add, update, reorder, toggle, or remove studies such as MA, RSI, MACD, Bollinger Bands, VWAP, or ATR.                                         |
| Chart       | `get_chart_data`            | Read a bounded range of visible OHLCV values and study outputs for agent analysis.                                                            |
| Chart       | `add_chart_annotation`      | Add a trendline, price level, date range, label, or highlighted setup window.                                                                 |
| Chart       | `capture_chart_setup`       | Save the selected symbol, historical window, studies, and normalization settings as a reference setup.                                        |
| Screener    | `create_screener`           | Create and bind a screener to the workspace.                                                                                                  |
| Screener    | `set_screener_universe`     | Set asset class, exchanges, countries, sectors, industries, indexes, watchlists, liquidity limits, and exclusions.                            |
| Screener    | `edit_filter_tree`          | Add, update, remove, group, enable, or reorder typed conditions with nested `AND`, `OR`, and `NOT`.                                           |
| Screener    | `set_screener_ranking`      | Define ranking fields, weights, direction, tie-breaking, and result limits.                                                                   |
| Screener    | `validate_screener`         | Detect invalid parameters, unavailable data, contradictory filters, expensive queries, and empty-universe problems.                           |
| Screener    | `run_screener`              | Execute a specific screener revision and return a pinned `run_id`, counts, warnings, and data timestamp.                                      |
| Results     | `configure_results_table`   | Set columns, computed columns, sort, grouping, conditional formatting, pagination, and linked chart.                                          |
| Results     | `get_screener_results`      | Retrieve a bounded page from an existing `run_id` without silently rerunning it.                                                              |
| Results     | `select_result`             | Select one or more results and propagate them to linked chart and details panels.                                                             |
| Results     | `explain_result`            | Show the actual value and pass/fail state for every filter, plus its ranking contribution.                                                    |
| Similarity  | `find_similar_setups`       | Search for symbols or historical windows resembling a captured setup.                                                                         |
| Similarity  | `explain_similarity`        | Return feature-by-feature contributions: price shape, volume, volatility, relative strength, studies, and pattern structure.                  |
| Similarity  | `compare_setups`            | Display candidates as normalized overlays, synchronized charts, or small multiples.                                                           |
| Safety      | `preview_workspace_changes` | Validate a typed collection of proposed operations and return the exact visual/state diff.                                                    |
| Safety      | `apply_previewed_changes`   | Atomically apply the previously previewed operations.                                                                                         |
| Persistence | `save_workspace`            | Save the current screener, panels, layout, and links as a named revision.                                                                     |
| Persistence | `undo_change`               | Reverse a mutation using its returned undo token.                                                                                             |

`edit_filter_tree` should support several condition types:

* Scalar: price greater than $10.
* Range: RSI between 40 and 70.
* Series comparison: MA50 above MA200.
* Temporal: crossed above within the last five bars.
* Event-relative: earnings within the next 30 days.
* Pattern: bull flag detected with confidence above 0.75.
* Relative: volume greater than 1.5× its 20-day average.
* Study output: MACD histogram positive and rising.

## High-value follow-up tools

* `refine_similarity_search` — adjust feature weights from accepted and rejected matches.
* `derive_filters_from_setup` — convert an example chart into an editable draft filter tree.
* `create_computed_field` — build a validated formula from permitted fields and functions.
* `create_custom_study` — create a reusable study through a typed expression model, never arbitrary JavaScript.
* `backtest_screener` and `get_backtest_results` — evaluate historical frequency, forward returns, drawdowns, and survivorship assumptions.
* `upsert_watchlist` and `save_results_to_watchlist` — create dynamic or static watchlists from results.
* `create_alert_draft`, `preview_alert`, `enable_alert`, and `disable_alert` — keep alert activation behind an explicit native review step.
* `export_results` — export the pinned run, filters, timestamp, and provenance.
* `get_change_history` and `restore_workspace_revision` — support experimentation and recovery.

## Common contract for every tool

Every resource should use stable IDs—never “panel 3” or ticker alone. Mutations should accept `expected_revision` and `idempotency_key`, then return:

```json
{
  "change_id": "chg_123",
  "new_revision": 18,
  "affected_ids": ["panel_chart_1", "screener_4"],
  "diff_summary": "Added RSI study and RSI 40–70 filter",
  "warnings": [],
  "undo_token": "undo_abc"
}
```

Market-data results should always state `as_of`, source, live/delayed status, timezone, currency, adjusted/unadjusted prices, fundamentals reporting period, and calculation-engine version.

I would deliberately exclude generic `set_application_state`, raw SQL/JavaScript execution, DOM automation, `find_best_stock`, or any tool that combines screening with order placement. Trading should remain a separate, explicitly permissioned draft → review → submit workflow.
