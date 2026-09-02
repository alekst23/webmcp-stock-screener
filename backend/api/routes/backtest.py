"""T-1014-6's HTTP boundary between T-1014-5's Python backtest engine and
the browser-side WebMCP tools (`backtest_screener`/`get_backtest_results`):
start an evaluation and return a stable id immediately, and read a job's
stored status/results back without ever re-executing it.

Deliberately thin, mirroring api/routes/similarity.py: request validation,
async job orchestration, error mapping, pagination. All backtest math stays
in domain.backtest_engine.PortBacktestEngine (T-1014-5); this file never
computes a statistic.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, Request

from api.schemas.backtest import (
    BacktestProgress,
    BacktestResultPage,
    BacktestResultsResponse,
    BacktestStartRequest,
    BacktestStartResponse,
    MatchFrequencyPointWire,
)
from application.backtest_jobs import BacktestJob, BacktestJobNotAvailable, BacktestJobStore
from domain.contracts.backtest_engine import BacktestEngine
from domain.models.backtest import BacktestResult

router = APIRouter(prefix="/api/backtests", tags=["backtest"])

_NO_ENGINE = (
    "No price panel is loaded, so there is nothing to backtest against. The panel could "
    "not be read from object storage and no local mock panel exists. From "
    "backend/, run `uv run python scripts/generate_mock_panel.py` first."
)

_DEFAULT_PAGE_LIMIT = 50

# Background executions this process is holding a reference to, keyed by
# backtest_id -- required so a fire-and-forget asyncio.Task is never
# garbage-collected mid-flight (a well-known asyncio footgun), and cleaned
# up once the task resolves.
_running_tasks: dict[str, asyncio.Task[None]] = {}


def get_backtest_engine(request: Request) -> BacktestEngine:
    engine = getattr(request.app.state, "backtest_engine", None)
    if engine is None:
        raise HTTPException(status_code=503, detail=_NO_ENGINE)
    return cast(BacktestEngine, engine)


def get_backtest_job_store(request: Request) -> BacktestJobStore:
    store = getattr(request.app.state, "backtest_jobs", None)
    if not isinstance(store, BacktestJobStore):
        raise HTTPException(status_code=503, detail=_NO_ENGINE)
    return store


async def _execute(engine: BacktestEngine, jobs: BacktestJobStore, backtest_id: str) -> None:
    job = jobs.get(backtest_id)
    if isinstance(job, BacktestJobNotAvailable):  # pragma: no cover -- defensive, cannot happen
        return
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, engine.run, job.request)
    except (
        Exception
    ) as exc:  # noqa: BLE001 -- any engine failure resolves the job, never crashes silently
        jobs.fail(backtest_id, str(exc))
    else:
        jobs.complete(backtest_id, result)
    finally:
        _running_tasks.pop(backtest_id, None)


@router.post("", response_model=BacktestStartResponse, status_code=202)
async def start_backtest(
    payload: BacktestStartRequest,
    engine: BacktestEngine = Depends(get_backtest_engine),
    jobs: BacktestJobStore = Depends(get_backtest_job_store),
) -> BacktestStartResponse:
    if not payload.horizons:
        raise HTTPException(
            status_code=422, detail={"message": "backtest_screener requires at least one horizon."}
        )
    job = jobs.create(payload)
    # Explicit asyncio.create_task, not FastAPI's BackgroundTasks: a
    # BackgroundTasks callback runs as part of this same request/response
    # ASGI cycle and would make "returns immediately without blocking on
    # the evaluation" (AC1) untrue under a single-worker server and
    # untestable under TestClient (its callback completes before the
    # client call returns). A bare create_task lets this handler return
    # now while the engine -- offloaded to a thread so it never blocks the
    # event loop other requests, including status polls, share -- runs
    # independently.
    _running_tasks[job.backtest_id] = asyncio.create_task(_execute(engine, jobs, job.backtest_id))
    return BacktestStartResponse(backtest_id=job.backtest_id, status=job.status)


def _progress(job: BacktestJob, now: datetime) -> BacktestProgress:
    elapsed = (now - job.started_at).total_seconds()
    return BacktestProgress(
        started_at=job.started_at,
        elapsed_seconds=max(elapsed, 0.0),
        message="Evaluation in progress.",
    )


def _wire_match_frequency(
    result: BacktestResult, offset: int, limit: int
) -> tuple[list[MatchFrequencyPointWire], int, int | None]:
    total = len(result.match_frequency)
    page = result.match_frequency[offset : offset + limit]
    wired = [
        MatchFrequencyPointWire(
            id=f"mf_{point.on_date.isoformat()}_{offset + i}", **point.model_dump()
        )
        for i, point in enumerate(page)
    ]
    next_offset = offset + len(page) if offset + len(page) < total else None
    return wired, total, next_offset


def _result_page(result: BacktestResult, offset: int, limit: int) -> BacktestResultPage:
    match_frequency, total, next_offset = _wire_match_frequency(result, offset, limit)
    return BacktestResultPage(
        screener_id=result.screener_id,
        revision=result.revision,
        universe=result.universe,
        from_date_requested=result.from_date_requested,
        to_date_requested=result.to_date_requested,
        from_date_covered=result.from_date_covered,
        to_date_covered=result.to_date_covered,
        horizons=result.horizons,
        rebalance=result.rebalance,
        match_count_total=result.match_count_total,
        match_frequency=match_frequency,
        match_frequency_total=total,
        match_frequency_offset=offset,
        match_frequency_next_offset=next_offset,
        forward_returns=result.forward_returns,
        drawdown=result.drawdown,
        survivorship=result.survivorship,
        provenance=result.provenance,
        warnings=result.warnings,
    )


@router.get("/{backtest_id}", response_model=BacktestResultsResponse)
def get_backtest_results(
    backtest_id: str,
    offset: int = 0,
    limit: int = _DEFAULT_PAGE_LIMIT,
    jobs: BacktestJobStore = Depends(get_backtest_job_store),
) -> BacktestResultsResponse:
    job = jobs.get(backtest_id)
    if isinstance(job, BacktestJobNotAvailable):
        # AC8: rejected saying so, never covered by starting an evaluation.
        raise HTTPException(status_code=404, detail={"message": job.message, "reason": job.reason})

    if job.status == "running":
        return BacktestResultsResponse(
            backtest_id=job.backtest_id,
            status="running",
            progress=_progress(job, datetime.now(timezone.utc)),
        )
    if job.status == "failed":
        return BacktestResultsResponse(
            backtest_id=job.backtest_id, status="failed", error=job.error or "Backtest failed."
        )
    assert (
        job.result is not None
    )  # status == "completed" always carries a result (jobs.complete's contract)
    return BacktestResultsResponse(
        backtest_id=job.backtest_id,
        status="completed",
        result=_result_page(job.result, offset, limit),
    )
