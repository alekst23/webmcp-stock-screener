"""Backtest request/result contract (T-1014-5).

Pure Pydantic models -- no I/O. `BacktestProvenance` wraps
`domain.models.similarity.MarketDataProvenance` (EPIC-1012) rather than
redefining AC3's as_of/source/liveness/timezone/currency/price-adjustment/
engine-version fields, adding only the one field that provenance has no
reason to carry: the fundamentals reporting period.
"""

from __future__ import annotations

from datetime import date
from enum import Enum

from pydantic import BaseModel, Field

from domain.models.screener import FilterNode, UniverseSpec
from domain.models.similarity import MarketDataProvenance

# Bumped whenever the statistics, lookahead, or survivorship rules in
# domain/backtest_engine.py, domain/backtest_stats.py, or domain/lookahead.py
# change -- provenance is decorative otherwise (ticket's Technical
# Considerations).
BACKTEST_ENGINE_VERSION = "1.0.0"


class RebalanceFrequency(str, Enum):
    """How often the universe is re-screened over the requested range.
    Explicit on every result (AC8) -- never an implementation detail the
    reader has to infer."""

    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class BacktestRequest(BaseModel):
    """Everything the engine needs: a screener revision to evaluate, the
    universe and range to evaluate it over, and one or more forward-return
    horizons. `screener_id`/`revision` are carried through to the result
    unchanged (pinned-to-a-revision, per spec.md's "Backtest a screener"
    scenario table) -- this ticket does not resolve them against a stored
    screener; that's T-1014-6's job."""

    screener_id: str
    revision: int
    filter_tree: FilterNode = Field(discriminator="kind")
    universe: UniverseSpec
    from_date: date
    to_date: date
    horizons: list[int]
    rebalance: RebalanceFrequency = RebalanceFrequency.WEEKLY


class MatchFrequencyPoint(BaseModel):
    """One rebalance date's match count against the universe evaluated
    that day."""

    on_date: date
    universe_size: int
    match_count: int

    @property
    def match_rate(self) -> float:
        return self.match_count / self.universe_size if self.universe_size else 0.0


class ForwardReturnDistribution(BaseModel):
    """The forward-return distribution for one horizon, across every
    resolved match (a match whose horizon-days-later bar exists in the
    fixture/source)."""

    horizon_days: int
    count: int
    mean: float
    median: float
    hit_rate: float
    best: float | None = None
    worst: float | None = None


class DrawdownStats(BaseModel):
    """Peak-to-trough drawdown statistics across every matched instance's
    own subsequent price path, up to the longest requested horizon."""

    count: int
    mean_max_drawdown: float
    median_max_drawdown: float
    worst_max_drawdown: float


class SurvivorshipAssumption(BaseModel):
    """States, in plain terms, whether delisted/merged/renamed instruments
    were included and what effect that has (AC2) -- built from the
    reference-data port's declared capability, not from whether any such
    event happens to appear in one particular run's fixture data."""

    includes_delisted: bool
    includes_merged: bool
    includes_renamed: bool
    delisting_events_in_range: int
    statement: str


class BacktestProvenance(BaseModel):
    """AC3's provenance envelope: `market_data` carries as_of/source/
    live-or-delayed/timezone/currency/price-adjustment/engine-version (all
    mandatory -- construction fails without them, matching T-1009-2 AC5's
    "a run cannot be constructed with provenance missing").
    `fundamentals_reporting_period` is set only when the evaluated filter
    tree actually used a fundamentals-class field."""

    market_data: MarketDataProvenance
    fundamentals_reporting_period: str | None = None


class BacktestWarning(BaseModel):
    """A machine-readable code plus a human-readable explanation -- never
    a bare string, so a caller can branch on `code` without parsing
    prose."""

    code: str
    message: str
    node_ids: list[str] = Field(default_factory=list)


class BacktestResult(BaseModel):
    """The engine's complete output: every field the ticket's ACs require
    is present unconditionally, even on a zero-match run (AC7) -- there is
    no "results" field that is simply absent when there is nothing to
    report."""

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
    match_frequency: list[MatchFrequencyPoint]
    forward_returns: list[ForwardReturnDistribution]
    drawdown: DrawdownStats
    survivorship: SurvivorshipAssumption
    provenance: BacktestProvenance
    warnings: list[BacktestWarning] = Field(default_factory=list)
