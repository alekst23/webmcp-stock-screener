# EPIC-0025: Server-Side Screener Evaluation Endpoint

**Depends on**: —
**Blocks**: EPIC-0026 (its `HttpScreenerEvaluationPort` targets this epic's endpoint contract; independently testable via a fake port in the meantime)
**Design**: docs/design/screener-core/
**Issue**: #25

## Description

Every real screener evaluation refuses today with `empty_universe` — no
market-data adapter exists in the browser, and none should: shipping a
whole universe's bars to the browser to evaluate there is the expensive
path a purely client-side design implies. The backend already has a
filter-tree evaluator (`backend/domain/filter_evaluation.py`, no caller)
and the historical price panel the chart endpoint already reads. This
epic adds the one thing missing between them: a stateless endpoint that
narrows a universe, resolves fields (including a new "percent change over
N sessions" field, which nothing today expresses), evaluates, ranks, and
returns a bounded result set.

Nothing here changes the frontend. EPIC-0026 is what points the browser
at this endpoint.

## User Story

As the screener feature,
I want a backend endpoint that evaluates a screener definition against
real universe and price data,
so that `run_screener` (EPIC-1009, already built) returns real matches
instead of refusing every time.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-0025-1 | Universe and field resolution for server-side evaluation | — | Not started |
| 2 | T-0025-2 | `POST /screener/run` endpoint | T-0025-1 | Not started |

## Notes

- Stateless by design for MVP: no server-side run storage. The browser
  mints `run_id` and owns the pin (`PinnedRunStore`), exactly as it does
  today; a run does not survive a page refresh. Revisit only if that
  becomes a real complaint.
- `dry_run: true` on the same endpoint serves validation — one code path
  for both `ScreenerEvaluationPort.validate` and `.execute`, so the rules
  a screener is checked against can never drift from the rules it's
  actually run against.
