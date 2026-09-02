"""T-1012-1: domain/models/similarity.py -- the shared feature/scoring
contract, tested in isolation before any engine reads real price data."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from domain.models.similarity import (
    FeatureFamily,
    FeatureWeightSet,
    MarketDataProvenance,
    per_family_similarity,
    score_candidate,
    to_explanation,
)


def _provenance(**overrides: object) -> MarketDataProvenance:
    defaults: dict[str, object] = {
        "as_of": "2026-09-01T20:00:00+00:00",
        "source_id": "src.mock.panel",
        "source_label": "Mock panel",
        "liveness": "end_of_day",
        "timezone": "America/New_York",
        "currency": "USD",
        "price_adjustment": "adjusted",
        "engine_version": "0.1.0",
    }
    defaults.update(overrides)
    return MarketDataProvenance(**defaults)  # type: ignore[arg-type]


class TestFeatureWeightSet:
    def test_default_weights_are_equal_across_all_six_families(self) -> None:
        weights = FeatureWeightSet.from_partial(None)

        assert len(weights.weights) == 6, f"expected all six families, got {weights.weights}"
        values = set(weights.weights.values())
        assert values == {1.0 / 6}, f"expected equal default weights, got {weights.weights}"

    def test_partial_weights_fill_remaining_families_with_the_default(self) -> None:
        weights = FeatureWeightSet.from_partial({"price_shape": 0.5})

        assert weights.weights[FeatureFamily.PRICE_SHAPE] == 0.5
        assert weights.weights[FeatureFamily.VOLUME] == 1.0 / 6, (
            f"expected an unspecified family to default to equal weight, got "
            f"{weights.weights[FeatureFamily.VOLUME]}"
        )

    def test_weight_set_round_trips_through_reconstruction(self) -> None:
        original = FeatureWeightSet.from_partial({"price_shape": 0.9, "volume": 0.1})
        rebuilt = FeatureWeightSet(weights=dict(original.weights))

        assert rebuilt == original, "a weight set supplied back unchanged must reconstruct equal"

    def test_unknown_family_name_is_rejected_naming_the_entry(self) -> None:
        with pytest.raises(ValueError, match="not_a_real_family"):
            FeatureWeightSet.from_partial({"not_a_real_family": 0.5})

    def test_negative_weight_is_rejected_naming_the_entry(self) -> None:
        with pytest.raises(ValueError, match="volume"):
            FeatureWeightSet.from_partial({"volume": -0.1})

    def test_all_zero_weights_are_rejected_as_unnormalizable(self) -> None:
        all_zero = {family.value: 0.0 for family in FeatureFamily}
        with pytest.raises(ValueError, match="normalized"):
            FeatureWeightSet.from_partial(all_zero)


class TestPerFamilySimilarity:
    def test_identical_vectors_score_as_maximally_similar(self) -> None:
        result = per_family_similarity((1.0, 2.0, 3.0), (1.0, 2.0, 3.0))

        assert result == pytest.approx(1.0), f"expected 1.0 for identical vectors, got {result}"

    def test_opposite_vectors_score_as_minimally_similar(self) -> None:
        result = per_family_similarity((1.0, 0.0), (-1.0, 0.0))

        assert result == pytest.approx(0.0), f"expected 0.0 for opposite vectors, got {result}"

    def test_mismatched_lengths_are_rejected(self) -> None:
        with pytest.raises(ValueError, match="length"):
            per_family_similarity((1.0, 2.0), (1.0,))

    def test_empty_vectors_are_rejected(self) -> None:
        with pytest.raises(ValueError, match="empty"):
            per_family_similarity((), ())


class TestScoreCandidate:
    def _vectors(self) -> tuple[dict[FeatureFamily, tuple[float, ...]], dict]:
        reference = {
            FeatureFamily.PRICE_SHAPE: (1.0, 0.0, 0.0),
            FeatureFamily.VOLUME: (0.0, 1.0, 0.0),
            FeatureFamily.VOLATILITY: (0.0, 0.0, 1.0),
        }
        candidate = {
            FeatureFamily.PRICE_SHAPE: (1.0, 0.0, 0.0),
            FeatureFamily.VOLUME: (0.0, 1.0, 0.0),
            FeatureFamily.VOLATILITY: (1.0, 0.0, 0.0),
        }
        return reference, candidate

    def test_contributions_reconcile_to_the_overall_score_with_uniform_weights(self) -> None:
        reference, candidate = self._vectors()
        weights = FeatureWeightSet.from_partial(
            {"price_shape": 1 / 3, "volume": 1 / 3, "volatility": 1 / 3}
        )

        score = score_candidate(reference, candidate, weights)

        assert (
            score.reconciles()
        ), f"contributions {score.contributions} must sum to overall score {score.overall}"

    def test_contributions_reconcile_to_the_overall_score_with_non_uniform_weights(self) -> None:
        # A non-uniform weight set is the case a uniform-weight fixture could
        # pass by coincidence -- this is the test that actually exercises the
        # per-family renormalization in score_candidate.
        reference, candidate = self._vectors()
        weights = FeatureWeightSet.from_partial(
            {"price_shape": 0.7, "volume": 0.2, "volatility": 0.1}
        )

        score = score_candidate(reference, candidate, weights)

        assert score.reconciles(), (
            f"contributions {score.contributions} must sum to overall score {score.overall} "
            "even under a non-uniform weight set"
        )
        assert score.overall != pytest.approx(
            score_candidate(reference, candidate, FeatureWeightSet.from_partial({})).overall
        ), "a non-uniform weight set must change the score relative to the uniform default"

    def test_explanation_built_from_the_score_also_reconciles(self) -> None:
        reference, candidate = self._vectors()
        weights = FeatureWeightSet.from_partial(
            {"price_shape": 0.6, "volume": 0.3, "volatility": 0.1}
        )
        score = score_candidate(reference, candidate, weights)

        explanation = to_explanation("run_similarity_1_candidate_1", score)

        assert explanation.reconciles(), (
            f"explanation contributions {explanation.contributions} must sum to "
            f"{explanation.overall_score}"
        )
        assert explanation.overall_score == score.overall
        assert explanation.candidate_id == "run_similarity_1_candidate_1"

    def test_unavailable_families_are_excluded_not_scored_as_zero(self) -> None:
        reference = {FeatureFamily.PRICE_SHAPE: (1.0, 0.0), FeatureFamily.VOLUME: (0.0, 1.0)}
        candidate = {FeatureFamily.PRICE_SHAPE: (1.0, 0.0)}
        weights = FeatureWeightSet.from_partial({"price_shape": 0.5, "volume": 0.5})

        score = score_candidate(reference, candidate, weights)

        # Every family absent from the *intersection* is unavailable, not just
        # ones the reference happened to mention -- volume is unavailable
        # because the candidate lacks it, and the three families neither side
        # measured at all are unavailable for the same reason.
        assert (
            FeatureFamily.VOLUME in score.unavailable_families
        ), f"expected volume to be reported unavailable, got {score.unavailable_families}"
        assert FeatureFamily.PRICE_SHAPE not in score.unavailable_families, (
            f"price_shape is present in both vectors and must not be unavailable, "
            f"got {score.unavailable_families}"
        )
        assert (
            FeatureFamily.VOLUME not in score.contributions
        ), "an unavailable family must be excluded from contributions, not scored as zero"
        assert score.reconciles(), "reconciliation must still hold with a family excluded"
        assert score.overall == pytest.approx(1.0), (
            f"expected the sole available family (perfect match) to drive the whole score, "
            f"got {score.overall}"
        )

    def test_no_available_family_raises(self) -> None:
        reference = {FeatureFamily.PRICE_SHAPE: (1.0,)}
        candidate = {FeatureFamily.VOLUME: (1.0,)}
        weights = FeatureWeightSet.from_partial({})

        with pytest.raises(ValueError, match="available"):
            score_candidate(reference, candidate, weights)


class TestMarketDataProvenance:
    def test_delayed_liveness_requires_delay_seconds(self) -> None:
        with pytest.raises(ValidationError, match="delay_seconds"):
            _provenance(liveness="delayed", delay_seconds=None)

    def test_non_delayed_liveness_rejects_delay_seconds(self) -> None:
        with pytest.raises(ValidationError, match="delay_seconds"):
            _provenance(liveness="live", delay_seconds=30)

    def test_delayed_with_delay_seconds_is_valid(self) -> None:
        provenance = _provenance(liveness="delayed", delay_seconds=900)

        assert provenance.delay_seconds == 900
