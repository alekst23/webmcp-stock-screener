"""The backtest evaluation engine (T-1014-5): `PortBacktestEngine`.

Implements `domain.contracts.backtest_engine.BacktestEngine`. Lives in
`domain/`, not `infra/` -- a deliberate deviation from the
Protocol-in-domain/impl-in-infra split `PatternResearchEngine`/
`PandasPatternResearchEngine` and `SimilarityEngine`/`PandasSimilarityEngine`
use, documented in the ticket's Solution Approach: this class needs no
concrete infra library (no pandas/numpy, no `from infra...` import
anywhere) -- it only calls the three market-data Protocols it depends on
and does its own arithmetic with the standard library, so it belongs where
`domain/universe_floor.py`'s "policy, no I/O" split already lives. AC11's
"no infrastructure imports" is true of this file by construction, not by
convention.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import date, timedelta

from domain.backtest_stats import (
    aggregate_drawdowns,
    max_drawdown,
    rebalance_dates,
    summarize_returns,
)
from domain.contracts.market_data import FundamentalsPort, PriceSeriesPort, ReferenceDataPort
from domain.errors import InsufficientHistoryError
from domain.filter_evaluation import (
    FieldParams,
    FieldResolver,
    evaluate_node,
    find_unevaluable_conditions,
)
from domain.lookahead import LOOKAHEAD_FUNDAMENTAL_FIELD, classify_tree
from domain.models.backtest import (
    BACKTEST_ENGINE_VERSION,
    BacktestProvenance,
    BacktestRequest,
    BacktestResult,
    BacktestWarning,
    DrawdownStats,
    ForwardReturnDistribution,
    MatchFrequencyPoint,
    SurvivorshipAssumption,
)
from domain.models.price import PriceBar
from domain.models.screener import FieldClass, SeriesRef
from domain.trading_calendar import sessions_between

# Bounds enforced before any date is walked (Technical Considerations:
# "bound the work and report the bound rather than running unbounded").
MAX_RANGE_SESSIONS = 750  # roughly three years of trading sessions
MAX_UNIVERSE_SIZE = 500
MAX_MATCH_INSTANCES_FOR_RETURNS = 2000

COVERAGE_TRUNCATED = "coverage_truncated"
UNIVERSE_TRUNCATED = "universe_truncated"
MATCHES_SAMPLED = "match_instances_sampled"
FUNDAMENTALS_POINT_IN_TIME_UNSUPPORTED = "fundamentals_point_in_time_unsupported"
CONDITION_NOT_EVALUABLE = "condition_not_evaluable"


@dataclass
class _RunState:
    """Accumulates cross-cutting facts collected while walking the run, so
    the final assembly step (provenance, survivorship) reads them rather
    than re-deriving them from scratch."""

    fiscal_periods_used: set[str] = field(default_factory=set)
    fundamentals_used: bool = False
    bar_cache: dict[str, list[PriceBar]] = field(default_factory=dict)


class PortBacktestEngine:
    """Evaluates a screener definition against history using only the
    three market-data ports (AC9) -- no provider-specific access, no data
    pipeline of its own."""

    def __init__(
        self,
        price_port: PriceSeriesPort,
        fundamentals_port: FundamentalsPort,
        reference_port: ReferenceDataPort,
    ) -> None:
        self._price = price_port
        self._fundamentals = fundamentals_port
        self._reference = reference_port

    def run(self, request: BacktestRequest) -> BacktestResult:
        state = _RunState()
        warnings: list[BacktestWarning] = []

        covered_from, covered_to, sessions = self._bounded_range(
            request.from_date, request.to_date, request.horizons, warnings
        )
        warnings.extend(self._lookahead_warnings(request))
        warnings.extend(self._unevaluable_condition_warnings(request))

        schedule = rebalance_dates(covered_from, covered_to, request.rebalance.value, sessions)
        resolver = self._build_resolver(state)
        match_frequency, matches = self._walk_matches(request, schedule, resolver, warnings)

        forward_returns = [
            summarize_returns(self._forward_returns(matches, horizon, state), horizon)
            for horizon in request.horizons
        ]
        drawdown = aggregate_drawdowns(self._drawdowns(matches, request.horizons, state))
        survivorship = self._survivorship(covered_from, covered_to)
        provenance = self._provenance(state)

        return self._assemble_result(
            request,
            covered_from,
            covered_to,
            match_frequency,
            forward_returns,
            drawdown,
            survivorship,
            provenance,
            warnings,
        )

    def _unevaluable_condition_warnings(self, request: BacktestRequest) -> list[BacktestWarning]:
        unevaluable = find_unevaluable_conditions(request.filter_tree)
        if not unevaluable:
            return []
        return [
            BacktestWarning(
                code=CONDITION_NOT_EVALUABLE,
                message=(
                    "One or more conditions reference chart-pattern recognition, custom "
                    "study output, or a peer-group/index baseline -- none of which this "
                    "engine can evaluate through the available data ports. These conditions "
                    "were treated as never matching (fail closed)."
                ),
                node_ids=unevaluable,
            )
        ]

    def _assemble_result(
        self,
        request: BacktestRequest,
        covered_from: date,
        covered_to: date,
        match_frequency: list[MatchFrequencyPoint],
        forward_returns: list[ForwardReturnDistribution],
        drawdown: DrawdownStats,
        survivorship: SurvivorshipAssumption,
        provenance: BacktestProvenance,
        warnings: list[BacktestWarning],
    ) -> BacktestResult:
        return BacktestResult(
            screener_id=request.screener_id,
            revision=request.revision,
            universe=request.universe,
            from_date_requested=request.from_date,
            to_date_requested=request.to_date,
            from_date_covered=covered_from,
            to_date_covered=covered_to,
            horizons=request.horizons,
            rebalance=request.rebalance,
            match_count_total=sum(point.match_count for point in match_frequency),
            match_frequency=match_frequency,
            forward_returns=forward_returns,
            drawdown=drawdown,
            survivorship=survivorship,
            provenance=provenance,
            warnings=warnings,
        )

    # ---- Bounding and coverage (AC6) ----

    def _bounded_range(
        self, from_date: date, to_date: date, horizons: list[int], warnings: list[BacktestWarning]
    ) -> tuple[date, date, list[date]]:
        all_sessions = sessions_between(from_date - timedelta(days=1), to_date)
        required = max(horizons) + 1
        if len(all_sessions) < required:
            raise InsufficientHistoryError(
                f"The range {from_date} to {to_date} has {len(all_sessions)} trading "
                f"session(s), fewer than the {required} needed for the longest requested "
                f"horizon ({max(horizons)} days).",
                available_sessions=len(all_sessions),
                required_sessions=required,
            )
        if len(all_sessions) <= MAX_RANGE_SESSIONS:
            return from_date, to_date, all_sessions
        bounded = all_sessions[-MAX_RANGE_SESSIONS:]
        warnings.append(
            BacktestWarning(
                code=COVERAGE_TRUNCATED,
                message=(
                    f"Requested range covers {len(all_sessions)} trading sessions; this "
                    f"engine bounds a single run to {MAX_RANGE_SESSIONS}. Evaluated only "
                    f"{bounded[0]} through {bounded[-1]}."
                ),
            )
        )
        return bounded[0], bounded[-1], bounded

    # ---- Lookahead (AC4/AC5) ----

    def _lookahead_warnings(self, request: BacktestRequest) -> list[BacktestWarning]:
        report = classify_tree(request.filter_tree, self._field_class_of)
        warnings = [
            BacktestWarning(code=finding.code, message=finding.handling, node_ids=[finding.node_id])
            for finding in report.findings
        ]
        has_fundamental_finding = any(
            f.code == LOOKAHEAD_FUNDAMENTAL_FIELD for f in report.findings
        )
        if has_fundamental_finding and not self._fundamentals.supports_point_in_time():
            warnings.append(
                BacktestWarning(
                    code=FUNDAMENTALS_POINT_IN_TIME_UNSUPPORTED,
                    message=(
                        "The fundamentals source cannot confirm what was known as of each "
                        "historical decision date; fundamentals-based conditions were "
                        "evaluated against its latest-known values, which may reflect "
                        "later restatements."
                    ),
                )
            )
        return warnings

    def _field_class_of(self, field_id: str) -> FieldClass:
        if field_id in self._fundamentals.field_ids():
            return FieldClass.FUNDAMENTAL
        return FieldClass.PRICE

    # ---- Universe walk (AC1, AC2, AC7, AC8) ----

    def _walk_matches(
        self,
        request: BacktestRequest,
        schedule: list[date],
        resolver: FieldResolver,
        warnings: list[BacktestWarning],
    ) -> tuple[list[MatchFrequencyPoint], list[tuple[str, date]]]:
        match_frequency: list[MatchFrequencyPoint] = []
        matches: list[tuple[str, date]] = []
        universe_ever_truncated = False
        for on_date in schedule:
            members = self._reference.get_universe_members(on_date, request.universe)
            members = sorted(set(members) - set(request.universe.excluded_tickers))
            if len(members) > MAX_UNIVERSE_SIZE:
                members = members[:MAX_UNIVERSE_SIZE]
                universe_ever_truncated = True
            matched = [
                ticker
                for ticker in members
                if evaluate_node(request.filter_tree, ticker, on_date, resolver)
            ]
            match_frequency.append(
                MatchFrequencyPoint(
                    on_date=on_date, universe_size=len(members), match_count=len(matched)
                )
            )
            matches.extend((ticker, on_date) for ticker in matched)
        if universe_ever_truncated:
            warnings.append(
                BacktestWarning(
                    code=UNIVERSE_TRUNCATED,
                    message=(
                        f"The universe exceeded {MAX_UNIVERSE_SIZE} instruments on at least "
                        f"one rebalance date; evaluation was bounded to the first "
                        f"{MAX_UNIVERSE_SIZE} (by ticker) on those dates."
                    ),
                )
            )
        matches.sort(key=lambda pair: (pair[1], pair[0]))
        return match_frequency, self._bounded_matches(matches, warnings)

    def _bounded_matches(
        self, matches: list[tuple[str, date]], warnings: list[BacktestWarning]
    ) -> list[tuple[str, date]]:
        if len(matches) <= MAX_MATCH_INSTANCES_FOR_RETURNS:
            return matches
        stride = len(matches) / MAX_MATCH_INSTANCES_FOR_RETURNS
        sampled = [matches[int(i * stride)] for i in range(MAX_MATCH_INSTANCES_FOR_RETURNS)]
        warnings.append(
            BacktestWarning(
                code=MATCHES_SAMPLED,
                message=(
                    f"{len(matches)} match instances were found; forward-return and "
                    f"drawdown statistics were computed from an evenly-spaced sample of "
                    f"{len(sampled)} rather than every instance."
                ),
            )
        )
        return sampled

    # ---- Field resolution wiring ----

    def _build_resolver(self, state: _RunState) -> FieldResolver:
        """Thin wiring only -- each closure just forwards to a private
        method, so the routing logic itself (fundamentals vs. price,
        point-in-time bookkeeping) stays independently readable and
        testable rather than living inside a nest of closures."""
        return FieldResolver(
            value_at=lambda ticker, catalog_id, params, as_of: self._value_at(
                ticker, catalog_id, params, as_of, state
            ),
            average_at=lambda ticker, catalog_id, params, as_of, window_bars: self._average_at(
                ticker, catalog_id, params, as_of, window_bars
            ),
            event_occurred=self._event_occurred,
            recent_sessions=lambda ticker, as_of, n: self._recent_sessions(ticker, as_of, n, state),
        )

    def _value_at(
        self, ticker: str, catalog_id: str, params: FieldParams, as_of: date, state: _RunState
    ) -> float | None:
        if catalog_id in self._fundamentals.field_ids():
            reported = self._fundamentals.get_reported_value(ticker, catalog_id, as_of)
            if reported is None:
                return None
            state.fundamentals_used = True
            state.fiscal_periods_used.add(reported.fiscal_period)
            return reported.value
        ref = SeriesRef(catalog_id=catalog_id, params=params)
        observed = self._price.get_series(ticker, ref, as_of, as_of)
        return observed[-1].value if observed else None

    def _average_at(
        self, ticker: str, catalog_id: str, params: FieldParams, as_of: date, window_bars: int
    ) -> float | None:
        ref = SeriesRef(catalog_id=catalog_id, params=params)
        lookback_start = as_of - timedelta(days=window_bars * 3 + 10)
        observed = [
            o.value
            for o in self._price.get_series(ticker, ref, lookback_start, as_of)
            if o.on_date <= as_of
        ][-window_bars:]
        return statistics.fmean(observed) if len(observed) == window_bars else None

    def _recent_sessions(self, ticker: str, as_of: date, n: int, state: _RunState) -> list[date]:
        bars = self._bars(ticker, as_of - timedelta(days=n * 3 + 10), as_of, state)
        return [b.date for b in bars if b.date <= as_of][-n:]

    def _event_occurred(
        self, ticker: str, event_type_id: str, as_of: date, direction: str, window_days: int
    ) -> bool | None:
        if direction == "past":
            window_start = as_of - timedelta(days=window_days)
            occurrences = self._reference.get_event_occurrences(
                ticker, event_type_id, window_start, as_of
            )
            return any(occurrence.event_date <= as_of for occurrence in occurrences)
        window_end = as_of + timedelta(days=window_days)
        occurrences = self._reference.get_event_occurrences(
            ticker, event_type_id, as_of, window_end
        )
        # The explicit lag AC4 requires: a scheduled future occurrence only
        # counts once it was already publicly known as of the decision date.
        return any(
            occurrence.event_date > as_of and occurrence.known_as_of <= as_of
            for occurrence in occurrences
        )

    # ---- Forward returns and drawdown ----

    def _bars(
        self, ticker: str, from_date: date, to_date: date, state: _RunState
    ) -> list[PriceBar]:
        key = f"{ticker}:{from_date.isoformat()}:{to_date.isoformat()}"
        if key not in state.bar_cache:
            state.bar_cache[key] = sorted(
                self._price.get_bars(ticker, from_date, to_date), key=lambda b: b.date
            )
        return state.bar_cache[key]

    def _forward_returns(
        self, matches: list[tuple[str, date]], horizon_days: int, state: _RunState
    ) -> list[float]:
        returns: list[float] = []
        for ticker, on_date in matches:
            bars = self._bars(
                ticker,
                on_date - timedelta(days=5),
                on_date + timedelta(days=horizon_days * 3 + 10),
                state,
            )
            value = _forward_return(bars, on_date, horizon_days)
            if value is not None:
                returns.append(value)
        return returns

    def _drawdowns(
        self, matches: list[tuple[str, date]], horizons: list[int], state: _RunState
    ) -> list[float]:
        span = max(horizons)
        results: list[float] = []
        for ticker, on_date in matches:
            bars = self._bars(
                ticker, on_date - timedelta(days=5), on_date + timedelta(days=span * 3 + 10), state
            )
            closes = _path_closes(bars, on_date, span)
            if closes:
                results.append(max_drawdown(closes))
        return results

    # ---- Survivorship and provenance ----

    def _survivorship(self, from_date: date, to_date: date) -> SurvivorshipAssumption:
        includes_delisted = self._reference.includes_delisted()
        includes_merged = self._reference.includes_merged()
        includes_renamed = self._reference.includes_renamed()
        events = self._reference.get_delisting_events(from_date, to_date)
        included = [
            name
            for name, flag in (
                ("delisted", includes_delisted),
                ("merged", includes_merged),
                ("renamed", includes_renamed),
            )
            if flag
        ]
        if included:
            statement = (
                f"This universe source includes {', '.join(included)} instruments. "
                f"{len(events)} such corporate action(s) occurred in the evaluated range, "
                "so matched instruments that were later delisted, merged, or renamed keep "
                "their full historical outcome in these results."
            )
        else:
            statement = (
                "This universe source does not include delisted, merged, or renamed "
                "instruments. These results only reflect instruments that still exist in "
                "their present form, which is survivorship bias and can overstate "
                "historical performance."
            )
        return SurvivorshipAssumption(
            includes_delisted=includes_delisted,
            includes_merged=includes_merged,
            includes_renamed=includes_renamed,
            delisting_events_in_range=len(events),
            statement=statement,
        )

    def _provenance(self, state: _RunState) -> BacktestProvenance:
        market_data = self._price.provenance().model_copy(
            update={"engine_version": BACKTEST_ENGINE_VERSION}
        )
        fiscal_period = None
        if state.fundamentals_used and state.fiscal_periods_used:
            fiscal_period = ", ".join(sorted(state.fiscal_periods_used))
        return BacktestProvenance(
            market_data=market_data, fundamentals_reporting_period=fiscal_period
        )


def _forward_return(bars: list[PriceBar], on_date: date, horizon_days: int) -> float | None:
    anchor = next((i for i, bar in enumerate(bars) if bar.date == on_date), None)
    if anchor is None:
        return None
    target = anchor + horizon_days
    if target >= len(bars):
        return None
    start_close = bars[anchor].close
    if start_close == 0:
        return None
    return (bars[target].close - start_close) / start_close


def _path_closes(bars: list[PriceBar], on_date: date, span_days: int) -> list[float]:
    anchor = next((i for i, bar in enumerate(bars) if bar.date == on_date), None)
    if anchor is None:
        return []
    end = min(anchor + span_days + 1, len(bars))
    return [bar.close for bar in bars[anchor:end]]
