"""T-0025-2: PortScreenerRunEngine -- one test per AC, using bare fixture
fakes (no mocking framework), mirroring test_backtest_engine.py's own
convention for the same three market-data Protocols."""

from __future__ import annotations

from datetime import date, datetime, time, timezone

from domain.contracts.market_data import (
    DelistingEvent,
    EventOccurrence,
    SeriesObservation,
)
from domain.models.price import PriceBar
from domain.models.screener import (
    ConditionNode,
    GroupNode,
    ScalarCondition,
    SeriesRef,
    UniverseSpec,
)
from domain.models.screener_run import (
    PROBLEM_EMPTY_UNIVERSE,
    PROBLEM_UNRECOGNIZED_VALUE,
    RankingField,
    RankingSpec,
    ScreenerRunRequest,
)
from domain.models.similarity import MarketDataProvenance
from domain.screener_run_engine import PortScreenerRunEngine

_AS_OF = date(2024, 6, 3)


def _bar(ticker: str, day: date, close: float) -> PriceBar:
    return PriceBar(
        ticker=ticker, date=day, open=close, high=close + 1, low=close - 1, close=close, volume=1000
    )


class FakePriceSeriesPort:
    def __init__(self, bars_by_ticker: dict[str, list[PriceBar]], as_of: date = _AS_OF) -> None:
        self._bars = bars_by_ticker
        self._as_of = as_of

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
        return MarketDataProvenance(
            as_of=datetime.combine(self._as_of, time.min, tzinfo=timezone.utc),
            source_id="fixture",
            source_label="Fixture Source",
            liveness="historical",
            timezone="UTC",
            price_adjustment="adjusted",
            engine_version="pre-run-placeholder",
        )


class FakeReferenceDataPort:
    def __init__(self, members: list[str]) -> None:
        self._members = members

    def get_universe_members(self, as_of: date, universe: UniverseSpec) -> list[str]:
        excluded = set(universe.excluded_tickers)
        candidates = universe.tickers if universe.tickers is not None else self._members
        return sorted(t for t in candidates if t not in excluded)

    def includes_delisted(self) -> bool:
        return False

    def includes_merged(self) -> bool:
        return False

    def includes_renamed(self) -> bool:
        return False

    def get_delisting_events(self, from_date: date, to_date: date) -> list[DelistingEvent]:
        return []

    def get_event_occurrences(
        self, ticker: str, event_type_id: str, from_date: date, to_date: date
    ) -> list[EventOccurrence]:
        return []


class FakeSectorCatalog:
    def __init__(self, unrecognized: list[str] | None = None) -> None:
        self._unrecognized = set(unrecognized or [])

    def unrecognized_sectors(self, sectors: list[str]) -> list[str]:
        return [s for s in sectors if s in self._unrecognized]


def _universe(**overrides: object) -> UniverseSpec:
    base: dict[str, object] = dict(universe_id="u1", label="Test universe")
    base.update(overrides)
    return UniverseSpec(**base)  # type: ignore[arg-type]


def _gt_condition(node_id: str, field_id: str, value: float) -> ConditionNode:
    return ConditionNode(
        node_id=node_id,
        condition=ScalarCondition(field_id=field_id, operator="op.greater_than", value=value),
    )


def _engine(
    bars: dict[str, list[PriceBar]],
    members: list[str],
    unrecognized_sectors: list[str] | None = None,
) -> PortScreenerRunEngine:
    return PortScreenerRunEngine(
        price_port=FakePriceSeriesPort(bars),
        reference_port=FakeReferenceDataPort(members),
        sector_catalog=FakeSectorCatalog(unrecognized_sectors),
    )


class TestHappyPath:
    def test_narrows_evaluates_ranks_and_truncates(self) -> None:
        # AAA and BBB pass the filter (close > 50); CCC does not.
        bars = {
            "AAA": [_bar("AAA", _AS_OF, 100.0)],
            "BBB": [_bar("BBB", _AS_OF, 80.0)],
            "CCC": [_bar("CCC", _AS_OF, 10.0)],
        }
        engine = _engine(bars, ["AAA", "BBB", "CCC"])
        request = ScreenerRunRequest(
            universe=_universe(),
            filter_tree=GroupNode(
                node_id="root", op="and", children=[_gt_condition("n1", "close", 50.0)]
            ),
            ranking=RankingSpec(fields=[RankingField(field_id="close", direction="desc")]),
            limit=1,
        )

        result = engine.run(request)

        assert result.status == "complete", f"expected a complete run, got {result.status}"
        assert (
            result.universe_count == 3
        ), f"expected all 3 candidates counted, got {result.universe_count}"
        assert result.matched_count == 2, f"expected AAA+BBB to match, got {result.matched_count}"
        assert (
            result.returned_count == 1
        ), f"expected limit=1 truncation, got {result.returned_count}"
        assert result.truncated is True, "expected truncated=True (1 of 2 returned)"
        top_id = result.matches[0].instrument.instrument_id
        assert top_id == "AAA", f"expected AAA ranked first (higher close), got {top_id}"

    def test_ranking_applied_flag_reflects_whether_ranking_was_supplied(self) -> None:
        bars = {"AAA": [_bar("AAA", _AS_OF, 100.0)]}
        engine = _engine(bars, ["AAA"])
        request = ScreenerRunRequest(
            universe=_universe(), filter_tree=GroupNode(node_id="root", op="and", children=[])
        )

        result = engine.run(request)

        assert result.ranking_applied is False, "expected no ranking supplied to mean unapplied"
        assert result.matches[0].rank == 1, f"got {result.matches[0].rank}"


