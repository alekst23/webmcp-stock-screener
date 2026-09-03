# T-1015-14: EPIC-1015 review follow-ups

**Epic:** EPIC-1015
**Status:** Open

## Goal

Non-blocking findings from the epic-close review (2026-09-03, 5-agent
review) that don't warrant holding the close, collected into one ticket.

## Acceptance criteria

- `docs/tools.md`'s "Capability changes" section gains an 11th entry for
  "instance sampling by strategy" as a deliberate drop (spec.md's Open
  Question 6 / epic AC15 both name it; it fell through a seam between the
  design spec and the doc that transcribed the parity matrix's list and was
  never added).
- `backend/api/routes/chart.py`'s `GET /bars` gains a server-side max-window
  guard (currently only enforced client-side in `httpChartSeries.ts`'s
  `DEFAULT_MAX_WINDOW_DAYS`) and/or pagination, matching `similarity.py`'s
  `SimilarityRunPage`/`backtest.py`'s `BacktestResultPage` convention for
  bounded responses.
- `backend/infra/panel_market_data.py`'s `PanelPriceSeriesPort.get_bars`
  vectorizes its per-row `bar_at()` loop (`.to_numpy()` column views,
  matching this file's own established convention in `_row_range`/
  `get_series`) instead of Python-level `DataFrame.iloc` per row.
- `src/lib/workbench/similarity/tools/registerSimilarityTools.ts`'s
  `createDefaultSimilarityDeps` (the standalone/test-only path) either
  drops its now-unnecessary separate `createSimilarityPanelRegistry()` or
  gets a comment clarifying it's deliberately isolated for standalone use,
  not a leftover of the fixed composition-root bug.
- `src/lib/workbench/chart/tools/index.ts`'s `registerChartOperations()`
  registers `CHART_BIND_SOURCE_KIND` into the shared `OperationRegistry`
  with no caller (`applyOperations`/`previewOperations` never invoked with
  that kind, no dedicated tool exposes it unlike `add_chart_annotation`) —
  either wire a caller or remove the dead registration per the Dead Code
  Policy.
- For each of T-1015-3, T-1015-9, T-1015-10, T-1015-12: either run the
  previously-deferred browser-check AC and update the ticket's
  Implementation Notes with the real result, or explicitly note that the
  post-cutover hardening pass's live testing (2026-09-03) covered the
  underlying functionality and cite what it actually exercised.
