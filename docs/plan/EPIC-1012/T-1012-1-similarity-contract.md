# T-1012-1: Similarity feature and scoring contract

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Done
**Depends on**: —
**Blocks**: T-1012-2, T-1012-6

## Description

Everything in this epic reads one shared vocabulary: what a setup's
comparable features are, how they combine into a score, and how that score
decomposes back into per-feature contributions. This ticket defines that
vocabulary once — as pure business concepts with no I/O — so the engine,
the API, the three tools, and the panel all agree on it instead of each
inventing its own shape.

The contract is expressed in both the Python domain layer and the
TypeScript type layer, because the same conceptual entities cross the
HTTP boundary in this project. It is one contract with two encodings, not
two contracts.

## User Story

As an implementer of any other ticket in this epic,
I want a single agreed definition of similarity features, weights, scores,
and contributions,
so that a candidate produced by the engine, explained by a tool, and drawn
by a panel is provably the same object throughout.

## Acceptance Criteria

1. A *feature family* is a named, enumerable concept covering exactly the
   six the design calls for: price shape, volume, volatility, relative
   strength, studies, and pattern structure. Nothing in the epic may refer
   to a feature family by an ad-hoc string.
2. A *feature weight set* assigns a weight to each family, can be
   constructed from a caller-supplied partial set with documented
   defaults for the rest, and is itself a value that can be returned to a
   caller and later supplied back unchanged.
3. A *similarity candidate* carries a stable candidate ID, the instrument
   and historical window it refers to (never a bare ticker used as the
   identifier), its overall score, and the per-family measured similarity
   that produced that score.
4. A *similarity explanation* decomposes one candidate into, per family:
   the weight applied, the measured per-family similarity, and that
   family's signed contribution to the overall score.
5. Given any candidate and its explanation, the sum of the per-family
   contributions reconciles to the candidate's reported overall score
   within a stated numeric tolerance. This is verified by test, including
   for a non-uniform weight set.
6. Scoring is a pure function of a reference feature vector, a candidate
   feature vector, and a weight set — no data access, no clock, no
   randomness. The same three inputs always yield the same score and the
   same contributions.
7. Normalization settings (as carried on a captured setup) are represented
   as a first-class value that a search records and reports, so a result
   can state the basis on which it was compared.
8. A *similarity run* is a pinned, identified result: a stable run ID, the
   reference setup ID it came from, the weight set used, the normalization
   settings applied, the market-data provenance, and its ranked candidates.
9. Market-data provenance is representable with `as_of`, source,
   live/delayed status, timezone, currency, adjusted/unadjusted price
   basis, and calculation-engine version.
10. Supplying a weight set with an unknown family name, a negative weight,
    or weights that cannot be normalized is rejected with an error naming
    the offending entry, rather than silently coerced.
11. The domain-layer definitions import nothing from the infrastructure
    layer.

## Design References

- `docs/reference/tool-spec.md` — the Similarity rows (the six feature
  families come verbatim from `explain_similarity`), and the
  "Common contract for every tool" and market-data-provenance sections
- `backend/domain/models/pattern.py`, `backend/domain/models/instance.py` —
  the existing Pydantic domain-entity style to match
- `backend/domain/models/measurement.py` — `InstanceWindow`, the existing
  "bars around an anchor" shape a candidate window resembles
- `src/lib/webmcp/types.ts` — the existing TypeScript mirror of backend
  domain entities and the naming conventions it uses

## Technical Considerations

- EPIC-1011 owns the captured-setup type. Reference it; do not define a
  competing one. If EPIC-1011's type is not yet available when this ticket
  runs, depend on it by ID and document the field expectations rather than
  inlining a substitute definition.
- EPIC-1006 owns the mutation envelope, stable-ID scheme, and provenance
  type. If EPIC-1006 has already defined provenance, consume it and treat
  AC9 as satisfied by that definition rather than duplicating it.
- AC5 is the epic's central auditability guarantee and constrains the
  scoring form: pick a combination rule under which contributions provably
  sum to the score. A rule where they do not is the wrong rule.
- Forward compatibility for EPIC-1014's `refine_similarity_search`: the
  weight set must be a plain input value that a future caller can compute
  and pass in. Nothing in scoring may depend on weights being the defaults.
- New files only. Do not modify the existing pattern-research domain models
  or `src/lib/webmcp/types.ts`.

## Out of Scope

- Computing feature vectors from real price data (T-1012-2).
- Any HTTP route, tool registration, or rendering.
- Learning or adjusting weights from feedback (EPIC-1014).

## Solution Approach

Design-gate skip authorized for this epic (spec.md + detailed ACs stand in
for a written design doc); this section is the required substitute written
before implementation.

