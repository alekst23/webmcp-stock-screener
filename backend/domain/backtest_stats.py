"""Pure statistics for the backtest engine (T-1014-5).

Stdlib only -- no pandas/numpy, matching every other domain/ module
(domain/universe_floor.py's "policy, no I/O" split). Ported from
infra/pandas_engine.py's `_summarize_returns`, whose forward-return/
hit-rate shape this mirrors, but computed with plain loops and the
`statistics` module instead of a DataFrame.
"""

from __future__ import annotations

import statistics
from datetime import date

from domain.models.backtest import DrawdownStats, ForwardReturnDistribution


def summarize_returns(returns: list[float], horizon_days: int) -> ForwardReturnDistribution:
    """Count/mean/median/hit-rate/best/worst over a set of forward
    returns. An empty `returns` list (no resolvable match, or a screener
    that matched nothing) yields a zero-count distribution rather than
    raising -- AC7's "zero-match result, not an error" applies here too."""
    if not returns:
        return ForwardReturnDistribution(
            horizon_days=horizon_days, count=0, mean=0.0, median=0.0, hit_rate=0.0
        )
    return ForwardReturnDistribution(
        horizon_days=horizon_days,
        count=len(returns),
        mean=statistics.fmean(returns),
        median=statistics.median(returns),
        hit_rate=sum(1 for r in returns if r > 0) / len(returns),
        best=max(returns),
        worst=min(returns),
    )


def max_drawdown(closes: list[float]) -> float:
    """The largest peak-to-trough decline over one price path, as a
    negative fraction (e.g. -0.25 for a 25% drawdown). 0.0 for a path with
    fewer than two points -- there is no trough to measure yet."""
    if len(closes) < 2:
        return 0.0
    peak = closes[0]
    worst = 0.0
    for price in closes[1:]:
        peak = max(peak, price)
        if peak <= 0:
            continue
        drawdown = (price - peak) / peak
        worst = min(worst, drawdown)
    return worst


def aggregate_drawdowns(per_instance_drawdowns: list[float]) -> DrawdownStats:
    """Summarizes each matched instance's own max drawdown (from
    `max_drawdown`) into the run-level statistic the result reports."""
    if not per_instance_drawdowns:
        return DrawdownStats(
            count=0, mean_max_drawdown=0.0, median_max_drawdown=0.0, worst_max_drawdown=0.0
        )
    return DrawdownStats(
        count=len(per_instance_drawdowns),
        mean_max_drawdown=statistics.fmean(per_instance_drawdowns),
        median_max_drawdown=statistics.median(per_instance_drawdowns),
        worst_max_drawdown=min(per_instance_drawdowns),
    )


def rebalance_dates(
    from_date: date, to_date: date, frequency: str, all_sessions: list[date]
) -> list[date]:
    """Filters `all_sessions` (already-known trading sessions within
    [from_date, to_date]) down to the evaluation schedule `frequency`
    names -- "daily" keeps every session, "weekly" keeps the last session
    seen in each ISO week, "monthly" keeps the last session seen in each
    calendar month. Deterministic and order-preserving: this is what makes
    the rebalance frequency on the result (AC8) match what the engine
    actually walked, not just a label."""
    in_range = [d for d in all_sessions if from_date <= d <= to_date]
    if frequency == "daily":
        return in_range
    if frequency not in ("weekly", "monthly"):
        raise ValueError(f"Unknown rebalance frequency: {frequency!r}")
    last_by_period: dict[tuple[int, int], date] = {}
    for day in in_range:
        period_key = _week_key(day) if frequency == "weekly" else _month_key(day)
        last_by_period[period_key] = day
    return sorted(last_by_period.values())


def _week_key(day: date) -> tuple[int, int]:
    iso_year, iso_week, _ = day.isocalendar()
    return (iso_year, iso_week)


def _month_key(day: date) -> tuple[int, int]:
    return (day.year, day.month)
