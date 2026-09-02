"""Request/response schemas for the backtest HTTP boundary (T-1014-6).

`BacktestStartRequest` reuses `domain.models.backtest.BacktestRequest`
directly (same relationship api/schemas/similarity.py has to
`domain.models.similarity` entities it returns unmodified) -- the start
endpoint's body IS a BacktestRequest, nothing this route layer needs to
reshape. `MatchFrequencyPointWire`/`BacktestResultPage` exist because
paging `match_frequency` (the field that can grow large over a long
daily-rebalance range, AC9) is this route layer's own concern, not the
engine's -- mirrors SimilarityRunPage's "paginate only the field that can
be large" precedent exactly.
"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel

from application.backtest_jobs import BacktestStatus
from domain.models.backtest import (
    BacktestProvenance,
    BacktestRequest,
    BacktestWarning,
    DrawdownStats,
    ForwardReturnDistribution,
    MatchFrequencyPoint,
    RebalanceFrequency,
    SurvivorshipAssumption,
)
from domain.models.screener import UniverseSpec

BacktestStartRequest = BacktestRequest


class BacktestStartResponse(BaseModel):
    backtest_id: str
    status: BacktestStatus


class BacktestProgress(BaseModel):
    started_at: datetime
    elapsed_seconds: float
    message: str


class MatchFrequencyPointWire(MatchFrequencyPoint):
    """One rebalance date's point, plus the stable per-page id AC9 asks
    for. Derived from the point's own date and position, never a fresh
    mint -- the same page re-read returns the same ids every time."""

    id: str


class BacktestResultPage(BaseModel):
    """`BacktestResult`'s fields, with `match_frequency` sliced to one page
    and its own total/offset/next_offset -- every other field is small and
    returned in full on every read."""

    screener_id: str
    revision: int
    universe: UniverseSpec
    from_date_requested: date
    to_date_requested: date
    from_date_covered: date
    to_date_covered: date
    horizons: list[int]
    rebalance: RebalanceFrequency
    match_count_total: int
    match_frequency: list[MatchFrequencyPointWire]
    match_frequency_total: int
    match_frequency_offset: int
    match_frequency_next_offset: int | None
    forward_returns: list[ForwardReturnDistribution]
    drawdown: DrawdownStats
    survivorship: SurvivorshipAssumption
    provenance: BacktestProvenance
    warnings: list[BacktestWarning]


class BacktestResultsResponse(BaseModel):
    """The one shape `GET /api/backtests/{id}` always returns -- `status`
    says which of `progress`/`error`/`result` is populated (AC6, AC7): a
    still-running backtest never carries a `result`, so a caller cannot
    mistake progress for a final answer."""

    backtest_id: str
    status: BacktestStatus
    progress: BacktestProgress | None = None
    error: str | None = None
    result: BacktestResultPage | None = None