**Files (new only):**
- `backend/domain/models/similarity.py` — `FeatureFamily` (str Enum, the six
  families), `InstrumentRef`/`WindowRef` (minimal Pydantic mirrors scoped to
  this module — the existing `Instance`/`InstanceWindow` models are a
  different shape and belong to the old surface), `MarketDataProvenance`
  (no Python-side provenance model exists anywhere in `backend/domain/` yet —
  grepped for it; this is the first), `FeatureWeightSet`, `FeatureVector`
  (`dict[FeatureFamily, tuple[float, ...]]`), `SimilarityCandidate`,
  `SimilarityExplanation`, `SimilarityRun`, and the pure functions
  `per_family_similarity()` and `score_candidate()`.
- `backend/tests/unit/test_similarity_models.py`.
- `src/lib/workbench/similarity/domain/contract.ts` — the same conceptual
  entities, reusing `MarketDataProvenance` from `../../domain/provenance.ts`
  and `Normalization`/`InstrumentRef` from `../../chart/domain/instrument.ts`
  rather than redefining either.
- `src/lib/workbench/similarity/domain/contract.test.ts`.

**Scoring rule (AC5, AC6):** `score_candidate(reference, candidate, weights)`
takes two `FeatureVector`s (one embedding per available family) and a
`FeatureWeightSet`. For each family present in *both* vectors it computes a
bounded `[0, 1]` per-family similarity (cosine similarity of the two
embeddings, rescaled from `[-1, 1]`), renormalizes the weight set over just
the available families (so a missing family's weight doesn't silently
vanish or get to a family that can't use it), and defines that family's
contribution as `normalized_weight * similarity`. The overall score is
literally `sum(contributions.values())` — not a separately computed number
that happens to match — so AC5 holds by construction, not by coincidence.
Families present in neither vector, or in only one, are reported in
`unavailable_families` and excluded from both the weight renormalization and
the contributions (this is what T-1012-2's AC12 degradation path needs).
Both the Python and TS implementations follow this identical rule
independently; exact cross-language numeric parity is not required by this
ticket (out of scope — no shared computation path exists), only that each
side's own test suite proves its own AC5 reconciliation, including with a
non-uniform weight set.

**Weight set (AC2, AC10):** `FeatureWeightSet.from_partial(dict[str, float])`
(Python classmethod) / `makeFeatureWeightSet(partial)` (TS function) builds a
complete set from a caller-supplied partial one, defaulting every
unspecified family to `1/6` (Open Question 3's assumption). Rejects an
unknown family name or a negative weight by raising/returning an error
naming the offending entry; rejects an all-zero result (nothing to
normalize). The returned value is a plain, round-trippable value (Python:
frozen Pydantic model; TS: a plain readonly object), not a stateful builder.

**IDs:** `SimilarityRun.run_id` reuses the existing `'run'` `ResourceKind`
from `src/lib/workbench/domain/ids.ts` via
`ids.next('run', 'similarity')` at the call site that constructs a run (not
in this ticket — this ticket only types the field as `ResourceId`).
`SimilarityCandidate.candidate_id` is deliberately **not** a new
`ResourceKind` — extending the closed `ResourceKind` union in `ids.ts` would
be an edit to EPIC-1006's shared contract file, which this ticket avoids per
"new files only" and per EPIC-1006 owning that scheme. Instead a candidate
ID is a plain, stable, run-scoped string with a documented grammar:
`` `${run_id}_candidate_${n}` ``, still never a bare ticker (AC3), still
opaque and stable across reads of the same pinned run (AC8 in T-1012-2/3).
Flagging this as a finding for whoever wires the engine (T-1012-2) and API
(T-1012-3): if a real `ResourceKind` extension is wanted later, that is a
coordinated EPIC-1006 change, not a local one. On the Python side there is
no ID-minting infra at all (backend's existing models use plain `str` id
fields, e.g. `InstanceSet.id`), so `run_id`/`candidate_id` are plain `str`
there too, following the same grammar for consistency with the TS side.

**Provenance (AC9):** TS side reuses
`src/lib/workbench/domain/provenance.ts`'s `MarketDataProvenance` outright —
no new type. Python side has no equivalent anywhere in `backend/domain/`
(confirmed by grep), so this ticket adds a minimal mirror with the same
field set (`as_of`, `source_id`, `source_label`, `liveness`,
`delay_seconds`, `timezone`, `currency`, `price_adjustment`,
`engine_version`), validated so `delay_seconds` is present exactly when
`liveness == "delayed"` — the same invariant the TS discriminated union
enforces at the type level, enforced here with a Pydantic model validator
since Python has no equivalent tagged-union ergonomics.

**Mutation-check plan:** each AC5/AC10/AC6 test will be run once against the
real implementation (green) and once against a deliberately reverted/broken
version of the specific behavior it covers (red), per family: reconciliation
test reverted by changing `overall` to a hardcoded value independent of
`contributions`; weight-rejection tests reverted by removing the
validation branch; purity is structural (no clock/random/IO imported) rather
than test-provable by mutation, so it is enforced by code review of the
module's imports instead.
