"""Request/response schemas for the similarity search and explanation API
(EPIC-1012 T-1012-3).

Stateless per request, matching api/schemas/research.py's existing
convention: the caller passes an instrument + window by value rather than a
server-side captured-setup lookup, since the backend has no access to the
browser's workspace state. Response bodies reuse domain.models.similarity's
entities directly where a route's response IS that entity unmodified
(SimilarityRun, SimilarityExplanation); SimilarityRunPage below only exists
because paging a run's candidates is a read-side concern this route layer
owns, not the engine's.
"""

from __future__ import annotations

from pydantic import BaseModel

from domain.contracts.similarity_engine import SearchScope
from domain.models.similarity import (
    FeatureWeightSet,
    MarketDataProvenance,
    NormalizationRef,
    SimilarityCandidate,
    WindowRef,
)


class SimilaritySearchRequest(BaseModel):
    instrument_id: str
    window: WindowRef
    scope: SearchScope
    # Partial by family name; validated and defaulted by
    # FeatureWeightSet.from_partial at the route (AC6's naming-the-offending-
    # entry error comes from that call, not from pydantic field validation,
    # since an unknown family name here is a semantic error, not a shape
    # error).
    weights: dict[str, float] | None = None
    normalization: NormalizationRef | None = None
    limit: int = 20
    min_score: float = 0.0
    # Echoed onto the run's reference_setup_id (T-1012-2's Solution
    # Approach): the caller (T-1012-4's tool) resolves the real captured
    # setup ID client-side and passes it through here.
    reference_setup_id: str | None = None


class SimilarityRunPage(BaseModel):
    """A SimilarityRun with its candidates sliced to one page. Every other
    field is the full run's own value -- paging only affects `candidates`."""

    run_id: str
    reference_setup_id: str
    scope: SearchScope
    weights: FeatureWeightSet
    normalization: NormalizationRef
    provenance: MarketDataProvenance
    candidates: list[SimilarityCandidate]
    warnings: list[str]
    total_candidates: int
    offset: int
    next_offset: int | None
