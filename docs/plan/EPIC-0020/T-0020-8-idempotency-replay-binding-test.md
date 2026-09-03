# T-0020-8: Test idempotency-replay interaction with panel-binding

**Epic:** EPIC-0020
**Status:** Done

## Solution Approach

Added `test_runScreener_replayedIdempotencyKey_doesNotRebindPanel` to the
same auto-bind describe block as T-0020-4. Calls `run_screener` twice with
an identical `idempotency_key` and a `panelBinding` supplied, and proves
"bound exactly once" three ways:

- `second.run_id` equals `first.run_id` (the replay never mints a new run).
- `fake.callCount()` stays `1` (the evaluation port never re-executes).
- The workspace's own `revision` counter (read straight off
  `deps.repository.get(workspaceId)`) is identical after the first call and
  after the replay. This is the load-bearing assertion for "not
  double-processed": `bindPanelSource` commits through `RevisionService` on
  every call, so a second bind would advance the revision a second time
  even if the bound value ends up looking identical to the first bind —
  a value-only comparison could not distinguish "bound once" from "bound
  twice with the same value."
- The panel's `source` still resolves to the original run after the
  replay.

Mutation-checked twice:
1. Made the idempotency short-circuit fall through instead of returning
   early — confirmed the test fails on the `run_id` assertion (a second
   run actually executes).
2. Restored that, then added a redundant re-bind call inside the
   cache-hit branch (same `run_id`, so the response is still correct) —
   confirmed the test still fails, on the revision-equality assertion
   specifically, proving that assertion is the one actually catching a
   "double-bind, same value" regression the other two assertions would
   miss.
Both mutations were reverted after confirming failure.

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
