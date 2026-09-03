# T-0020-5: Negative test — other tool-group flags stay unregistered

**Epic:** EPIC-0020
**Status:** Done

## Solution Approach

Added a new `it()` to `workbenchCompositionRoot.test.ts`'s
`registerWorkbenchComposition` describe block:
`'never registers a chart/similarity/backtest/alert/watchlist/followup tool
name (AC2)'`. It imports each out-of-scope tool's own exported
`*_TOOL_NAME` constant (`ADD_CHART_ANNOTATION_TOOL_NAME`,
`CAPTURE_CHART_SETUP_TOOL_NAME`, `GET_CHART_DATA_TOOL_NAME`,
`FIND_SIMILAR_SETUPS_TOOL_NAME`, `EXPLAIN_SIMILARITY_TOOL_NAME`,
`COMPARE_SETUPS_TOOL_NAME`, `BACKTEST_SCREENER_TOOL_NAME`,
`GET_BACKTEST_RESULTS_TOOL_NAME`, `PREVIEW_ALERT_TOOL_NAME`,
`CREATE_ALERT_DRAFT_TOOL_NAME`, `EDIT_ALERT_DRAFT_TOOL_NAME`,
`ENABLE_ALERT_TOOL_NAME`, `DISABLE_ALERT_TOOL_NAME`,
`UPSERT_WATCHLIST_TOOL_NAME`, `SAVE_RESULTS_TO_WATCHLIST_TOOL_NAME`,
`CREATE_CUSTOM_STUDY_TOOL_NAME`, `CREATE_COMPUTED_FIELD_TOOL_NAME`) rather
than hand-typing the literal strings, so a future rename of one of these
tools can't silently make the negative test pass for the wrong reason.
Each name is asserted absent from the tool names `registerWorkbenchComposition()`
actually registered.

## Goal

`workbenchCompositionRoot.test.ts` asserts the expected tool names (panel,
workbench-core, screener) are present after `registerWorkbenchComposition()`
runs, but never asserts that chart/similarity/backtest/alert/watchlist/
followup tool names are absent. Today this is true by inspection (their
flags are all still `false`), but a future accidental flip of one of those
flags without updating this composition root would go uncaught. Found by
EPIC-0020's epic review (2026-09-02).

## Acceptance criteria

- A test asserts that after `registerWorkbenchComposition()`, no
  chart/similarity/backtest/alert/watchlist/followup tool name appears in
  the registered tool set.