class TestDryRun:
    def test_reports_problems_without_executing(self) -> None:
        bars = {"AAA": [_bar("AAA", _AS_OF, 100.0)]}
        engine = _engine(bars, ["AAA"])
        request = ScreenerRunRequest(
            universe=_universe(),
            filter_tree=GroupNode(
                node_id="root", op="and", children=[_gt_condition("n1", "close", 50.0)]
            ),
            dry_run=True,
        )

        result = engine.run(request)

        assert result.status == "valid", f"expected a valid dry-run report, got {result.status}"
        assert result.matches == [], "expected dry_run to never execute (no matches)"
        assert result.universe_count == 1, f"got {result.universe_count}"


class TestEmptyUniverseRefusal:
    def test_zero_instrument_universe_is_a_named_refusal(self) -> None:
        engine = _engine({}, [])
        request = ScreenerRunRequest(
            universe=_universe(), filter_tree=GroupNode(node_id="root", op="and", children=[])
        )

        result = engine.run(request)

        assert (
            result.status == "refused"
        ), f"expected a refusal, never empty success, got {result.status}"
        assert result.matches == [], "a refused run must carry no matches"
        codes = [p.code for p in result.problems]
        assert PROBLEM_EMPTY_UNIVERSE in codes, f"expected empty_universe named, got {codes}"

    def test_empty_universe_refusal_also_applies_under_dry_run(self) -> None:
        engine = _engine({}, [])
        request = ScreenerRunRequest(
            universe=_universe(),
            filter_tree=GroupNode(node_id="root", op="and", children=[]),
            dry_run=True,
        )

        result = engine.run(request)

        assert result.status == "refused", f"got {result.status}"


class TestZeroMatchesIsNotAnError:
    def test_nonempty_universe_with_no_matches_is_a_normal_complete_run(self) -> None:
        # spec.md's explicit distinction: zero *matches* after filtering is
        # a normal result, not the same thing as a zero-instrument universe.
        bars = {"AAA": [_bar("AAA", _AS_OF, 10.0)]}
        engine = _engine(bars, ["AAA"])
        request = ScreenerRunRequest(
            universe=_universe(),
            filter_tree=GroupNode(
                node_id="root", op="and", children=[_gt_condition("n1", "close", 999.0)]
            ),
        )

        result = engine.run(request)

        assert result.status == "complete", f"expected a normal complete run, got {result.status}"
        assert result.matched_count == 0, f"got {result.matched_count}"
        assert result.problems == [], "zero matches is not a validation problem"


class TestUnrecognizedSector:
    def test_unrecognized_sector_value_is_a_named_refusal(self) -> None:
        bars = {"AAA": [_bar("AAA", _AS_OF, 100.0)]}
        engine = _engine(bars, ["AAA"], unrecognized_sectors=["Not-A-Sector"])
        request = ScreenerRunRequest(
            universe=_universe(sectors=["Not-A-Sector"]),
            filter_tree=GroupNode(node_id="root", op="and", children=[]),
        )

        result = engine.run(request)

        assert result.status == "refused", f"got {result.status}"
        codes = [p.code for p in result.problems]
        assert (
            PROBLEM_UNRECOGNIZED_VALUE in codes
        ), f"expected unrecognized_value named, got {codes}"


class TestNodeEvaluations:
    def test_per_match_node_evaluations_are_keyed_by_node_id(self) -> None:
        bars = {"AAA": [_bar("AAA", _AS_OF, 100.0)]}
        engine = _engine(bars, ["AAA"])
        request = ScreenerRunRequest(
            universe=_universe(),
            filter_tree=GroupNode(
                node_id="root", op="and", children=[_gt_condition("n1", "close", 50.0)]
            ),
        )

        result = engine.run(request)

        match = result.matches[0]
        assert "root" in match.node_evaluations, f"got keys {list(match.node_evaluations)}"
        assert "n1" in match.node_evaluations, f"got keys {list(match.node_evaluations)}"
        assert match.node_evaluations["n1"].passed is True, "expected the leaf condition to pass"
        assert (
            match.node_evaluations["n1"].value == 100.0
        ), f"expected the observed close value recorded, got {match.node_evaluations['n1'].value}"
        assert (
            match.node_evaluations["root"].passed is True
        ), "expected the group's own pass/fail recorded"

    def test_disabled_node_is_excluded_from_node_evaluations(self) -> None:
        bars = {"AAA": [_bar("AAA", _AS_OF, 100.0)]}
        engine = _engine(bars, ["AAA"])
        disabled_child = _gt_condition("n1", "close", 999.0)
        disabled_child = disabled_child.model_copy(update={"enabled": False})
        request = ScreenerRunRequest(
            universe=_universe(),
            filter_tree=GroupNode(node_id="root", op="and", children=[disabled_child]),
        )

        result = engine.run(request)

        assert result.matched_count == 1, "a disabled node is skipped, treated as absent"
        assert "n1" not in result.matches[0].node_evaluations, "expected the disabled node excluded"


class TestStatelessness:
    def test_same_request_run_twice_reproduces_identical_output(self) -> None:
        bars = {
            "AAA": [_bar("AAA", _AS_OF, 100.0)],
            "BBB": [_bar("BBB", _AS_OF, 80.0)],
        }
        engine = _engine(bars, ["AAA", "BBB"])
        request = ScreenerRunRequest(
            universe=_universe(),
            filter_tree=GroupNode(
                node_id="root", op="and", children=[_gt_condition("n1", "close", 50.0)]
            ),
            ranking=RankingSpec(fields=[RankingField(field_id="close", direction="desc")]),
        )

        first = engine.run(request)
        second = engine.run(request)

        assert first == second, "expected an identical result on a repeated call (no session state)"
