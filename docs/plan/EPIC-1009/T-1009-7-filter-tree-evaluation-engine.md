# T-1009-7: Filter-tree evaluation engine

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
**Depends on**: T-1009-2, T-1009-6

## Description

The engine that turns a screener definition into an ordered list of
matches: resolve the universe, evaluate every enabled condition against
market data, combine the results through the nested boolean tree, and
rank what survives. It also retains the per-condition evaluated value and
pass/fail state for every match, which is what later makes EPIC-1010's
per-filter explanation a lookup instead of a second evaluation.

## User Story

As a developer implementing `run_screener` and `validate_screener`,
I want one engine that evaluates a screener definition against market
data and returns ranked matches with their working shown,
so that both tools share the same semantics and a result can be explained
without re-deriving it.

## Acceptance Criteria

1. Resolving a universe applies inclusion criteria first, then liquidity
   limits, then exclusions, and reports the resulting instrument count.
2. Each of the eight condition types is evaluated against market data
   according to its typed operands, using the intervals, adjustments, and
   catalog items the condition names.
3. Boolean combination follows the tree: `AND` requires all children,
   `OR` requires any, and `NOT` inverts its single child, to arbitrary
   depth.
4. Disabled nodes are skipped entirely and never affect a match decision.
5. A ranking with a single field orders matches by that field and
   direction; a weighted ranking normalizes each field within the matched
   set before combining by weight; the declared tie-break resolves equal
   scores.
6. With no ranking set, matches come back in a documented, deterministic
   default order, and the engine reports that no ranking was applied.
7. Repeating the same evaluation of the same screener revision over the
   same data produces the same matches in the same order.
8. The result limit truncates the returned matches while the total matched
   count is still reported.
9. For every returned match the engine retains the instrument ID, its rank
   and composite score, each ranking field's value, and the evaluated
   value and pass/fail state of every enabled filter node keyed by node
   ID.
10. Every evaluation carries complete provenance — `as_of`, source,
    live/delayed status, timezone, currency, price adjustment, the
    fundamentals reporting period for any fundamental field used, and the
    calculation-engine version.
11. A field or calendar unavailable for part of the universe produces a
    reported warning rather than a silent pass or a silent drop.
12. The engine is an infra adapter behind the domain port; domain code
    does not import it. Tests exercise each condition type, nesting,
    disabled nodes, all three ranking modes, determinism, truncation, and
    the retained per-node values.

## Design References

- `docs/design/screener-core/technical.md` — what a run stores for
  EPIC-1010, and the domain-port/infra-adapter boundary.
- `docs/design/screener-core/spec.md` — "Set ranking" and "Run a
  screener" scenarios, and Open Question 3 on normalization.
- `backend/infra/pandas_engine.py` — the existing pandas adapter style
  (not to be modified).
- `backend/domain/contracts/engine.py` — the Protocol the adapter
  satisfies, in this epic's case T-1009-2's port.

## Technical Considerations

- Market data, reference data, fundamentals, and event calendars come
  through EPIC-1008's ports. Do not build a data pipeline or a mock
  dataset for them here.
- Keep evaluation of a single condition type in its own small unit;
  a per-type dispatch keeps each function within the size limits and makes
  the eight types individually testable.
- Retaining per-node values for every match is a memory cost — bound it by
  the result limit rather than retaining the whole universe.

## Out of Scope

The tools themselves (T-1009-8, T-1009-9), the run store and its
lifetime (T-1009-9), and result paging (EPIC-1010).
