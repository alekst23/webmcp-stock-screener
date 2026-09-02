# T-1012-2: Similarity search engine over the price panel

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Done
**Depends on**: T-1012-1
**Blocks**: T-1012-3

## Description

With the contract fixed, this ticket makes it real: extract comparable
features from a window of price/volume history, generate candidate windows
across the universe, score them against a reference setup, and return a
ranked, pinned run. This is where the epic's actual analytical work lives.

The project already computes panel-wide derived series with pandas
`groupby`/`rolling` and extracts windows around an anchor date; that
technique is directly reusable here and is the reason the analytical layer
is Python rather than TypeScript.

## User Story

As the similarity API,
I want a searchable engine that turns a reference setup into a ranked list
of scored, explained candidates drawn from real price history,
so that the tools above it can present matches a researcher can audit.

## Acceptance Criteria

1. Given a reference window (an instrument plus a date range) the engine
   produces a feature vector covering all six feature families, computed
   from the loaded price panel.
2. Feature extraction is invariant to the things normalization is meant to
   remove: two windows with identical shape but different absolute price
   level and different bar count produce price-shape features that score as
   highly similar under the same normalization settings.
3. Given a reference setup and a search scope, the engine returns candidate
   windows ranked by descending overall score, each carrying its
   per-family measured similarities and a stable candidate ID.
4. The search scope selects between other instruments, other historical
   windows of the same instrument, and both — and the returned run states
   which scope was applied.
5. The reference window itself, and windows overlapping it, are excluded
   from its own results — a setup is not returned as a match for itself.
6. A caller-supplied weight set changes the ranking; the same search run
   with a different weight set produces a different ordering, and both runs
   report the weight set actually used.
7. Candidate count is bounded by an explicit limit, and results below a
   caller-supplied minimum score are excluded rather than padded.
8. A completed run is retrievable by its stable run ID and returns
   identical candidates and scores without recomputing the search.
9. An explanation for any candidate in a completed run is derivable from
   that run alone, and its per-family contributions reconcile to that
   candidate's score.
10. Every run reports its market-data provenance — `as_of`, source,
    live/delayed status, timezone, currency, adjusted/unadjusted price
    basis, and calculation-engine version — populated from the panel it
    searched, not hardcoded.
11. Searching against a universe with no eligible candidates returns an
    empty run with a warning explaining why (empty universe, all candidates
    below the minimum score, or insufficient history), not an error and not
    a silently relaxed search.
12. A reference window with insufficient history to compute a feature
    family degrades explicitly: that family is reported as unavailable and
    excluded from the weighted score, with the excluded families named in
    the run's warnings, rather than being scored as zero.
13. The engine is reachable through a domain-layer Protocol; the
    implementation lives in the infrastructure layer and the domain layer
    imports nothing from it.

## Design References

- `docs/plan/EPIC-1012/T-1012-1-similarity-contract.md` — the entities and
  scoring rule this implements
- `backend/infra/pandas_engine.py` — the panel-wide `groupby`/`rolling`
  technique, the anchor-relative window extraction in
  `get_instance_windows`, and the sampling strategies; also the established
  pattern of caching per-ticker frames and date-position indexes
- `backend/infra/expression.py` — the derived-series evaluator, reusable
  for study-family features
- `backend/domain/contracts/engine.py` — the Protocol style to follow
- `backend/tests/unit/test_pattern_research_engine.py` — the existing
  engine unit-test style and fixture approach

## Technical Considerations

- Relative-strength and any fundamental-flavored features depend on
  reference data from a separate parallel workstream. Consume it through
  the domain ports EPIC-1008 defines; do not build a mock pipeline for it
  and do not block on it. If the port is unavailable, AC12's explicit
  degradation path covers it — report the family unavailable.
- The existing engine keeps `PandasPatternResearchEngine` under the class
  size limit by delegating to module-level helpers; hold to the same limits
  (methods 30-40 lines, classes under 400) here.
- Cross-symbol search over a full panel is the expensive operation in this
  epic. Prefer vectorized panel-wide computation over per-candidate loops,
  as the existing engine does, and cover the cost in the test plan.
- New files only. Do not modify `pandas_engine.py` or the existing engine
  Protocol.

## Solution Approach

