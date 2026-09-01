# T-0015-3: Recursive `ema` in SQL

**Epic**: EPIC-0015 (DuckDB Query Engine)
**Status**: Open
**Depends on**: T-0015-2
**Blocks**: T-0015-5
**Issue**: #15
**Design**: docs/design/duckdb-query-engine/

## Description

`ema` is the one catalog function that is not a window aggregate. The pandas
implementation is `ewm(span=n, adjust=False, min_periods=n).mean()`, which is
the linear recurrence

```
y_t = a * x_t + (1 - a) * y_(t-1),    a = 2 / (n + 1)
```

Each output depends on the previous *output*, not on a bounded slice of the
input, so no `ROWS BETWEEN` frame computes it. Getting this wrong is the
epic's most dangerous failure mode, because a subtly wrong `ema` produces
plausible-looking numbers and quietly different instance sets — which is
exactly what T-0015-7's differential harness exists to catch, but only if it
is caught rather than tolerated.

This ticket picks a mechanism, states its cost, and proves the values match.

## User Story

As a researcher whose pattern uses an exponential moving average,
I want the SQL engine's `ema` to be the same number the pandas engine
produces,
so that porting the engine does not silently change what my pattern means.

## Acceptance Criteria

1. `ema(<expr>, n)` produces values matching the pandas evaluator's for the
   same panel, expression, and span, to a stated numeric tolerance, with the
   tolerance justified rather than tuned until tests pass.
2. The `min_periods=n` boundary is reproduced exactly: the first `n-1` bars
   of each ticker's history are not-a-number, and the `n`-th is the first
   real value. Demonstrated by a case that fails if the warm-up is off by
   one bar.
3. No ticker's average is influenced by any other ticker's bars,
   demonstrated at ticker boundaries in a multi-ticker panel.
4. `ema` composes: `ema` of a study, `ema` of an arithmetic expression, and
   an `ema` compared against another series all evaluate correctly.
5. The chosen mechanism's memory and latency cost is measured on a panel at
   the target universe shape and recorded, and peak absolute process RSS
   during that evaluation is reported. If the mechanism costs materially
   more than the other catalog functions, the figure is stated plainly
   rather than averaged away.
6. If the recurrence is evaluated by a mechanism that returns rows to Python
   or holds the panel in the process, that is recorded as a partial defeat
   of the epic's purpose, with the residency cost measured — not presented
   as equivalent.

## Design References

- `backend/infra/expression.py` — `_eval_call`'s `ema` branch is the
  reference semantics, including `adjust=False` and `min_periods=n`.
- `docs/design/duckdb-query-engine/technical.md` — records the candidate
  mechanisms and why the closed-form expansion is not among the safe ones.

## Technical Considerations

Three mechanisms, in the order they should be tried:

1. **Recursive common table expression** over each ticker's bars in date
   order, carrying the running value forward. Pure SQL, no Python in the
   loop, but recursion depth equals a ticker's history length (~2,520 bars
   for ten years) and recursive CTEs are typically materialized per
   iteration — the cost needs measuring, not assuming.
2. **A user-defined aggregate or window function** registered on the
   connection. Keeps the data in the engine but puts Python on the hot path;
   AC6 exists because this option can quietly reintroduce the residency the
   epic is removing.
3. **Precomputing the recurrence at ingest** as a stored column. Fastest at
   query time, but only works for `ema` over a base field with a fixed span
   — it cannot serve `ema` of an arbitrary study, so it is a partial answer
   at best and would need a documented fallback for the general case.

**Not viable: the closed-form expansion.** `y_t` can be written as a
weighted sum of all prior `x_k` with weights `a*(1-a)^(t-k)`, which looks
like it could be a running sum. Computing it that way requires accumulating
`x_k / (1-a)^k`, and `(1-a)^k` underflows to zero within a few hundred bars
for any usable span — the running sum overflows to infinity long before ten
years of history. It is recorded here so it is rejected once, with a reason,
rather than rediscovered.

## Out of Scope

Changing `ema`'s definition, adding an `adjust=True` variant, or adding new
smoothing functions to the catalog.
