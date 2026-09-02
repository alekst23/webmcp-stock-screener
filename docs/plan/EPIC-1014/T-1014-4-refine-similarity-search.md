# T-1014-4: Similarity refinement from accepted and rejected matches

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Done
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
- `docs/reference/tool-spec.md` — `refine_similarity_search` ("adjust
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

## Solution Approach

**Precedent read before writing code:** `find_similar_setups`
(`similarity/tools/findSimilarSetups.ts`) treats "pins a run and binds a
panel" as the thing that makes it a mutation. `compare_setups`
(`similarity/comparison/application/compareSetups.ts`) goes further: it
writes a *comparison view* — arguably its "real" payload — onto the
`similar_opportunities` panel bound to the run, specifically by finding
the panel whose `config.runId` matches the run, and reuses
`commitPanelChange`/`findPanel` from `panels/application/support.ts`
rather than inventing a new workspace-doc extension. That is the epic's
established house style for "a similarity-related mutation" and this
ticket follows it rather than introducing a parallel mechanism: the
workspace mutation `refine_similarity_search` makes is **rebinding the
`similar_opportunities` panel bound to the source run onto the newly
refined run** (`config.runId` moves; `comparisonView` resets to `null`,
matching `find_similar_setups`' own rebind-to-explicit-`panel_id` path
exactly). This directly satisfies the Technical Considerations' "the undo
path must restore the weights, not merely the search results": nothing is
mutated in place, so undo moving `config.runId` back to the source run's
id **is** restoring the previous weights exactly (the source run — and
its `weights` — was never touched, so what the panel resolves to after
undo is byte-identical to before the refinement).

**Files (all new, none of EPIC-1012's files touched):**

- `similarity/refinement/domain/refinement.ts` — pure, no I/O:
  - `WeightChange { feature, before, after }`.
  - `SimilarityRefinementError` (reasons: `feedback_required`,
    `conflicting_match`, `unknown_match`), thrown not returned, matching
    `SimilarityWeightError`/`CaptureSetupError`'s convention.
  - `validateFeedback(acceptedIds, rejectedIds, knownCandidateIds)` — AC4
    (neither list), AC6 (overlap), AC7 (id not in the run), throwing
    before any weights are touched or search issued.
  - `refineWeights(currentWeights, acceptedVectors, rejectedVectors)` —
    for each of the six families, `delta = avgAccepted[f] - avgRejected[f]`
    (0 when a side has no value for `f`), `next = clamp(current[f] + STEP
    * delta, 0, ∞)` with `STEP = 0.15` bounding how far one refinement can
    move a weight, clamped only at the declared floor of 0 (`contract.ts`'s
    `makeFeatureWeightSet` declares no ceiling — only "non-negative, not
    all zero"). Appends a clamp warning per clamped family (AC8), a
    one-sided warning when `rejected` is non-empty and `accepted` is empty
    (AC5, matching the design spec's own "Only rejections" row — the
    symmetric accepted-only case is not spec'd to warn, so it does not),
    and a small-feedback-set warning when total judgments < 6 (Technical
    Considerations). Builds the final weight set via `contract.ts`'s own
    `makeFeatureWeightSet` — reused, not reimplemented — so the "adjust
    through the contract, not a private copy" rule holds structurally.
  - This is the piece that makes AC2 ("every weight that changed, before
    and after") auditable: `changes` is a plain list built directly
    alongside the arithmetic that produced each new value, never
    recomputed or inferred afterward.
- `similarity/refinement/application/refineSimilaritySearch.ts` — the use
  case, `PanelUseCaseDeps & { api: SimilarityApiPort }`:
  1. `getRun(sourceRunId)` (read-only).
  2. `validateFeedback` against the run's own candidate ids — throws
     before anything else runs (AC4/6/7's "nothing changes").
  3. `refineWeights` (pure).
  4. Reads the captured setup behind `run.referenceSetupId` (same
     `readCapturedSetup` EPIC-1011/1012 contract `find_similar_setups`
     already reads) to reconstruct the search request's
     instrument/window/normalization, then calls `api.search()` with the
     refined weights — a brand new, distinct `run_id` (AC3), the source
     run untouched and still independently `getRun`-able (AC3's other
     half).
  5. `commitPanelChange`: finds the `similar_opportunities` panel bound to
     the source run (explicit `panel_id`, or discovered via
     `config.runId === sourceRunId`, mirroring
     `compareSetups.ts`'s `findBoundPanel`), rewrites `config.runId` to
     the refined run and `comparisonView` to `null`, one revision bump,
     one undo token (AC9/AC10).
- `similarity/refinement/tools/refineSimilaritySearch.ts` — wire
  boundary: `run_id`, `accepted_match_ids`, `rejected_match_ids`, optional
  `panel_id`, `expected_revision`, `idempotency_key`. Response is the
  mutation envelope plus `panel_id`, `source_run_id`, `weight_changes`,
  and the refined run's own wire shape (`toWireSimilarityRun`) — with
  `warnings` explicitly set to the envelope's own (refinement warnings +
  search warnings already merged into it at commit time) *after* spreading
  the run's wire shape, since `toWireSimilarityRun` carries its own
  (narrower) `warnings` field that would otherwise silently clobber it.
  No `registerRefinementTools.ts` composition root — T-1014-11 owns
  wiring the follow-up tool surface into the app; this ticket only
  exports `buildRefineSimilaritySearchTool`, matching how
  `find_similar_setups`/`explain_similarity`/`compare_setups` each expose
  a `build*Tool` factory for their own composition root to consume.

**Testing:** unit tests for `refineWeights`/`validateFeedback` covering
every AC's scenario table row directly against the pure function; an
application-layer test with a fake `SimilarityApiPort` (real behavior, not
name-keyed) and a real panel registry (matching `findSimilarSetups.test.ts`'s
own harness style) covering AC9 (idempotency replay, stale revision) and
AC10 (undo restores `config.runId`, and the source run's weights read back
unchanged); a tool-layer test for wire parsing and error-shape mapping.
Mutation-checked: AC8's clamp warning (remove the `Math.max(0, ...)` and
confirm the test goes red), AC10's undo (remove the panel-rebind write and
confirm the "restores exactly" test goes red), and AC6/AC7's rejections
(remove each `validateFeedback` branch and confirm its test goes red).