**Files:**
- `backend/domain/contracts/similarity_engine.py` — the `SimilarityEngine`
  Protocol (AC13) and the `SearchScope` literal
  (`"cross_instrument" | "same_instrument_windows" | "both"`, AC4).
- `backend/infra/similarity_features.py` — `SimilarityFeatureExtractor`,
  pure numpy/pandas feature extraction from a row range of the panel.
- `backend/infra/similarity_engine.py` — `PandasSimilarityEngine`,
  candidate generation, scoring orchestration, run pinning, provenance.
- `backend/domain/errors.py` — three additions:
  `SimilarityReferenceUnavailableError`, `SimilarityRunNotFoundError`,
  `SimilarityCandidateNotFoundError`, so T-1012-3 can catch typed errors at
  the HTTP boundary the same way `research.py` catches `ExpressionError`.
- `backend/tests/unit/test_similarity_engine.py`.

**Feature extraction (AC1, AC2, AC12):** each of the six families is a
module-level function taking numpy arrays sliced from the panel and
returning a fixed-length `tuple[float, ...]`, or `None` when the window
carries too little history. `price_shape` and `volume` are built from a
*relative* series (percent-change-from-first-close; volume-over-its-own-mean)
resampled via linear interpolation (`np.interp`) onto a fixed number of
points (`_SHAPE_POINTS = 12`) — this is what makes AC2 hold: the embedding's
length no longer depends on the window's bar count, and its values no
longer depend on the instrument's absolute price level or share-volume
scale, only on shape. `volatility` and `pattern_structure` are small fixed
stat tuples (return stdev/mean-abs-return/mean range; up-day fraction/gap-up
fraction/body-to-range) computed directly from returns, so they are
naturally bar-count-invariant without resampling. `studies` reuses
`infra/expression.py`'s `ExpressionEvaluator`, evaluated **once, panel-wide**
at `SimilarityFeatureExtractor.__init__` for two fixed ratio expressions
(`close / sma(close, 5)`, `volume / sma(volume, 10)`), then sliced and
resampled per window — the vectorized reuse the design references call for.
`relative_strength` has no data source (grepped `backend/domain/` and
`backend/infra/` for any EPIC-1008-shaped reference-data port — none exists
yet) and is always omitted, never fabricated. A family is *omitted* from the
returned `FeatureVector` dict rather than scored as zero; T-1012-1's
`score_candidate` already treats a family present in only one of the two
compared vectors (or neither) as unavailable and renormalizes the weight
set over what remains, so no change to T-1012-1's committed contract was
needed for AC12 — this ticket's original flag that a `FeatureWeightSet`
extension might be required turned out to be unnecessary once the
omit-rather-than-zero mechanism was actually exercised in an engine, not
just in T-1012-1's own unit tests.

**Candidate generation (AC3, AC4, AC5):** windows the same bar-count as the
reference, generated at a stride of 5 rows within a ticker's own contiguous
row range (`PanelFrame.bounds`). `same_instrument_windows` walks the
reference ticker's own range, excluding any candidate window whose row
range overlaps `[ref_start, ref_end)` (AC5). `cross_instrument` walks every
other ticker present in the panel. Both are capped at 500 raw candidates
per scope (`_MAX_RAW_CANDIDATES_PER_SCOPE`) — an explicit, documented bound
rather than an unstrided walk of a multi-million-row real panel per search;
full-scale tuning (e.g. adaptive stride, panel-wide vectorized window
extraction the way `pandas_engine.py`'s `groupby`/`rolling` does for scalar
aggregates) is flagged below as follow-on work, not attempted here.

**Scoring/ranking/pinning (AC6, AC7, AC8, AC9):** each candidate's
`FeatureVector` is scored against the reference via T-1012-1's
`score_candidate` unchanged; candidates below `min_score` are dropped, not
padded (AC7); the remainder is sorted by descending `overall` and truncated
to `limit`. Each run is pinned in an in-memory `dict[run_id, _StoredRun]`
where `_StoredRun` holds both the public `SimilarityRun` (trimmed
`SimilarityCandidate`s, AC8) and a parallel `dict[candidate_id,
SimilarityScore]` carrying the full per-family weight/contribution detail
`explain()` needs (AC9) — built once at search time via `to_explanation()`,
never recomputed, so an explanation can never disagree with the run it
belongs to.

