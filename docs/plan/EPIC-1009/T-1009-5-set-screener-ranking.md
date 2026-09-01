# T-1009-5: `set_screener_ranking` tool

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
**Depends on**: T-1009-1
**Blocks**: T-1009-8

## Description

A screen that matches 400 instruments is not an answer until they are
ordered. This tool sets how matches are ranked — by one field or a
weighted combination of several — how ties are broken, and how many
results a run returns.

## User Story

As an AI agent presenting a screen to a human,
I want to declare how matches are ordered and how many come back,
so that the top of the list is the part worth their attention and the
ordering is one I can explain.

## Acceptance Criteria

1. Ranking by a single field with a direction is accepted and stored, and
   the stored ranking is echoed back in full.
2. Ranking by several fields with weights is accepted; the weights are
   stored as given and the normalization used to make differing units
   comparable is stated in the stored ranking.
3. A tie-break field and direction can be declared, and are stored as part
   of the ranking.
4. A result limit can be declared and is stored as part of the ranking.
5. A ranking naming a field not present in the catalog registry is
   rejected, naming the unknown field, and the previously stored ranking
   is left unchanged.
6. A ranking with a non-positive result limit, or with weights that cannot
   be normalized (for example all zero), is rejected with an explanation.
7. Clearing the ranking is possible and leaves the screener in the
   documented "no ranking set" state, which a run reports as ranking not
   applied.
8. The tool accepts `expected_revision` and `idempotency_key`, rejects a
   stale revision without mutating, returns the original result on a
   replayed key, advances the screener revision on acceptance, and returns
   the mutation envelope with an undo token.
9. Tests cover single-field ranking, weighted ranking, tie-break and
   limit storage, unknown field rejection, invalid limit and weights,
   clearing, and revision conflict.

## Design References

- `docs/design/screener-core/spec.md` — the "Set ranking" scenario table,
  and Open Question 3 on normalization.
- `docs/design/screener-core/technical.md` — the `RankingSpec` shape.

## Technical Considerations

- This ticket stores and validates the ranking declaration. Actually
  ordering matches by it happens in the evaluation engine (T-1009-7).
- Field existence checks go through EPIC-1008's catalog registry; the
  mutation envelope comes from EPIC-1006.

## Out of Scope

Applying the ranking to results (T-1009-7), validation reporting
(T-1009-8), and registration (T-1009-10).
