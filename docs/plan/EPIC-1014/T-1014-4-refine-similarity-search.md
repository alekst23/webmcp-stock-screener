# T-1014-4: Similarity refinement from accepted and rejected matches

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Open
**Depends on**: — (consumes EPIC-1012's similarity feature model)
**Blocks**: T-1014-11
**Issue**: —

## Description

Deliver `refine_similarity_search`: take the matches a researcher marked
as good and bad, adjust the similarity feature weights to favor the good
ones, and re-search.

The value is in the loop — a similarity search rarely gets it right on
the first pass, and the researcher's yes/no judgments are the cheapest
signal available. The constraint is explainability: every weight change
must be reportable with its feature name and a before/after value, so the
researcher can see whether the refinement learned something real or
overfit to three examples.

## User Story

As a researcher who has looked at a page of similar setups and knows
which four are right,
I want to hand those judgments back and get a better search,
so that finding what I mean is a short conversation rather than me
hand-tuning weights I do not have intuitions about.

## Acceptance Criteria

1. `refine_similarity_search` accepts a similarity search ID together
   with the accepted and rejected match IDs, adjusts the feature weights
   to favor the accepted matches' features over the rejected ones, and
   runs a new search with the adjusted weights.
2. The response reports every weight that changed, naming its feature and
   giving its value before and after, so the refinement is auditable.
3. The refined search results are returned with a stable search ID
   distinct from the original, and the original search's results remain
   readable.
4. A refinement request carrying neither accepted nor rejected matches is
   rejected explaining that feedback is required. No weights change and
   no search runs.
5. A refinement request carrying only rejections still refines — weights
   move away from the rejected matches' distinguishing features — and the
   response warns that the refinement is one-sided.
6. A refinement request marking the same match both accepted and rejected
   is rejected naming the conflicting match; nothing changes.
7. A refinement request referencing a match ID that does not belong to
   the named search is rejected naming the offending ID.
8. Weights stay inside the feature model's declared valid bounds after
   adjustment; a refinement that would push a weight out of bounds clamps
   it and warns.
9. The tool accepts `expected_revision` and `idempotency_key` and returns
   the common mutation envelope. A repeated `idempotency_key` returns the
   original result without refining twice.
10. Undoing a refinement with the returned undo token restores the
    previous weights exactly.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Refine a similarity
  search" scenario table.
- `.dev/design/tool-spec.md` — `refine_similarity_search` ("adjust
  feature weights from accepted and rejected matches"); the feature
  dimensions `explain_similarity` reports (price shape, volume,
  volatility, relative strength, studies, pattern structure), which are
  the weights being adjusted.
- `docs/plan/EPIC-1012/_epic.md` — the similarity feature model, weight
  representation and bounds, `find_similar_setups`, and
  `explain_similarity`'s per-feature contribution reporting.
- `docs/plan/EPIC-1006/_epic.md` — mutation envelope, revisions, undo.

## Technical Considerations

- The refinement rule is an implementation choice; the requirement is
  that it be explainable. Prefer a transparent adjustment whose effect on
  each weight can be stated plainly over an opaque optimizer that fits
  better on paper.
- Small feedback sets overfit easily. Consider bounding how far a single
  refinement can move any weight, and warn when the feedback set is small
  relative to the number of features.
- Weight state belongs to EPIC-1012's feature model. Adjust through its
  contract rather than keeping a private copy that can drift.
- The undo path must restore the weights, not merely the search results —
  a refinement's lasting effect is on the weights.

## Out of Scope

- The similarity search itself, the feature model, and
  `explain_similarity` (EPIC-1012).
- The UI for marking matches accepted or rejected — this ticket consumes
  the marks, wherever they come from.
- Persisting refined weights as a named, reusable profile across
  workspaces.
- Learning across sessions or across users.
