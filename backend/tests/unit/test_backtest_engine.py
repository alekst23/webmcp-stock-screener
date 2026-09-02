from datetime import date, datetime, timezone

import pytest

from domain.backtest_engine import (
    COVERAGE_TRUNCATED,
    UNIVERSE_TRUNCATED,
    PortBacktestEngine,
)
from domain.contracts.market_data import (
    DelistingEvent,
    EventOccurrence,
    ReportedValue,
    SeriesObservation,
)
from domain.errors import InsufficientHistoryError
from domain.lookahead import LOOKAHEAD_FUTURE_EVENT
from domain.models.backtest import BacktestRequest, RebalanceFrequency
from domain.models.price import PriceBar
from domain.models.screener import (
    ConditionNode,
    EventRelativeCondition,
    GroupNode,
    ScalarCondition,
    SeriesRef,
    UniverseSpec,
)
from domain.models.similarity import MarketDataProvenance

_SESSIONS = [date(2024, 1, d) for d in (1, 2, 3, 4, 5, 8, 9, 10)]
# A dip at index 5 (Jan 8) gives the drawdown test something real to measure.
_CLOSES = [100.0, 102.0, 104.0, 106.0, 108.0, 103.0, 112.0, 114.0]


def _provenance() -> MarketDataProvenance:
    return MarketDataProvenance(
        as_of=datetime(2024, 1, 10, tzinfo=timezone.utc),
        source_id="fixture",
        source_label="Fixture Source",
        liveness="historical",
        timezone="UTC",
        currency="USD",
        price_adjustment="adjusted",
        engine_version="pre-run-placeholder",
    )


class FakePriceSeriesPort:
    def __init__(self, bars_by_ticker: dict) -> None:
        self._bars = bars_by_ticker

    def get_bars(self, ticker: str, from_date: date, to_date: date) -> list[PriceBar]:
        return [b for b in self._bars.get(ticker, []) if from_date <= b.date <= to_date]

    def get_series(
        self, ticker: str, series_ref: SeriesRef, from_date: date, to_date: date
    ) -> list[SeriesObservation]:
        if series_ref.catalog_id != "close":
            return []
        return [
            SeriesObservation(b.date, b.close)
            for b in self._bars.get(ticker, [])
            if from_date <= b.date <= to_date
        ]

    def provenance(self) -> MarketDataProvenance:
        return _provenance()


class FakeFundamentalsPort:
    def __init__(self, reported: dict | None = None, field_ids: frozenset = frozenset()) -> None:
        self._reported = reported or {}
        self._field_ids = field_ids

    def field_ids(self) -> frozenset:
        return self._field_ids

    def supports_point_in_time(self) -> bool:
        return True

    def get_reported_value(self, ticker: str, field_id: str, as_of: date) -> ReportedValue | None:
        candidates = [
            r for r in self._reported.get((ticker, field_id), []) if r.reported_date <= as_of
        ]
        return candidates[-1] if candidates else None


class FakeReferenceDataPort:
    def __init__(
        self,
        members: dict,
        includes_delisted: bool = False,
        includes_merged: bool = False,
        includes_renamed: bool = False,
        delisting_events: list | None = None,
        event_occurrences: list | None = None,
    ) -> None:
        self._members = members  # ticker -> (start, end_or_None)
        self._includes_delisted = includes_delisted
        self._includes_merged = includes_merged
        self._includes_renamed = includes_renamed
        self._delisting_events = delisting_events or []
        self._event_occurrences = event_occurrences or []

    def includes_delisted(self) -> bool:
        return self._includes_delisted

    def includes_merged(self) -> bool:
        return self._includes_merged

    def includes_renamed(self) -> bool:
        return self._includes_renamed

    def get_universe_members(self, as_of: date, universe: UniverseSpec) -> list[str]:
        candidates = universe.tickers if universe.tickers is not None else list(self._members)
        result = []
        for ticker in candidates:
            window = self._members.get(ticker)
            if window is None:
                continue
            start, end = window
            if start <= as_of and (end is None or as_of <= end):
                result.append(ticker)
        return result

    def get_delisting_events(self, from_date: date, to_date: date) -> list[DelistingEvent]:
        return [e for e in self._delisting_events if from_date <= e.event_date <= to_date]

    def get_event_occurrences(
        self, ticker: str, event_type_id: str, from_date: date, to_date: date
    ) -> list[EventOccurrence]:
        return [
            e
            for e in self._event_occurrences
            if e.ticker == ticker
            and e.event_type_id == event_type_id
            and from_date <= e.event_date <= to_date
        ]


