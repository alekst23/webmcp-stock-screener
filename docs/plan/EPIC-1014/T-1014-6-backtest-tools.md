# T-1014-6: Backtest tools

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Open
**Depends on**: T-1014-5
**Blocks**: T-1014-11
**Issue**: —

## Description

Deliver `backtest_screener` and `get_backtest_results` — the agent-facing
half of backtesting. `backtest_screener` starts an evaluation against a
specific screener revision and returns a stable backtest ID immediately;
`get_backtest_results` reads that backtest's stored results without ever
re-executing it.

The split mirrors `run_screener` / `get_screener_results`: results are
pinned to the revision that produced them, so editing the screener
afterward cannot silently change what a backtest said.

## User Story

As a researcher validating a screen with my agent,
I want to kick off a backtest and read its results by ID afterward,
so that the numbers I am reasoning about stay attached to the exact
screener revision that produced them, however much I edit in between.

## Acceptance Criteria

1. `backtest_screener` accepts a screener revision, a historical date
   range, and forward-return horizons, and returns a stable backtest ID
   immediately without blocking on the evaluation.
2. `get_backtest_results` accepts a backtest ID and returns the stored
   results: match frequency over time, forward-return distributions per
   horizon, and drawdown statistics.
3. Results state the screener revision they were computed against, the
   universe, the date range covered, the horizons, the survivorship
   assumption, the calculation-engine version, and the market-data
   provenance envelope.
4. Editing the screener after a backtest starts does not change that
   backtest's results or the revision they report.
5. Reading a completed backtest repeatedly returns the same stored
   results; the evaluation is never re-executed implicitly.
6. Reading a backtest that has not finished returns an in-progress status
   with progress information — never partial results presented as final.
7. Reading a backtest that failed returns a failed status with the
   reason.
8. Reading an unknown or expired backtest ID is rejected saying so; no
   evaluation is started to cover for the missing result.
9. Results for a large match set are paginated and bounded, with each
   page addressed by stable IDs, and the response states the total.
10. Warnings the engine produced — lookahead handling, truncated
    coverage, insufficient history, zero matches — are surfaced to the
    caller rather than dropped.
11. `backtest_screener` accepts `expected_revision` and
    `idempotency_key` and returns the common mutation envelope; a
    repeated `idempotency_key` returns the original backtest ID rather
    than starting a second evaluation.
12. `get_backtest_results` is read-only and mutates no workspace state.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Backtest a screener"
  and "Read backtest results" scenario tables.
- `docs/reference/tool-spec.md` — `backtest_screener` and
  `get_backtest_results`; the common mutation contract; the market-data
  provenance requirement.
- `docs/plan/EPIC-1014/T-1014-5-backtest-evaluation-engine.md` — the
  engine these tools drive and the results they surface.
- `docs/plan/EPIC-1010/_epic.md` — the pinned-run and no-silent-rerun
  pattern this ticket mirrors, and its bounded-read/pagination
  conventions.
- `docs/plan/EPIC-1006/_epic.md` — mutation envelope, revisions,
  idempotency.

## Technical Considerations

- The asynchronous shape is a working assumption recorded in the epic's
  Open Questions, chosen to mirror `run_screener`. If backtests turn out
  fast enough to return inline, the ID-and-read contract should still
  hold — the pinning is the requirement, not the latency.
- An idempotency key must map to the same backtest ID, not merely to the
  same envelope, or a retry will start a second expensive evaluation.
- Results need a stated retention/expiry story so an expired ID fails
  honestly instead of silently re-running.
- Backtests are expensive. Consider rejecting or warning on a request
  whose estimated cost exceeds the configured bound, consistent with
  `validate_screener`'s expensive-query detection.

## Out of Scope

- The evaluation statistics themselves (T-1014-5).
- Visualizing backtest results in a panel.
- Comparing two backtests against each other.
- Scheduled or automatically re-running backtests.
