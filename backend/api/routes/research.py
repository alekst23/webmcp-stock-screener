"""T-0001-5's 5 real networked WebMCP tool endpoints: findInstances,
sampleInstances, measure, splitInstances, and showGrid (which wraps
get_instance_windows -- see
docs/plan/EPIC-0001/T-0001-5-webmcp-integration.md's endpoint-to-tool
mapping). defineStudy/defineSetup/getWorkspace/focusInstance are NOT here --
those 4 tools run purely client-side (docs/plan.md's "Sessions" section).

Stateless per request: the single shared PandasPatternResearchEngine
(constructed once at app startup, see main.py) still needs its named-study
registry populated before evaluating an expression that references one, so
requests that can reference a study (find-instances, split-instances in
condition mode) replay any currently-known studies into it first --
define_study is idempotent per name, so replaying on every request is safe.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request

from api.schemas.research import (
    FindInstancesRequest,
    InstanceWindowsRequest,
    MeasureRequest,
    SampleInstancesRequest,
    SplitInstancesRequest,
)
from domain.errors import ExpressionError
from domain.models.instance import Instance, InstanceSet
from domain.models.measurement import InstanceWindow, MeasureResult
from domain.models.panel import PanelStatus
from domain.models.pattern import Study
from domain.panel_disclosure import disclose
from infra.pandas_engine import PandasPatternResearchEngine

router = APIRouter(prefix="/api/research", tags=["research"])

# Names the panel as the cause rather than reporting a generic outage: a
# request that fails because there is no price data is a different problem
# from one that fails because the service is broken (T-1016-5 AC4).
_NO_PANEL = (
    "No price panel is loaded, so there is nothing to search. The panel could "
    "not be read from object storage and no local mock panel exists. From "
    "backend/, run `uv run python scripts/generate_mock_panel.py` first."
)


def get_engine(request: Request) -> PandasPatternResearchEngine:
    """Resolves the engine built at startup (main.py's lifespan). A 503 here
    means the mock panel hasn't been generated -- mirrors the spike
    endpoint's own guard (api/routes/spike.py)."""
    engine = getattr(request.app.state, "engine", None)
    if not isinstance(engine, PandasPatternResearchEngine):
        raise HTTPException(status_code=503, detail=_NO_PANEL)
    return engine


@router.get("/panel", response_model=PanelStatus)
def panel(request: Request) -> PanelStatus:
    """The loaded panel's provenance (T-0001-9 AC4).

    A GET rather than a field on getWorkspace: getWorkspace runs purely
    client-side and never touches the network (docs/plan.md's "Sessions"
    section), so it has nothing to report about server-side data. The
    frontend fetches this and renders the as-of date, so a result is never
    presented as more current than the panel behind it.

    Degradation is computed here, per request, rather than stored at load:
    that is what lets a stale panel stop being reported as stale the moment
    the nightly delta catches up, without a restart (T-1016-5 AC5).
    """
    status = getattr(request.app.state, "panel_status", None)
    if not isinstance(status, PanelStatus):
        raise HTTPException(status_code=503, detail=_NO_PANEL)
    return disclose(status, today=date.today())


def _register_studies(engine: PandasPatternResearchEngine, studies: list[Study]) -> None:
    for study in studies:
        engine.define_study(study.name, study.expression)


def _expression_error(exc: ExpressionError) -> HTTPException:
    # Carries the function catalog back to the agent -- AC3's self-correcting
    # error behavior, same contract ExpressionError itself carries.
    return HTTPException(status_code=422, detail={"message": str(exc), "catalog": exc.catalog})


@router.post("/find-instances", response_model=InstanceSet)
def find_instances(
    payload: FindInstancesRequest,
    engine: PandasPatternResearchEngine = Depends(get_engine),
) -> InstanceSet:
    _register_studies(engine, payload.studies)
    try:
        return engine.find_instances(
            payload.setup,
            from_date=payload.from_date,
            to_date=payload.to_date,
            min_market_cap=payload.min_market_cap,
            sectors=payload.sectors,
        )
    except ExpressionError as exc:
        raise _expression_error(exc) from exc


@router.post("/sample-instances", response_model=list[Instance])
def sample_instances(
    payload: SampleInstancesRequest,
    engine: PandasPatternResearchEngine = Depends(get_engine),
) -> list[Instance]:
    try:
        return engine.sample_instances(
            payload.instance_set,
            n=payload.n,
            strategy=payload.strategy,
            horizon_days=payload.horizon_days,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/measure", response_model=MeasureResult)
def measure(
    payload: MeasureRequest,
    engine: PandasPatternResearchEngine = Depends(get_engine),
) -> MeasureResult:
    return engine.measure(
        payload.instance_set,
        horizon_days=payload.horizon_days,
        metric=payload.metric,
        compare_to_base_rate=payload.compare_to_base_rate,
    )


@router.post("/split-instances", response_model=list[InstanceSet])
def split_instances(
    payload: SplitInstancesRequest,
    engine: PandasPatternResearchEngine = Depends(get_engine),
) -> list[InstanceSet]:
    _register_studies(engine, payload.studies)
    try:
        return engine.split_instances(
            payload.instance_set,
            mode=payload.mode,
            expression=payload.expression,
            horizon_days=payload.horizon_days,
            threshold=payload.threshold,
        )
    except ExpressionError as exc:
        raise _expression_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/instance-windows", response_model=list[InstanceWindow])
def instance_windows(
    payload: InstanceWindowsRequest,
    engine: PandasPatternResearchEngine = Depends(get_engine),
) -> list[InstanceWindow]:
    return engine.get_instance_windows(
        payload.instance_set,
        n=payload.n,
        strategy=payload.strategy,
        window=payload.window,
    )
