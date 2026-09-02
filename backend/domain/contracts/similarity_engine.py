"""The similarity engine's contract (EPIC-1012 T-1012-2). Implemented by
`infra.similarity_engine.PandasSimilarityEngine`; consumed by T-1012-3's
HTTP layer. Domain layer -- imports nothing from infra.
"""

from __future__ import annotations

from typing import Protocol

from domain.models.similarity import (
    FeatureWeightSet,
    NormalizationRef,
    SearchScope,
    SimilarityExplanation,
    SimilarityRun,
    WindowRef,
)

__all__ = ["SearchScope", "SimilarityEngine"]


class SimilarityEngine(Protocol):
    """A searchable engine over the loaded price panel: turns a reference
    window into a ranked, pinned run of scored, explainable candidates."""

    def search(
        self,
        *,
        instrument_id: str,
        window: WindowRef,
        scope: SearchScope,
        weights: FeatureWeightSet | None = None,
        normalization: NormalizationRef | None = None,
        limit: int = 20,
        min_score: float = 0.0,
        reference_setup_id: str | None = None,
    ) -> SimilarityRun:
        """Runs a similarity search and pins the result under a stable run
        ID (`SimilarityRun.run_id`).

        `weights` defaults to equal weighting across the six families when
        omitted (T-1012-1's `FeatureWeightSet.from_partial(None)`).
        `normalization` defaults to no-op ("none" / "window_start") when
        omitted, but the value actually applied is always the one recorded
        on the returned run. `reference_setup_id` names the captured setup
        this search was run from, when the caller has one (T-1012-3
        resolves it before calling in); defaults to `instrument_id` when
        omitted so the field is always populated.

        Raises:
            domain.errors.SimilarityReferenceUnavailableError: the
                reference instrument/window has no history in the loaded
                panel.
        """
        ...

    def get_run(self, run_id: str) -> SimilarityRun:
        """Returns a previously pinned run, unchanged, without recomputing
        the search.

        Raises:
            domain.errors.SimilarityRunNotFoundError: `run_id` is unknown.
        """
        ...

    def explain(self, run_id: str, candidate_id: str) -> SimilarityExplanation:
        """Derives one candidate's explanation from the pinned run alone --
        never re-runs the search.

        Raises:
            domain.errors.SimilarityRunNotFoundError: `run_id` is unknown.
            domain.errors.SimilarityCandidateNotFoundError: `candidate_id`
                is not part of `run_id`.
        """
        ...
