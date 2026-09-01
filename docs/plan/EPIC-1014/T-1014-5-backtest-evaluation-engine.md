# T-1014-5: Backtest evaluation engine

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Open
**Depends on**: — (consumes EPIC-1008's market-data ports and EPIC-1009's
screener definition)
**Blocks**: T-1014-6
**Issue**: —

## Description

Build the engine that evaluates a screener definition against history:
how often it matched over time, what happened to the matches over a set
of forward horizons, how deep the drawdowns went, and — stated in plain
terms rather than buried — what survivorship assumption the numbers rest
on.

This is the substantive half of backtesting and it lives in the Python
backend alongside the existing forward-return and base-rate machinery.
T-1014-6 puts the two tools on top of it. Splitting them keeps the
statistics testable against fixtures without a browser in the loop, which
is the only way the survivorship and lookahead guarantees get properly
covered.

## User Story

As a researcher about to trust a screen,
I want to know how often it fired historically, what happened next, and
which assumptions the answer depends on,
so that I can tell a real edge from a screen that only looks good because
the losers were quietly excluded.

## Acceptance Criteria

1. Given a screener definition, a universe, a historical date range, and
   one or more forward-return horizons, the engine produces: match
   frequency over time, a forward-return distribution per horizon, and
   drawdown statistics for the matched instruments.
2. Every result states its survivorship assumption in plain terms —
   whether delisted, merged, and renamed instruments were included, and
   what effect that has on the reported numbers.
3. Every result states the universe, the date range actually covered, the
   horizons evaluated, and the calculation-engine version, alongside the
   market-data provenance (`as_of`, source, live/delayed status,
   timezone, currency, price adjustment policy, and fundamentals
   reporting period where fundamentals were used).
4. A screener condition that references data not knowable at the
   historical decision date is either rejected or evaluated on an
   explicit lag, and the result warns that a lookahead risk was found and
   states how it was handled.
5. Point-in-time correctness is enforced for fundamentals: a condition on
   reported figures uses the figures as they were known at the decision
   date, not as later restated, or the result warns that it could not.
6. When the requested range or universe has too little history to support
   the requested horizons, the evaluation is rejected or truncated, with
   a warning naming the coverage actually available.
7. A screener that matched nothing over the range produces a zero-match
   result stating the range and universe, not an error.
8. Rebalance or evaluation frequency is explicit in the result — the
   reader can tell on what schedule the screen was evaluated.
9. The engine reads market data exclusively through the data ports; it
   contains no provider-specific access and no data pipeline of its own.
10. The engine is deterministic: the same definition, range, and fixture
    data produce identical results across runs.
11. The engine follows the project's layered architecture — the
    evaluation logic carries no infrastructure imports — and lives in new
    files that change no existing module's behavior.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Backtest a screener"
  and "Read backtest results" scenario tables.
- `docs/reference/tool-spec.md` — `backtest_screener` /
  `get_backtest_results` ("historical frequency, forward returns,
  drawdowns, and survivorship assumptions"); the market-data provenance
  requirement every result must carry.
- `docs/plan/EPIC-1009/_epic.md` — the screener definition, universe, and
  filter tree being evaluated.
- `docs/plan/EPIC-1008/_epic.md` — the domain ports for reference,
  fundamental, and price history data.
- `backend/domain/`, `backend/domain/contracts/engine.py`,
  `backend/infra/pandas_engine.py` — the existing layered engine and its
  forward-return, hit-rate, and base-rate statistics; the pattern to
  follow and the closest prior art in the repo.
- `backend/tests/unit/test_query_engine_stats.py` — the existing
  statistics test style and fixture approach.

## Technical Considerations

- Survivorship is the finding, not a footnote. If the available data has
  no delisted instruments, the correct behavior is to say so loudly in
  every result, not to omit the field.
- Lookahead bias hides in fundamentals (restatements) and in any
  condition referencing a future-dated event. Both need explicit handling
  and explicit reporting.
- Real history depends on the parallel market-data workstream. Build and
  test against fixtures through the ports; do not build a mock pipeline.
- Backtests over long ranges and wide universes are expensive. Bound the
  work and report the bound rather than running unbounded.
- The calculation-engine version has to change when the statistics
  change, or provenance is decorative.

## Out of Scope

- The `backtest_screener` and `get_backtest_results` tools, job
  lifecycle, and result storage (T-1014-6).
- Portfolio simulation: position sizing, capital allocation, transaction
  costs, slippage, and P&L. This engine evaluates the screen's historical
  behavior, not a trading strategy.
- Any visualization of backtest results.
- Building the live market-data pipeline.
