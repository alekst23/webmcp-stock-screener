"""Similarity feature and scoring contract (EPIC-1012).

Pure business concepts -- feature families, weight sets, feature vectors,
scoring, candidates, explanations, runs, and provenance -- with no I/O. The
engine (T-1012-2), the API (T-1012-3), the three tools, and the panel all
read this module rather than each inventing its own shape.

The TypeScript encoding of the same contract is
src/lib/workbench/similarity/domain/contract.ts. One contract, two
encodings: this module and that one are not required to interoperate
directly (no shared computation path crosses the HTTP boundary), only to
each independently satisfy their own reconciliation guarantee (AC5).
"""

from __future__ import annotations

import math
from datetime import date, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class FeatureFamily(str, Enum):
    """The six comparable feature families a similarity score decomposes
    into. A closed enum, not an ad-hoc string, so a typo in a family name is
    a validation error rather than a silently-ignored weight or a candidate
    that is quietly missing a dimension."""

    PRICE_SHAPE = "price_shape"
    VOLUME = "volume"
    VOLATILITY = "volatility"
    RELATIVE_STRENGTH = "relative_strength"
    STUDIES = "studies"
    PATTERN_STRUCTURE = "pattern_structure"


ALL_FEATURE_FAMILIES: tuple[FeatureFamily, ...] = tuple(FeatureFamily)

_DEFAULT_WEIGHT = 1.0 / len(FeatureFamily)


class InstrumentRef(BaseModel):
    """A stable-ID reference to an instrument -- never a bare ticker used as
    an identifier. Deliberately scoped to this module rather than reusing
    the old surface's `Instance` (a (ticker, date) occurrence, a different
    concept) or defining a shared cross-epic type this ticket does not own.
    """

    instrument_id: str
    symbol: str
    exchange: str | None = None
    asset_type: str | None = None


class WindowRef(BaseModel):
    """A historical window a candidate or reference setup covers."""

    start: date
    end: date
    timeframe: str


NormalizationMode = Literal["none", "percent_change", "indexed_100", "z_score"]
NormalizationAnchor = Literal["window_start", "anchor_bar"]

# T-1012-2's AC4: a search scope selects other instruments
# ("cross_instrument"), other historical windows of the same instrument
# ("same_instrument_windows"), or both -- and the run that ran under it
# states which. Defined here (not only in
# domain/contracts/similarity_engine.py, which imports this one) so
# `SimilarityRun.scope` doesn't need a domain/models -> domain/contracts
# back-reference.
SearchScope = Literal["cross_instrument", "same_instrument_windows", "both"]


class NormalizationRef(BaseModel):
    """Mirrors `Normalization` in
    src/lib/workbench/chart/domain/instrument.ts -- the normalization
    carried by a captured setup, recorded here as a first-class value so a
    similarity run states the basis on which it compared candidates (AC7)
    rather than leaving it to be re-derived downstream."""

    mode: NormalizationMode
    anchor: NormalizationAnchor


ProvenanceLiveness = Literal["live", "delayed", "end_of_day", "historical", "static"]
PriceAdjustment = Literal["adjusted", "unadjusted", "not_applicable"]


class MarketDataProvenance(BaseModel):
    """Python-side mirror of src/lib/workbench/domain/provenance.ts's
    `MarketDataProvenance`. No Python-side provenance model exists anywhere
    in backend/domain/ yet (checked before adding this), so this is the
    first -- AC9's field list, no more.
    """

    as_of: datetime
    source_id: str
    source_label: str
    liveness: ProvenanceLiveness
    delay_seconds: int | None = None
    timezone: str
    currency: str | None = None
    price_adjustment: PriceAdjustment | None = None
    engine_version: str

    @model_validator(mode="after")
    def _delay_seconds_matches_liveness(self) -> "MarketDataProvenance":
        if self.liveness == "delayed" and self.delay_seconds is None:
            raise ValueError("delay_seconds is required when liveness is 'delayed'.")
        if self.liveness != "delayed" and self.delay_seconds is not None:
            raise ValueError("delay_seconds must be omitted unless liveness is 'delayed'.")
        return self


