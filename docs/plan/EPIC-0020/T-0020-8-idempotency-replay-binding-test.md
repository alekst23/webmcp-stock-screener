# T-0020-8: Test idempotency-replay interaction with panel-binding

**Epic:** EPIC-0020
**Status:** Open

## Goal

No test proves that a replayed `run_screener` call (same `idempotency_key`)
does not re-run the panel-binding side effect. By code inspection this is
currently safe — `replayCache.lookup()` returns before a `runId` is even
minted, so a replay can't reach `bindRunToResultsPanel` at all — but
nothing in the suite proves it, and a future refactor reordering the
replay check relative to the binding call could silently introduce a
double-bind or stale-rebind regression with zero test signal. Found by
EPIC-0020's epic review (2026-09-02).

## Acceptance criteria

- A test calls `run_screener` twice with the same `idempotency_key` and a
  `panelBinding` supplied, and asserts the panel is bound exactly once (not
  re-bound, not double-processed) on replay.