def _bars(ticker: str) -> list[PriceBar]:
    return [
        PriceBar(ticker=ticker, date=d, open=c, high=c, low=c, close=c, volume=1_000_000)
        for d, c in zip(_SESSIONS, _CLOSES)
    ]


def _threshold_request(threshold: float, horizons: list[int] | None = None) -> BacktestRequest:
    condition = ScalarCondition(field_id="close", operator="op.greater_than", value=threshold)
    tree = GroupNode(
        node_id="root", op="and", children=[ConditionNode(node_id="c1", condition=condition)]
    )
    universe = UniverseSpec(universe_id="u1", label="test universe", tickers=["AAA"])
    return BacktestRequest(
        screener_id="scr_1",
        revision=1,
        filter_tree=tree,
        universe=universe,
        from_date=_SESSIONS[0],
        to_date=_SESSIONS[-1],
        horizons=horizons or [2],
        rebalance=RebalanceFrequency.DAILY,
    )


def _engine(reference_port: FakeReferenceDataPort | None = None) -> PortBacktestEngine:
    price_port = FakePriceSeriesPort({"AAA": _bars("AAA")})
    fundamentals_port = FakeFundamentalsPort()
    reference = reference_port or FakeReferenceDataPort({"AAA": (date(2024, 1, 1), None)})
    return PortBacktestEngine(price_port, fundamentals_port, reference)


class TestMatchFrequencyAndForwardReturns:
    def test_matches_and_returns_against_a_hand_traceable_fixture(self) -> None:
        # close > 106 matches indices 4 (108), 6 (112), 7 (114) -- index 5
        # (103) fails the threshold, so Jan 8 drops out of the match set.
        request = _threshold_request(threshold=106.0)

        result = _engine().run(request)

        assert result.match_count_total == 3, f"expected 3 matches, got {result.match_count_total}"
        matched_dates = {p.on_date for p in result.match_frequency if p.match_count > 0}
        assert matched_dates == {
            date(2024, 1, 5),
            date(2024, 1, 9),
            date(2024, 1, 10),
        }, f"expected matches on Jan 5/9/10, got {matched_dates}"
        assert len(result.match_frequency) == 8, (
            f"daily rebalance over 8 sessions must produce 8 points, "
            f"got {len(result.match_frequency)}"
        )

        # h=2 forward return only resolves for the Jan 5 match (index 4 -> 6):
        # the Jan 9 and Jan 10 matches run past the fixture's trailing edge.
        expected_return = (_CLOSES[6] - _CLOSES[4]) / _CLOSES[4]
        distribution = result.forward_returns[0]
        assert distribution.horizon_days == 2
        assert (
            distribution.count == 1
        ), f"expected exactly 1 resolvable forward return, got {distribution.count}"
        assert distribution.mean == pytest.approx(
            expected_return
        ), f"expected mean {expected_return}, got {distribution.mean}"
        assert distribution.hit_rate == 1.0, f"expected hit_rate 1.0, got {distribution.hit_rate}"

    def test_zero_match_result_states_range_and_universe_not_an_error(self) -> None:
        request = _threshold_request(threshold=10_000.0)

        result = _engine().run(request)

        assert result.match_count_total == 0, "an unreachable threshold must match nothing"
        assert result.from_date_covered == _SESSIONS[0]
        assert result.to_date_covered == _SESSIONS[-1]
        assert result.universe.tickers == ["AAA"]
        assert result.forward_returns[0].count == 0
        assert result.drawdown.count == 0

    def test_drawdown_reflects_the_seeded_dip(self) -> None:
        request = _threshold_request(threshold=106.0)

        result = _engine().run(request)

        # The only match instance with more than one point in its own
        # forward window is Jan 5 (index 4): path [108, 103, 112] dips to
        # 103 before recovering -- (103 - 108) / 108.
        expected_worst = (_CLOSES[5] - _CLOSES[4]) / _CLOSES[4]
        assert result.drawdown.worst_max_drawdown == pytest.approx(
            expected_worst
        ), f"expected worst drawdown {expected_worst}, got {result.drawdown.worst_max_drawdown}"