class FeatureWeightSet(BaseModel):
    """Assigns a weight to each of the six feature families. A plain,
    round-trippable value -- returned to a caller and later supplied back
    unchanged (AC2) -- not a stateful builder."""

    model_config = {"frozen": True}

    weights: dict[FeatureFamily, float]

    @classmethod
    def from_partial(cls, partial: dict[str, float] | None = None) -> "FeatureWeightSet":
        """Builds a complete weight set from a caller-supplied partial one,
        defaulting every unspecified family to equal weight.

        Raises:
            ValueError: naming the offending entry, for an unknown family
                name, a negative weight, or a result that cannot be
                normalized (all weights zero) -- never silently coerced
                (AC10).
        """
        weights: dict[FeatureFamily, float] = {family: _DEFAULT_WEIGHT for family in FeatureFamily}
        for name, value in (partial or {}).items():
            try:
                family = FeatureFamily(name)
            except ValueError:
                raise ValueError(f"Unknown feature family: {name!r}") from None
            if value < 0:
                raise ValueError(f"Weight for {name!r} must not be negative, got {value}.")
            weights[family] = value
        if sum(weights.values()) <= 0:
            raise ValueError("Weights cannot be normalized: every weight is zero.")
        return cls(weights=weights)


FeatureVector = dict[FeatureFamily, tuple[float, ...]]


class SimilarityScore(BaseModel):
    """The result of scoring one candidate against a reference: the overall
    score and the per-family breakdown that produced it, in one object so a
    caller can never read one without the other (AC3's "no bare score")."""

    overall: float
    per_family_similarity: dict[FeatureFamily, float]
    weight_applied: dict[FeatureFamily, float]
    contributions: dict[FeatureFamily, float]
    unavailable_families: list[FeatureFamily] = Field(default_factory=list)

    def reconciles(self, tolerance: float = 1e-9) -> bool:
        """True when the per-family contributions sum to the overall score
        within `tolerance` -- the epic's central auditability guarantee
        (AC5), checkable by any reader of the response."""
        return abs(sum(self.contributions.values()) - self.overall) <= tolerance


def per_family_similarity(reference: tuple[float, ...], candidate: tuple[float, ...]) -> float:
    """Cosine similarity between two same-length feature embeddings,
    rescaled from [-1, 1] to [0, 1] so a family's similarity is never
    negative -- a merely dissimilar (not anti-correlated) family should not
    subtract from an otherwise-positive score when weighted and summed.

    Raises:
        ValueError: if the two embeddings have different, or zero, length.
    """
    if len(reference) != len(candidate):
        raise ValueError(
            f"Reference and candidate feature vectors must have matching length, "
            f"got {len(reference)} and {len(candidate)}."
        )
    if not reference:
        raise ValueError("Feature vectors must not be empty.")
    dot = sum(r * c for r, c in zip(reference, candidate))
    ref_norm = math.sqrt(sum(r * r for r in reference))
    cand_norm = math.sqrt(sum(c * c for c in candidate))
    if ref_norm == 0 or cand_norm == 0:
        return 0.0
    cosine = max(-1.0, min(1.0, dot / (ref_norm * cand_norm)))
    return (cosine + 1.0) / 2.0


