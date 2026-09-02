"""EPIC-1012 T-1012-3's HTTP boundary between the Python similarity engine
and the browser-side WebMCP tools (T-1012-4/T-1012-5): run a search, read a
pinned run back in bounded pages, and explain any one of its candidates.

Deliberately thin (AC10): request validation, error mapping to the
project's exception hierarchy, and provenance passthrough. All scoring,
ranking and feature computation stays in infra.similarity_engine.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from api.schemas.similarity import SimilarityRunPage, SimilaritySearchRequest
from domain.errors import (
    SimilarityCandidateNotFoundError,
    SimilarityReferenceUnavailableError,
    SimilarityRunNotFoundError,
)
from domain.models.similarity import FeatureWeightSet, SimilarityExplanation, SimilarityRun
from infra.similarity_engine import PandasSimilarityEngine

router = APIRouter(prefix="/api/similarity", tags=["similarity"])

# Mirrors api/routes/research.py's own _NO_PANEL guard: the similarity
# engine is built from the same loaded panel, so it fails the same way for
# the same reason.
_NO_PANEL = (
    "No price panel is loaded, so there is nothing to search. The panel could "
    "not be read from object storage and no local mock panel exists. From "
    "backend/, run `uv run python scripts/generate_mock_panel.py` first."
)

_DEFAULT_PAGE_LIMIT = 20


def get_similarity_engine(request: Request) -> PandasSimilarityEngine:
    engine = getattr(request.app.state, "similarity_engine", None)
    if not isinstance(engine, PandasSimilarityEngine):
        raise HTTPException(status_code=503, detail=_NO_PANEL)
    return engine


def _weight_validation_error(exc: ValueError) -> HTTPException:
    # FeatureWeightSet.from_partial's ValueError message already names the
    # offending entry (AC6) -- this just maps it onto a 422, the same status
    # research.py uses for its own validation errors.
    return HTTPException(status_code=422, detail={"message": str(exc)})


def _resolve_weights(payload: SimilaritySearchRequest) -> FeatureWeightSet:
    try:
        return FeatureWeightSet.from_partial(payload.weights)
    except ValueError as exc:
        raise _weight_validation_error(exc) from exc


@router.post("/search", response_model=SimilarityRun)
def search(
    payload: SimilaritySearchRequest,
    engine: PandasSimilarityEngine = Depends(get_similarity_engine),
) -> SimilarityRun:
    weights = _resolve_weights(payload)
    try:
        return engine.search(
            instrument_id=payload.instrument_id,
            window=payload.window,
            scope=payload.scope,
            weights=weights,
            normalization=payload.normalization,
            limit=payload.limit,
            min_score=payload.min_score,
            reference_setup_id=payload.reference_setup_id,
        )
    except SimilarityReferenceUnavailableError as exc:
        # AC7: names what's missing, never an empty result that reads as "no
        # similar setups exist".
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc


@router.get("/runs/{run_id}", response_model=SimilarityRunPage)
def get_run(
    run_id: str,
    offset: int = 0,
    limit: int = _DEFAULT_PAGE_LIMIT,
    engine: PandasSimilarityEngine = Depends(get_similarity_engine),
) -> SimilarityRunPage:
    try:
        run = engine.get_run(run_id)
    except SimilarityRunNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc

    page = run.candidates[offset : offset + limit]
    next_offset = offset + limit if offset + limit < len(run.candidates) else None
    return SimilarityRunPage(
        run_id=run.run_id,
        reference_setup_id=run.reference_setup_id,
        scope=run.scope,
        weights=run.weights,
        normalization=run.normalization,
        provenance=run.provenance,
        candidates=page,
        warnings=run.warnings,
        total_candidates=len(run.candidates),
        offset=offset,
        next_offset=next_offset,
    )


@router.get(
    "/runs/{run_id}/candidates/{candidate_id}/explanation",
    response_model=SimilarityExplanation,
)
def explain(
    run_id: str,
    candidate_id: str,
    engine: PandasSimilarityEngine = Depends(get_similarity_engine),
) -> SimilarityExplanation:
    try:
        return engine.explain(run_id, candidate_id)
    except SimilarityRunNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
    except SimilarityCandidateNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
