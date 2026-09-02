# T-1012-5: `explain_similarity` tool

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Done
**Depends on**: T-1012-3
**Blocks**: T-1012-8

## Description

A similarity score on its own is not usable evidence — a researcher has to
be able to disagree with a match and see precisely what drove it. This
tool is the epic's transparency surface, the counterpart to
`explain_result` for screeners: given any candidate from a completed
search, it returns the feature-by-feature contributions behind that
candidate's score.

## User Story

As a researcher looking at a proposed match I am not sure about,
I want to see which features made it rank where it did and how much each
one contributed,
so that I can accept it, reject it, or reweight the search on evidence
rather than on trust.

## Acceptance Criteria

1. The tool accepts a similarity run ID and a candidate ID, both stable
   IDs from a completed search.
2. It returns, for each of the six feature families — price shape, volume,
   volatility, relative strength, studies, and pattern structure — the
   weight applied, the measured per-family similarity, and that family's
   signed contribution to the overall score.
3. The returned contributions reconcile to the candidate's overall score
   within a stated tolerance, and the response states that overall score
   alongside them, so the reconciliation is checkable by the reader.
4. The explanation is served from the pinned run: explaining a candidate
   never re-runs the search, and the score it explains is identical to the
   score that search returned.
5. Feature families that were unavailable for the candidate or the
   reference window are reported as unavailable and named, with their
   exclusion from the weighted score stated — never silently reported as a
   zero contribution.
6. The response states the normalization settings under which the
   comparison was made and the full market-data provenance of the
   underlying data.
7. Explaining a candidate ID that is not part of the named run returns an
   actionable error identifying the mismatch, rather than an explanation
   for some other candidate.
8. Explaining a run ID that no longer exists returns an actionable error
   stating the run is unavailable and that a new search is required — it
   does not silently start one.
9. The tool is read-only: it makes no workspace change, returns no
   mutation envelope, and requires no `expected_revision`.
10. The tool is registered on the new tool surface only; the existing
    11-tool surface is unchanged.

## Design References

- `docs/reference/tool-spec.md` — the `explain_similarity` row (the six
  feature families are named there) and `explain_result`, the screener-side
  transparency tool this parallels
- `docs/plan/EPIC-1012/T-1012-1-similarity-contract.md` — the explanation
  entity and the contributions-reconcile-to-score guarantee
- `docs/plan/EPIC-1012/T-1012-3-similarity-api.md` — the explanation
  endpoint this tool calls
- `src/lib/webmcp/register.ts`, `src/lib/webmcp/tools.ts` — existing
  tool-registration and read-only-tool style

## Technical Considerations

- AC3 is the epic's headline guarantee. A test asserting reconciliation
  only counts as evidence if it fails when the weighting is perturbed —
  a uniform-weight fixture can pass by coincidence, so cover a non-uniform
  weight set.
- AC4 depends on the run pinning established in T-1012-3; do not add a
  fallback that re-runs a missing search, as that would silently violate
  AC8.
- New files only.

## Out of Scope

- Changing weights or re-ranking based on the explanation (EPIC-1014).
- Visualizing the contribution breakdown — the panel (T-1012-6) surfaces
  the top contributing families; rich per-feature charts are not in this
  epic.

## Solution Approach

**AC6 needs a field `SimilarityExplanation` doesn't carry.** T-1012-1's
`SimilarityExplanation` (both encodings) has no `normalization` or
`provenance` field — those live on `SimilarityRun`, and T-1012-3's
`/explanation` endpoint returns a bare `SimilarityExplanation`. To satisfy
AC6, this tool also reads the pinned run (`GET /api/similarity/runs/{id}`,
already built by T-1012-3) for its `normalization`/`provenance`/`scope`,
and states them alongside the explanation in one tool response. Added
`getRun(runId): Promise<SimilarityRun>` to `SimilarityApiPort`/
`httpSimilarityApi.ts` (T-1012-4's shared port, extended here rather than
duplicated) — reusing the existing `fromWireRun` parser unchanged, since a
`SimilarityRunPage` response is a strict superset of what a full run
carries.

**AC7 vs AC8 disambiguation:** T-1012-3's route returns 404 for both "run
not found" and "candidate not found," distinguishable only by message
text, not status code — the same limitation this epic's other 422
responses already have (T-1012-4's Solution Approach noted the same thing
for `/search`). Rather than parsing message text, this tool calls
`getRun(runId)` FIRST: if that 404s, the run itself is unavailable (AC8,
stating "a new search is required," never silently starting one); only if
the run resolves does it call `explain(runId, candidateId)`, so a 404
from THAT call is unambiguously AC7 (a real run, wrong candidate) with no
message-parsing needed either way. Two sequential reads, never `search` --
AC4's "never re-runs the search" holds by construction, since nothing in
this tool's path calls `SimilarityApiPort.search`.

**Files:** `src/lib/workbench/similarity/tools/explainSimilarity.ts` +
test. `apiPort.ts`/`httpSimilarityApi.ts` extended (not duplicated) with
`getRun`.

**Read-only (AC9):** no `commitPanelChange`, no mutation envelope, no
`expected_revision`/`idempotency_key` in the input schema at all --
distinct from every other tool in this epic.

**Testing:** the tool tested against a fake `SimilarityApiPort` with real
per-call behavior (not name-keyed). AC3's reconciliation check uses a
non-uniform weight set (per this ticket's own Technical Considerations --
a uniform-weight fixture could pass by coincidence even with the
underlying math wrong) and is mutation-checked by perturbing one
contribution and confirming the test goes red. AC4 ("never re-runs the
search") is mutation-checked by having the fake's `search` throw if
called at all, so any regression that accidentally invokes it fails
loudly rather than silently passing.