**IDs:** following T-1012-1's documented grammar and its note to this
ticket's implementer: `run_id` is `similarity_run_{n}` (plain `str`, no
ID-minting infra exists on the Python side — matches
`PandasPatternResearchEngine`'s own `_new_id` convention of a prefix plus a
counter); `candidate_id` is `{run_id}_candidate_{n}`, assigned by rank
position within the returned page, stable because a pinned run is never
recomputed.

**`SimilarityRun.scope` (small addition to T-1012-1's committed model):**
AC4 requires "the returned run states which scope was applied," but
T-1012-1's `SimilarityRun` had no field for it. Added `scope: SearchScope`
(required) to `backend/domain/models/similarity.py`'s `SimilarityRun`, and
the `SearchScope` literal itself alongside `NormalizationMode`/
`NormalizationAnchor` in that same file (not only in
`domain/contracts/similarity_engine.py`, which now imports it from there,
so the two modules can't drift). `test_similarity_models.py` never
constructs a bare `SimilarityRun`, so this is a non-breaking addition to
T-1012-1's test suite. This is exactly the kind of same-epic follow-on
T-1012-1's own doc anticipated, not an edit to another epic's file.

**`reference_setup_id` (deviation, flagged for T-1012-3):** T-1012-1's
`SimilarityRun.reference_setup_id: str` names a *captured setup*, a concept
this ticket does not have — `search()` takes an instrument + window
directly (per the ticket description), not a setup ID. `search()` accepts
an optional `reference_setup_id` keyword, defaulting to `instrument_id`
when omitted, so the field is always populated. T-1012-3, which resolves an
actual captured-setup ID to an instrument/window before calling this
engine, should pass the real ID through explicitly.

**Provenance (AC10):** sourced from a `PanelStatus` passed into
`PandasSimilarityEngine.__init__` (the same shape `research.py`'s panel
endpoint reports) — `as_of` from `status.as_of`, `source_id`/`source_label`
from `status.source`, `liveness` fixed to `"historical"` (this engine only
ever searches loaded-panel history, never a live feed), `price_adjustment`
fixed to `"adjusted"` (`PriceBar`'s own docstring: "one adjusted daily OHLCV
row"). Computed once at construction, not hardcoded into the module.

**Empty-universe warnings (AC11):** three distinguishable causes, each its
own warning string: no raw candidates generated at all (empty universe for
the requested scope); raw candidates existed but none had enough history to
compute any feature family; raw candidates existed and had history but none
cleared `min_score`. A run in any of these states returns normally with an
empty candidate list, never raises.

**Follow-on work flagged for T-1012-3 / later tickets:**
1. `reference_setup_id` resolution (a captured setup ID → instrument +
   window) is T-1012-3's job; this ticket's `search()` signature expects
   the resolved form.
2. Candidate generation is stride/cap-bounded, not a full vectorized sweep
   of the whole panel; if a later ticket needs exhaustive or
   adaptively-sampled search over the full real panel, that is new work on
   top of `_same_instrument_windows`/`_cross_instrument_windows`, not a
   drop-in.
3. `min_score`/`limit`/`weights`/`normalization`/`scope` are all
   caller-supplied at the engine boundary; T-1012-3 owns validating and
   defaulting them at the HTTP layer (e.g. rejecting a negative `limit`)
   before they reach this engine.

**Mutation-check plan:** AC2 (invariance) reverted by removing the
percent-change/relative-to-mean transform (comparing raw closes/volumes
instead); AC5 (self-exclusion) reverted by removing the overlap check; AC6
(weight sensitivity) reverted by ignoring the caller's `weights` argument;
AC8 (pinning) reverted by having `get_run` recompute instead of look up;
AC9 (reconciliation) reverted by breaking `to_explanation`'s pass-through;
AC11 (empty-universe) reverted by raising instead of returning a warned
empty run; AC12 (degradation) reverted by scoring an unavailable family as
zero instead of omitting it. Each: run red, confirm failure, restore,
confirm green.

## Out of Scope

- HTTP routes and request/response schemas (T-1012-3).
- Persisting runs beyond the process (in-memory pinning is sufficient
  unless EPIC-1006's revision model requires otherwise).
- Rendering or comparison views.
