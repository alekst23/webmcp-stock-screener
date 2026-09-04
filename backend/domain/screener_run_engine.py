"""The screener-run evaluation engine (T-0025-2): `PortScreenerRunEngine`.

Wires T-0025-1's field/universe resolution and the existing filter-tree
evaluator (`domain/filter_evaluation.py`, unmodified by this ticket) into
one stateless run. Mirrors `domain/backtest_engine.py`'s
`PortBacktestEngine` wiring pattern (`_build_resolver`/`_value_at`) almost
verbatim -- a single `as_of` snapshot instead of a rebalance-date walk,
since a screener run evaluates the panel's current state once, not a
history.

No `FundamentalsPort` dependency: fundamentals-based fields are explicitly
out of this epic's scope (T-0025-2's Out of Scope) and no Python source
exists for them (`infra.panel_market_data.NoFundamentalsPort`'s own
honesty). Every field this engine resolves routes through the price port.
"""

from __future__ import annotations

import statistics
from datetime import date, timedelta
from typing import Callable

from domain.contracts.market_data import PriceSeriesPort, ReferenceDataPort, SectorCatalog
from domain.filter_evaluation import (
    FieldParams,
    FieldResolver,
    evaluate_condition,
    evaluate_node,
    find_unevaluable_conditions,
)
from domain.models.screener import (
    ConditionNode,
    FilterNode,
    GroupNode,
    RangeCondition,
    RelativeCondition,
    ScalarCondition,
    SeriesRef,
    UniverseSpec,
)
from domain.models.screener_run import (
    PROBLEM_CONDITION_NOT_EVALUABLE,
    PROBLEM_EMPTY_UNIVERSE,
    PROBLEM_UNRECOGNIZED_VALUE,
    SCREENER_ENGINE_VERSION,
    FilterNodeEvaluation,
    RankingSpec,
    ScreenerMatch,
    ScreenerRunRequest,
    ScreenerRunResult,
    ValidationProblem,
)
from domain.models.similarity import InstrumentRef


