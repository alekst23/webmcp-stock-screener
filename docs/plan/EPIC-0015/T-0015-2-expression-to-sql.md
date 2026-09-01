# T-0015-2: Compile validated expressions to SQL, with each study evaluated once

**Epic**: EPIC-0015 (DuckDB Query Engine)
**Status**: Open
**Depends on**: —
**Blocks**: T-0015-3, T-0015-4
**Issue**: #15
**Design**: docs/design/duckdb-query-engine/

## Description

Turn a validated study or step expression into SQL over the panel instead of
into a stack of pandas Series. This is where three of the epic's four
measured causes are removed at once: a study referenced twice compiles to one
named subquery evaluated once rather than being re-parsed and re-evaluated per
reference (`expression.py:197`); an `and`/`or` becomes one boolean predicate
the planner folds rather than N fully-materialized operand Series
(`expression.py:210`); and rolling functions become window functions rather
than a per-group `transform` that builds and concatenates a result per ticker.

`ema` is deliberately excluded and handled in T-0015-3 — it is a linear
recurrence, not a window aggregate, and pretending otherwise would produce
silently wrong numbers.

The existing `ast` whitelist is not replaced. It stays exactly where it is,
and it stays the safety boundary: SQL is generated only from nodes that
already passed it, and only through a fixed mapping from whitelisted node
types to SQL fragments. No user-supplied text is ever concatenated into a
statement.

## User Story

As a researcher composing studies out of other studies,
I want a study referenced many times to cost the same as one referenced once,
so that expressing a pattern more clearly does not make it more expensive.

## Acceptance Criteria

1. Every catalog function except `ema` — `sma`, `atr`, `highest`, `lowest`,
   `days_since` — compiles to SQL whose values match the pandas evaluator's
   for the same panel and window, including at the boundaries where history
   is insufficient and the pandas result is not-a-number.
2. `highest` and `lowest` exclude the current bar; `sma` and `atr` include
   it. Each is demonstrated by a case that fails if the boundary is off by
   one bar in either direction.
3. Rolling and lookback functions never see values from an adjacent ticker,
   demonstrated at the first and last bar of a ticker's history in a panel
   with more than one ticker.
4. A study referenced N times in one expression, and a study defined in terms
   of another study, are each evaluated once per query rather than once per
   reference. Demonstrated by an observable count, not by reading the SQL.
5. Every expression the `ast` whitelist rejects today is still rejected,
   with the same domain error carrying the same function catalog, and no
   rejected expression ever reaches SQL generation.
6. An expression containing text that would alter a statement if
   interpolated — quotes, comment markers, statement separators, an
   identifier naming a real table — is rejected by the existing validation
   rather than reaching the database. Demonstrated by cases, and by the fact
   that no generated statement is assembled from unvalidated input.
7. A study defined in terms of itself is still rejected as a cycle, before
   any SQL is generated.
8. Comparison chains and unary `not` produce the same boolean results as the
   pandas evaluator, including the treatment of not-a-number as
   not-satisfied.

## Design References

- `backend/infra/expression.py` — the source of truth for semantics. Its
  module docstring states the `highest`/`lowest` strictly-before-today
  convention (AC2), and states that the `ast` whitelist is *"a safety
  boundary, not a language limitation"* (AC5, AC6). `_resolve_name`
  (line 197) is cause 1; `_eval_boolop` (line 210) is cause 3.
- `backend/domain/errors.py` — `ExpressionError` and its function-catalog
  payload, which AC5 requires unchanged so an agent can still self-correct
  in one turn.
- `docs/design/duckdb-query-engine/technical.md`.

## Technical Considerations

- `days_since` is the least obviously window-shaped of the five. Its pandas
  implementation forward-fills the position of the last true row per ticker
  and subtracts; the natural SQL analogue is a running maximum of a
  conditionally-set row position over rows preceding and including the
  current one. The "never true yet" case must stay distinguishable from
  "true today" — one is not-a-number, the other is zero.
- `atr` composes a true-range expression from three columns and a
  previous-close lag before averaging. The previous close is per-ticker.
- Window sizes are integer literals enforced at parse time. That is what
  makes them safe to place directly in a window frame specification, where
  most databases will not accept a bound parameter. Rely on the existing
  literal check rather than adding a second one, and say so.
- Study memoization has a subtlety the pandas engine does not have: two
  studies may share a subexpression. Evaluating each *study* once satisfies
  AC4; common-subexpression elimination below that is the planner's job and
  is not this ticket's problem.

## Out of Scope

`ema` (T-0015-3). Multi-step temporal matching (T-0015-4). Any change to the
expression language itself — same catalog, same syntax, same errors.
