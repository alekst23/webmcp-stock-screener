# T-0015-7: Differential equivalence against the pandas engine

**Epic**: EPIC-0015 (DuckDB Query Engine)
**Status**: Open
**Depends on**: T-0015-6
**Blocks**: T-0015-9
**Issue**: #15
**Design**: docs/design/duckdb-query-engine/

## Description

This epic replaces a working, well-tested component. The only thing that
makes that defensible is evidence — not that the new engine passes its own
tests, but that it agrees with the old one across a corpus wide enough that
disagreement would show up. Per-ticket tests check what their author thought
to check; a differential harness checks what nobody thought of.

Both engines run over the same panel, are given the same corpus of studies
and setups, and their outputs are compared field by field. The corpus is the
deliverable as much as the harness is: a thin corpus produces a green tick
that means nothing.

A finding here is not automatically a defect in the new engine. Some
disagreements will be floating-point boundary cases where a comparison flips
because two arithmetically-equivalent expressions rounded differently. Those
must be **reported and explained individually**, never absorbed by widening
a tolerance until the suite goes green — a tolerance wide enough to hide a
rounding flip is wide enough to hide a wrong window.

## User Story

As the person deciding whether to trust the new engine,
I want proof that it answers the same questions the same way as the engine it
replaces,
so that "we ported it" is a demonstration rather than an assertion.

## Acceptance Criteria

1. A corpus of setups exists covering, at minimum: every catalog function
   including `ema`; studies composed of other studies; single-step and
   three-or-more-step setups; `sustained` and non-`sustained` steps; setups
   that produce zero instances; setups that produce partial instances at the
   panel's trailing edge; setups that produce more than the
   partial-fallback threshold of complete instances and setups that produce
   fewer; and universe narrowing by sector and by market capitalisation.
2. For every corpus entry, both engines are run over the same panel and
   their instance sets are compared on ticker, date, completeness, ordering,
   complete count, partial count, and date bounds. Any difference fails.
3. Instance identifiers are excluded from comparison, with the reason
   recorded — they are per-engine sequence numbers and carry no meaning
   across engines.
4. Measurement, split, and window outputs are compared for the same corpus,
   with any numeric tolerance stated per field and justified by the
   arithmetic rather than chosen to make a case pass.
5. The harness runs against the mock panel with no object-store credentials
   present, so it is part of the ordinary test run rather than a manual
   ritual.
6. Every disagreement found during development is recorded with its cause
   and its resolution, including any that were judged acceptable. A
   disagreement resolved by changing the tolerance is recorded as such.
7. The harness is shown to catch a real defect: at least one deliberate
   perturbation of the SQL engine — an off-by-one window bound, a dropped
   per-ticker partition, an inverted comparison — is demonstrated to make it
   fail. A harness never shown to fail is not yet evidence.
8. Adding a corpus entry requires only describing the setup, not editing the
   comparison logic.

## Design References

- `backend/tests/` — the existing tier structure and the known-pattern
  fixtures the corpus should extend rather than duplicate.
- `backend/scripts/known_pattern_instances.py` — patterns with independently
  known expected instances; these belong in the corpus as the cases where
  both engines can additionally be checked against an external truth rather
  than only against each other.
- `backend/infra/pandas_engine.py` — the reference implementation under
  comparison.
- `docs/design/duckdb-query-engine/technical.md`.

## Technical Considerations

- Two engines agreeing does not make either correct. The corpus entries
  drawn from the known-pattern fixtures are the only ones anchored to
  something outside the pair; keep them distinguishable from the rest.
- The pandas engine constructs from price bars and the DuckDB engine from
  storage. The harness needs one panel expressible both ways, which is a
  constraint on the fixture, not on either engine.
- If T-0013-4 (per-ticker chunked evaluation) is taken first, it becomes a
  third implementation over the same corpus — the harness should not assume
  exactly two engines. See the epic's "Relationship to T-0013-4".

## Out of Scope

Performance comparison (T-0015-8). Deciding which engine ships (T-0015-9).