class TestInsufficientHistory:
    def test_horizon_exceeding_available_sessions_is_rejected(self) -> None:
        request = _threshold_request(threshold=106.0, horizons=[250])

        with pytest.raises(InsufficientHistoryError) as excinfo:
            _engine().run(request)

        assert (
            excinfo.value.required_sessions == 251
        ), f"expected required_sessions 251, got {excinfo.value.required_sessions}"
        assert excinfo.value.available_sessions == len(
            _SESSIONS
        ), f"expected available_sessions {len(_SESSIONS)}, got {excinfo.value.available_sessions}"


class TestCoverageTruncation:
    def test_range_wider_than_the_bound_is_truncated_with_a_warning(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("domain.backtest_engine.MAX_RANGE_SESSIONS", 4)
        request = _threshold_request(threshold=106.0)

        result = _engine().run(request)

        assert (
            result.from_date_covered == _SESSIONS[-4]
        ), f"expected coverage truncated to the last 4 sessions, got {result.from_date_covered}"
        codes = [w.code for w in result.warnings]
        assert COVERAGE_TRUNCATED in codes, f"expected a coverage-truncated warning, got {codes}"


class TestUniverseTruncation:
    def test_universe_larger_than_the_bound_is_truncated_with_a_warning(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("domain.backtest_engine.MAX_UNIVERSE_SIZE", 1)
        tickers = ["AAA", "BBB"]
        bars = {"AAA": _bars("AAA"), "BBB": _bars("BBB")}
        price_port = FakePriceSeriesPort(bars)
        reference = FakeReferenceDataPort(
            {"AAA": (date(2024, 1, 1), None), "BBB": (date(2024, 1, 1), None)}
        )
        engine = PortBacktestEngine(price_port, FakeFundamentalsPort(), reference)
        condition = ScalarCondition(field_id="close", operator="op.greater_than", value=0.0)
        tree = GroupNode(
            node_id="root", op="and", children=[ConditionNode(node_id="c1", condition=condition)]
        )
        universe = UniverseSpec(universe_id="u1", label="test", tickers=tickers)
        request = BacktestRequest(
            screener_id="scr_1",
            revision=1,
            filter_tree=tree,
            universe=universe,
            from_date=_SESSIONS[0],
            to_date=_SESSIONS[-1],
            horizons=[2],
            rebalance=RebalanceFrequency.DAILY,
        )

        result = engine.run(request)

        codes = [w.code for w in result.warnings]
        assert UNIVERSE_TRUNCATED in codes, f"expected a universe-truncated warning, got {codes}"
        assert all(
            p.universe_size <= 1 for p in result.match_frequency
        ), "universe_size must never exceed the bound once truncation is applied"


class TestSurvivorship:
    def test_source_without_delisted_coverage_states_the_bias_plainly(self) -> None:
        reference = FakeReferenceDataPort(
            {"AAA": (date(2024, 1, 1), None)}, includes_delisted=False
        )
        request = _threshold_request(threshold=106.0)

        result = _engine(reference).run(request)

        assert result.survivorship.includes_delisted is False
        statement = result.survivorship.statement.lower()
        assert (
            "survivorship bias" in statement
        ), f"expected the statement to name survivorship bias, got: {statement!r}"

    def test_source_with_delisted_coverage_reports_the_event_count(self) -> None:
        event = DelistingEvent(ticker="ZZZ", event_date=date(2024, 1, 4), kind="delisted")
        reference = FakeReferenceDataPort(
            {"AAA": (date(2024, 1, 1), None)}, includes_delisted=True, delisting_events=[event]
        )
        request = _threshold_request(threshold=106.0)

        result = _engine(reference).run(request)

        assert result.survivorship.includes_delisted is True
        events_in_range = result.survivorship.delisting_events_in_range
        assert events_in_range == 1, f"expected 1 delisting event counted, got {events_in_range}"
        assert "includes delisted" in result.survivorship.statement.lower()


class TestLookaheadLag:
    def _request_with_future_event(self) -> BacktestRequest:
        condition = EventRelativeCondition(
            event_type_id="earnings", direction="future", window_days=5
        )
        tree = GroupNode(
            node_id="root", op="and", children=[ConditionNode(node_id="c1", condition=condition)]
        )
        universe = UniverseSpec(universe_id="u1", label="test", tickers=["AAA"])
        return BacktestRequest(
            screener_id="scr_1",
            revision=1,
            filter_tree=tree,
            universe=universe,
            from_date=_SESSIONS[0],
            to_date=_SESSIONS[-1],
            horizons=[2],
            rebalance=RebalanceFrequency.DAILY,
        )

    def test_lag_changes_the_match_set(self) -> None:
        # Same scheduled event, only how early it was publicly known differs.
        event_date = date(2024, 1, 10)
        early_known = EventOccurrence("AAA", "earnings", event_date, known_as_of=date(2024, 1, 1))
        late_known = EventOccurrence("AAA", "earnings", event_date, known_as_of=date(2024, 1, 10))

        early_reference = FakeReferenceDataPort(
            {"AAA": (date(2024, 1, 1), None)}, event_occurrences=[early_known]
        )
        late_reference = FakeReferenceDataPort(
            {"AAA": (date(2024, 1, 1), None)}, event_occurrences=[late_known]
        )

        early_result = _engine(early_reference).run(self._request_with_future_event())
        late_result = _engine(late_reference).run(self._request_with_future_event())

        assert early_result.match_count_total == 3, (
            f"expected 3 matches once the event was already known well in advance, "
            f"got {early_result.match_count_total}"
        )
        assert late_result.match_count_total == 0, (
            f"expected 0 matches when the event was only known on the event date itself, "
            f"got {late_result.match_count_total}"
        )

    def test_result_warns_about_the_lookahead_risk(self) -> None:
        reference = FakeReferenceDataPort({"AAA": (date(2024, 1, 1), None)})

        result = _engine(reference).run(self._request_with_future_event())

        codes = [w.code for w in result.warnings]
        assert (
            LOOKAHEAD_FUTURE_EVENT in codes
        ), f"expected a future-event lookahead warning, got {codes}"


class TestDeterminism:
    def test_same_request_and_fixture_yields_identical_results(self) -> None:
        request = _threshold_request(threshold=106.0)

        result_a = _engine().run(request)
        result_b = _engine().run(request)

        assert (
            result_a == result_b
        ), "identical inputs must produce identical (Pydantic-equal) results"


class TestProvenance:
    def test_provenance_carries_the_backtest_engine_version(self) -> None:
        from domain.models.backtest import BACKTEST_ENGINE_VERSION

        result = _engine().run(_threshold_request(threshold=106.0))

        assert result.provenance.market_data.engine_version == BACKTEST_ENGINE_VERSION
        assert (
            result.provenance.fundamentals_reporting_period is None
        ), "no fundamentals field was used, so the reporting period must be absent"

    def test_fundamentals_reporting_period_set_when_a_fundamental_field_is_used(self) -> None:
        reported = ReportedValue(
            value=0.15, fiscal_period="2023-Q4", reported_date=date(2024, 1, 2)
        )
        fundamentals = FakeFundamentalsPort(
            reported={("AAA", "revenue_growth"): [reported]},
            field_ids=frozenset({"revenue_growth"}),
        )
        price_port = FakePriceSeriesPort({"AAA": _bars("AAA")})
        reference = FakeReferenceDataPort({"AAA": (date(2024, 1, 1), None)})
        engine = PortBacktestEngine(price_port, fundamentals, reference)
        condition = ScalarCondition(
            field_id="revenue_growth", operator="op.greater_than", value=0.1
        )
        tree = GroupNode(
            node_id="root", op="and", children=[ConditionNode(node_id="c1", condition=condition)]
        )
        universe = UniverseSpec(universe_id="u1", label="test", tickers=["AAA"])
        request = BacktestRequest(
            screener_id="scr_1",
            revision=1,
            filter_tree=tree,
            universe=universe,
            from_date=_SESSIONS[0],
            to_date=_SESSIONS[-1],
            horizons=[2],
            rebalance=RebalanceFrequency.DAILY,
        )

        result = engine.run(request)

        reporting_period = result.provenance.fundamentals_reporting_period
        assert (
            reporting_period == "2023-Q4"
        ), f"expected the reported fiscal period, got {reporting_period!r}"