class PortScreenerRunEngine:
    """Narrows a universe, resolves fields, evaluates the filter tree,
    ranks, and returns a bounded result set (T-0025-2 AC1) -- or refuses,
    naming why, without ever raising (AC3, AC7)."""

    def __init__(
        self,
        price_port: PriceSeriesPort,
        reference_port: ReferenceDataPort,
        sector_catalog: SectorCatalog,
    ) -> None:
        self._price = price_port
        self._reference = reference_port
        self._sectors = sector_catalog

    def run(self, request: ScreenerRunRequest) -> ScreenerRunResult:
        as_of = self._price.provenance().as_of.date()
        members = self._reference.get_universe_members(as_of, request.universe)
        blocking, advisory = self._validate(request, members)
        if blocking:
            return ScreenerRunResult(
                status="refused",
                as_of=as_of,
                universe_count=len(members),
                problems=blocking + advisory,
            )
        if request.dry_run:
            return ScreenerRunResult(
                status="valid", as_of=as_of, universe_count=len(members), problems=advisory
            )
        return self._execute(request, as_of, members, advisory)

    # ---- Validation (AC2, AC3) ----

    def _validate(
        self, request: ScreenerRunRequest, members: list[str]
    ) -> tuple[list[ValidationProblem], list[ValidationProblem]]:
        blocking: list[ValidationProblem] = []
        if not members:
            blocking.append(
                ValidationProblem(
                    severity="blocking",
                    code=PROBLEM_EMPTY_UNIVERSE,
                    message=(
                        "The universe resolves to zero instruments after narrowing; "
                        "there is nothing to evaluate."
                    ),
                    universe_criteria=_named_criteria(request.universe),
                )
            )
        if request.universe.sectors:
            unrecognized = self._sectors.unrecognized_sectors(request.universe.sectors)
            if unrecognized:
                blocking.append(
                    ValidationProblem(
                        severity="blocking",
                        code=PROBLEM_UNRECOGNIZED_VALUE,
                        message=f"Unrecognized sector value(s): {', '.join(unrecognized)}.",
                        universe_criteria=unrecognized,
                    )
                )
        return blocking, self._unevaluable_advisories(request.filter_tree)

    @staticmethod
    def _unevaluable_advisories(filter_tree: FilterNode) -> list[ValidationProblem]:
        node_ids = find_unevaluable_conditions(filter_tree)
        if not node_ids:
            return []
        return [
            ValidationProblem(
                severity="advisory",
                code=PROBLEM_CONDITION_NOT_EVALUABLE,
                message=(
                    "One or more conditions reference chart-pattern recognition, custom "
                    "study output, or a peer-group/index baseline -- none of which this "
                    "engine can evaluate through the available data ports. These "
                    "conditions were treated as never matching (fail closed)."
                ),
                node_ids=node_ids,
            )
        ]

    # ---- Execution (AC1, AC4, AC5) ----

    def _execute(
        self,
        request: ScreenerRunRequest,
        as_of: date,
        members: list[str],
        advisory: list[ValidationProblem],
    ) -> ScreenerRunResult:
        resolver = self._build_resolver()
        matched = [
            ticker
            for ticker in members
            if evaluate_node(request.filter_tree, ticker, as_of, resolver)
        ]
        matches = self._rank(matched, request.filter_tree, request.ranking, as_of, resolver)
        limit = max(request.limit, 0)
        returned = matches[:limit]
        provenance = self._price.provenance().model_copy(
            update={"engine_version": SCREENER_ENGINE_VERSION}
        )
        return ScreenerRunResult(
            status="complete",
            as_of=as_of,
            universe_count=len(members),
            matched_count=len(matched),
            returned_count=len(returned),
            truncated=len(returned) < len(matched),
            ranking_applied=bool(request.ranking and request.ranking.fields),
            matches=returned,
            problems=advisory,
            provenance=provenance,
        )

    # ---- Ranking (spec.md's percentile-rank normalization assumption) ----

    def _rank(
        self,
        tickers: list[str],
        filter_tree: FilterNode,
        ranking: RankingSpec | None,
        as_of: date,
        resolver: FieldResolver,
    ) -> list[ScreenerMatch]:
        node_evaluations = {t: self._explain(filter_tree, t, as_of, resolver) for t in tickers}
        if ranking is None or not ranking.fields:
            # spec.md's "no ranking" default: documented, deterministic order.
            ordered = sorted(tickers)
            return [
                ScreenerMatch(
                    instrument=_instrument_ref(t),
                    rank=i + 1,
                    composite_score=0.0,
                    node_evaluations=node_evaluations[t],
                )
                for i, t in enumerate(ordered)
            ]
        values = {
            field.field_id: {t: resolver.value_at(t, field.field_id, {}, as_of) for t in tickers}
            for field in ranking.fields
        }
        scores = _composite_scores(tickers, ranking, values)
        ordered = sorted(tickers, key=lambda t: (-scores[t], t))
        return [
            ScreenerMatch(
                instrument=_instrument_ref(t),
                rank=i + 1,
                composite_score=scores[t],
                ranking_values={
                    field.field_id: values[field.field_id][t] for field in ranking.fields
                },
                node_evaluations=node_evaluations[t],
            )
            for i, t in enumerate(ordered)
        ]

    # ---- Per-node explanation (technical.md's "explain_result is a lookup") ----

    def _explain(
        self, node: FilterNode, ticker: str, as_of: date, resolver: FieldResolver
    ) -> dict[str, FilterNodeEvaluation]:
        out: dict[str, FilterNodeEvaluation] = {}
        self._explain_node(node, ticker, as_of, resolver, out)
        return out

    def _explain_node(
        self,
        node: FilterNode,
        ticker: str,
        as_of: date,
        resolver: FieldResolver,
        out: dict[str, FilterNodeEvaluation],
    ) -> None:
        if not node.enabled:
            return
        if isinstance(node, GroupNode):
            out[node.node_id] = FilterNodeEvaluation(
                node_id=node.node_id, passed=evaluate_node(node, ticker, as_of, resolver)
            )
            for child in node.children:
                self._explain_node(child, ticker, as_of, resolver, out)
            return
        result = evaluate_condition(node.condition, ticker, as_of, resolver)
        out[node.node_id] = FilterNodeEvaluation(
            node_id=node.node_id,
            passed=bool(result),
            value=_leaf_value(node, ticker, as_of, resolver),
            data_unavailable=result is None,
        )

    # ---- Field resolution wiring (mirrors domain/backtest_engine.py) ----

    def _build_resolver(self) -> FieldResolver:
        return FieldResolver(
            value_at=self._value_at,
            average_at=self._average_at,
            event_occurred=self._event_occurred,
            recent_sessions=self._recent_sessions,
        )

    def _value_at(
        self, ticker: str, catalog_id: str, params: FieldParams, as_of: date
    ) -> float | None:
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

    def _recent_sessions(self, ticker: str, as_of: date, n: int) -> list[date]:
        bars = self._price.get_bars(ticker, as_of - timedelta(days=n * 3 + 10), as_of)
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
        return any(
            occurrence.event_date > as_of and occurrence.known_as_of <= as_of
            for occurrence in occurrences
        )


