# T-1009-9: `run_screener` with pinned run store

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
**Depends on**: T-1009-7
**Blocks**: T-1009-10

## Description

Execute one specific screener revision and pin the result. The pinning is
the point: the returned `run_id` names a stored, ordered, complete result
set with a fixed data timestamp, so EPIC-1010 can page through it later
without silently re-running the screen and quietly changing the numbers
underneath a conversation the human is still having.

## User Story

As an AI agent that just ran a screen,
I want a stable handle to exactly the results I ran, with the data
timestamp attached,
so that when the human asks about result 40 twenty minutes later, they
see the row I saw, not a different one from a fresh query.

## Acceptance Criteria

1. Running a valid screener creates a run with a stable `run_id` and
   returns the screener ID, the screener revision executed, the universe
   count, the matched count, the returned count, warnings, and the data
   timestamp.
2. The run records the exact screener revision executed; editing the
   screener afterwards does not change what that run reports or contains.
3. A caller may name an explicit screener revision to run; if that
   revision is no longer retained the call is rejected rather than
   silently running a different one.
4. The complete ordered match list, with per-match ranking values and
   per-node evaluated values and pass/fail states, is stored under the
   `run_id` and can be read back without re-executing the screener.
5. A read of a run that no longer exists fails explicitly as "run no
   longer available"; it never falls back to re-running the screener.
6. Every run reports full provenance: `as_of`, source, live/delayed
   status, timezone, currency, price adjustment, the fundamentals
   reporting period for any fundamental field used, and the
   calculation-engine version.
7. A screener with blocking validation problems is refused: the problems
   are returned, no `run_id` is minted, and nothing is stored.
8. A valid screener that nothing satisfies produces a run with a matched
   count of zero and a warning — a normal result, not an error.
9. When matches exceed the result limit, the run reports the total matched
   count, the returned count, and that the result was truncated.
10. The tool accepts `expected_revision` and `idempotency_key`; a replayed
    key returns the original `run_id` without executing a second time.
11. Run retention is explicit and documented — how many runs are kept and
    for how long — and eviction is observable through AC5's error rather
    than through changed numbers.
12. Tests cover a successful run, pinning across a subsequent screener
    edit, explicit-revision runs, read-back without re-execution, the
    evicted-run error, refusal on blocking problems, zero matches,
    truncation, and idempotent replay.

## Design References

- `docs/design/screener-core/spec.md` — the "Run a screener" scenario
  table, and Open Question 1 on run retention.
- `docs/design/screener-core/technical.md` — the `ScreenerRun` contract
  and what a run stores for EPIC-1010; this ticket is the producing half
  of that contract.
- `backend/api/routes/research.py` — existing route and error-mapping
  conventions.

## Technical Considerations

- The run store is the contract boundary with EPIC-1010. Whatever its
  storage mechanism, the read path must be able to answer "this run is
  gone" distinctly from "this run has no matches".
- Coordinate the retention decision with EPIC-1010 rather than assuming
  it; the spec's Open Question 1 records the current assumption.
- The idempotency guarantee here matters more than elsewhere: a replayed
  run key must not execute a second query.

## Out of Scope

Paging, selecting, formatting, or explaining results (EPIC-1010), and
exporting or backtesting a run.
