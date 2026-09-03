# T-0020-5: Negative test — other tool-group flags stay unregistered

**Epic:** EPIC-0020
**Status:** Open

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