def _named_criteria(universe: UniverseSpec) -> list[str]:
    """Which `UniverseSpec` fields were active, for AC3's "naming the
    reason" -- not the resolved member list (already empty), the criteria
    that could plausibly have caused it."""
    names = []
    if universe.tickers is not None:
        names.append("tickers")
    if universe.sectors:
        names.append("sectors")
    if universe.min_price is not None:
        names.append("min_price")
    if universe.min_avg_volume is not None:
        names.append("min_avg_volume")
    if universe.min_market_cap is not None:
        names.append("min_market_cap")
    if universe.excluded_tickers:
        names.append("excluded_tickers")
    return names


def _instrument_ref(ticker: str) -> InstrumentRef:
    # No per-ticker exchange/asset-type source exists in this repo's Python
    # side -- the same honest gap infra/similarity_engine.py already has
    # (InstrumentRef(instrument_id=ticker, symbol=ticker), left as None
    # rather than fabricated).
    return InstrumentRef(instrument_id=ticker, symbol=ticker)


def _leaf_value(
    node: ConditionNode, ticker: str, as_of: date, resolver: FieldResolver
) -> float | None:
    """The observed value behind a leaf condition's pass/fail, where one
    scalar cleanly represents it. `series_comparison`/`temporal`/
    `event_relative`/`pattern`/`study_output` conditions compare two things
    or aren't scalar at all -- `value` stays None for those rather than
    picking one side arbitrarily."""
    condition = node.condition
    if isinstance(condition, (ScalarCondition, RangeCondition, RelativeCondition)):
        return resolver.value_at(ticker, condition.field_id, {}, as_of)
    return None


def _composite_scores(
    tickers: list[str], ranking: RankingSpec, values: dict[str, dict[str, float | None]]
) -> dict[str, float]:
    """Percentile-rank normalization within the matched set, then a
    weighted sum (`spec.md`'s Open Question 3 assumption). A ticker missing
    a field's value is excluded from that field's ranking and contributes 0
    for it -- never fabricated."""
    scores = {ticker: 0.0 for ticker in tickers}
    for field in ranking.fields:
        field_values = values[field.field_id]
        present = [t for t in tickers if field_values[t] is not None]
        if not present:
            continue

        def _value_of(ticker: str, fv: dict[str, float | None] = field_values) -> float:
            observed = fv[ticker]
            assert observed is not None  # `present` was already filtered to non-None
            return observed

        ranks = _percentile_ranks(present, key=_value_of, descending=field.direction == "desc")
        for ticker in present:
            scores[ticker] += ranks[ticker] * field.weight
    return scores


def _percentile_ranks(
    items: list[str], key: Callable[[str], float], descending: bool
) -> dict[str, float]:
    """1.0 = most desirable (per `descending`), 0.0 = least. Tied items
    share the average percentile of the positions they occupy."""
    n = len(items)
    if n == 1:
        return {items[0]: 1.0}
    ordered = sorted(items, key=key, reverse=descending)
    ranks: dict[str, float] = {}
    i = 0
    while i < n:
        j = i
        while j + 1 < n and key(ordered[j + 1]) == key(ordered[i]):
            j += 1
        percentile = 1.0 - ((i + j) / 2) / (n - 1)
        for k in range(i, j + 1):
            ranks[ordered[k]] = percentile
        i = j + 1
    return ranks