def score_candidate(
    reference: FeatureVector,
    candidate: FeatureVector,
    weights: FeatureWeightSet,
) -> SimilarityScore:
    """Pure function of a reference feature vector, a candidate feature
    vector, and a weight set (AC6) -- no data access, no clock, no
    randomness, so the same three inputs always yield the same score and
    the same contributions.

    Families present in both vectors are scored and their weights
    renormalized over just that available subset, so a family missing from
    either side is excluded from the weighted score rather than scored as
    zero (the degradation path T-1012-2's AC12 depends on). The overall
    score is literally the sum of the contributions, not a separately
    computed number that happens to match -- this is what makes AC5's
    reconciliation guarantee hold by construction.

    Raises:
        ValueError: if no family is available in both vectors, or the
            available families carry no positive weight.
    """
    available = sorted(set(reference) & set(candidate), key=lambda f: f.value)
    unavailable = sorted(set(FeatureFamily) - set(available), key=lambda f: f.value)
    if not available:
        raise ValueError(
            "No feature family is available in both the reference and candidate vectors."
        )
    raw_weights = weights.weights
    available_weight_total = sum(raw_weights[family] for family in available)
    if available_weight_total <= 0:
        raise ValueError("No positive weight among the available feature families.")

    similarities: dict[FeatureFamily, float] = {}
    weight_applied: dict[FeatureFamily, float] = {}
    contributions: dict[FeatureFamily, float] = {}
    for family in available:
        similarity = per_family_similarity(reference[family], candidate[family])
        normalized_weight = raw_weights[family] / available_weight_total
        similarities[family] = similarity
        weight_applied[family] = normalized_weight
        contributions[family] = normalized_weight * similarity

    return SimilarityScore(
        overall=sum(contributions.values()),
        per_family_similarity=similarities,
        weight_applied=weight_applied,
        contributions=contributions,
        unavailable_families=unavailable,
    )


def to_explanation(candidate_id: str, score: SimilarityScore) -> "SimilarityExplanation":
    """Builds the explanation for one candidate directly from the
    `SimilarityScore` that scored it -- the same object `score_candidate`
    returned, never recomputed, so an explanation can never disagree with
    the score it explains (AC4's "identical to the score that search
    returned", carried forward into T-1012-3/5's pinned-run guarantee)."""
    return SimilarityExplanation(
        candidate_id=candidate_id,
        overall_score=score.overall,
        weight_applied=score.weight_applied,
        per_family_similarity=score.per_family_similarity,
        contributions=score.contributions,
        unavailable_families=score.unavailable_families,
    )


class SimilarityCandidate(BaseModel):
    """One search result: an instrument, historical window, overall score,
    and the per-family measured similarity that produced it (AC3).

    Identified by `candidate_id`, a stable, run-scoped string -- never a
    bare ticker. Deliberately not minted through
    src/lib/workbench/domain/ids.ts's `ResourceKind` scheme: extending that
    closed union would be an edit to EPIC-1006's shared contract file, out
    of scope for a "new files only" ticket. See this ticket's Solution
    Approach for the grammar (`{run_id}_candidate_{n}`) and the note to
    T-1012-2/3's implementers.
    """

    candidate_id: str
    instrument: InstrumentRef
    window: WindowRef
    score: float
    per_family_similarity: dict[FeatureFamily, float]
    unavailable_families: list[FeatureFamily] = Field(default_factory=list)


class SimilarityExplanation(BaseModel):
    """Decomposes one candidate into, per family: the weight applied, the
    measured per-family similarity, and that family's signed contribution
    to the overall score (AC4) -- reconciling to that score (AC5)."""

    candidate_id: str
    overall_score: float
    weight_applied: dict[FeatureFamily, float]
    per_family_similarity: dict[FeatureFamily, float]
    contributions: dict[FeatureFamily, float]
    unavailable_families: list[FeatureFamily] = Field(default_factory=list)

    def reconciles(self, tolerance: float = 1e-9) -> bool:
        return abs(sum(self.contributions.values()) - self.overall_score) <= tolerance


class SimilarityRun(BaseModel):
    """A pinned, identified search result (AC8): a stable run ID, the
    reference setup it came from, the search scope that was applied
    (T-1012-2 AC4), the weight set used, the normalization settings applied,
    the market-data provenance, and its ranked candidates."""

    run_id: str
    reference_setup_id: str
    scope: SearchScope
    weights: FeatureWeightSet
    normalization: NormalizationRef
    provenance: MarketDataProvenance
    candidates: list[SimilarityCandidate]
    warnings: list[str] = Field(default_factory=list)
