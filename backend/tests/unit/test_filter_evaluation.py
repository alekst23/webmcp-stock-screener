from datetime import date

from domain.filter_evaluation import (
    FieldResolver,
    evaluate_condition,
    evaluate_node,
    find_unevaluable_conditions,
)
from domain.models.screener import (
    ConditionNode,
    EventRelativeCondition,
    GroupNode,
    IndexBaseline,
    OwnMovingAverageBaseline,
    PatternCondition,
    RangeCondition,
    RelativeCondition,
    ScalarCondition,
    SeriesComparisonCondition,
    SeriesRef,
    StudyOutputCondition,
    TemporalCondition,
)

_AS_OF = date(2024, 6, 3)


def _resolver(
    values: dict[str, float] | None = None,
    averages: dict[str, float] | None = None,
    events: dict[str, bool | None] | None = None,
    sessions: list[date] | None = None,
) -> FieldResolver:
    values = values or {}
    averages = averages or {}
    events = events or {}

    def value_at(ticker: str, catalog_id: str, params: dict, as_of: date) -> float | None:
        return values.get(catalog_id)

    def average_at(
        ticker: str, catalog_id: str, params: dict, as_of: date, window_bars: int
    ) -> float | None:
        return averages.get(catalog_id)

    def event_occurred(
        ticker: str, event_type_id: str, as_of: date, direction: str, window_days: int
    ) -> bool | None:
        return events.get(event_type_id)

    def recent_sessions(ticker: str, as_of: date, n: int) -> list[date]:
        return sessions or []

    return FieldResolver(
        value_at=value_at,
        average_at=average_at,
        event_occurred=event_occurred,
        recent_sessions=recent_sessions,
    )


class TestScalarAndRange:
    def test_scalar_greater_than_passes(self) -> None:
        condition = ScalarCondition(field_id="close", operator="op.greater_than", value=100.0)
        resolver = _resolver(values={"close": 105.0})

        assert evaluate_condition(condition, "AAPL", _AS_OF, resolver) is True

    def test_scalar_greater_than_fails(self) -> None:
        condition = ScalarCondition(field_id="close", operator="op.greater_than", value=100.0)
        resolver = _resolver(values={"close": 95.0})

        assert evaluate_condition(condition, "AAPL", _AS_OF, resolver) is False

    def test_scalar_missing_value_is_not_evaluable(self) -> None:
        condition = ScalarCondition(field_id="close", operator="op.greater_than", value=100.0)
        resolver = _resolver(values={})

        assert evaluate_condition(condition, "AAPL", _AS_OF, resolver) is None

    def test_range_inclusive_bounds(self) -> None:
        condition = RangeCondition(field_id="rsi", lower=30.0, upper=70.0)
        resolver = _resolver(values={"rsi": 30.0})

        assert evaluate_condition(condition, "AAPL", _AS_OF, resolver) is True

    def test_range_exclusive_lower_bound_excludes_boundary(self) -> None:
        condition = RangeCondition(field_id="rsi", lower=30.0, upper=70.0, lower_inclusive=False)
        resolver = _resolver(values={"rsi": 30.0})

        assert evaluate_condition(condition, "AAPL", _AS_OF, resolver) is False

    def test_range_outside_bounds_fails(self) -> None:
        condition = RangeCondition(field_id="rsi", lower=30.0, upper=70.0)
        resolver = _resolver(values={"rsi": 80.0})

        assert evaluate_condition(condition, "AAPL", _AS_OF, resolver) is False


class TestSeriesComparison:
    def test_left_greater_than_right_passes(self) -> None:
        condition = SeriesComparisonCondition(
            left=SeriesRef(catalog_id="close"),
            right=SeriesRef(catalog_id="sma_20"),
            operator="op.greater_than",
        )
        resolver = _resolver(values={"close": 110.0, "sma_20": 100.0})

        assert evaluate_condition(condition, "AAPL", _AS_OF, resolver) is True

    def test_missing_right_side_is_not_evaluable(self) -> None:
        condition = SeriesComparisonCondition(
            left=SeriesRef(catalog_id="close"),
            right=SeriesRef(catalog_id="sma_20"),
            operator="op.greater_than",
        )
        resolver = _resolver(values={"close": 110.0})

        assert evaluate_condition(condition, "AAPL", _AS_OF, resolver) is None


class TestRelative:
    def test_own_moving_average_baseline_evaluates(self) -> None:
        condition = RelativeCondition(
            field_id="volume",
            baseline=OwnMovingAverageBaseline(window_bars=20),
            multiple=1.5,
            operator="op.greater_than",
        )
        resolver = _resolver(values={"volume": 200.0}, averages={"volume": 100.0})

        assert (
            evaluate_condition(condition, "AAPL", _AS_OF, resolver) is True
        ), "200 > 1.5 * 100 should pass"

    def test_index_baseline_is_not_evaluable(self) -> None:
        condition = RelativeCondition(
            field_id="volume",
            baseline=IndexBaseline(index_id="spx"),
            multiple=1.5,
            operator="op.greater_than",
        )
        resolver = _resolver(values={"volume": 200.0})

        assert (
            evaluate_condition(condition, "AAPL", _AS_OF, resolver) is None
        ), "no port serves index-level baselines; must be reported not-evaluable"


class TestPatternAndStudyOutput:
    def test_pattern_condition_is_not_evaluable(self) -> None:
        condition = PatternCondition(
            pattern_id="double_bottom", min_confidence=0.8, interval_id="1d"
        )

        assert evaluate_condition(condition, "AAPL", _AS_OF, _resolver()) is None

    def test_study_output_condition_is_not_evaluable(self) -> None:
        condition = StudyOutputCondition(
            study_id="custom_1", output_name="signal", predicate="true"
        )

        assert evaluate_condition(condition, "AAPL", _AS_OF, _resolver()) is None


class TestEventRelative:
    def test_occurred_event_passes(self) -> None:
        condition = EventRelativeCondition(
            event_type_id="earnings", direction="past", window_days=5
        )
        resolver = _resolver(events={"earnings": True})

        assert evaluate_condition(condition, "AAPL", _AS_OF, resolver) is True

    def test_unsupported_event_type_is_not_evaluable(self) -> None:
        condition = EventRelativeCondition(event_type_id="unknown", direction="past", window_days=5)
        resolver = _resolver(events={})

        assert evaluate_condition(condition, "AAPL", _AS_OF, resolver) is None


class TestTemporal:
    def test_became_true_detects_false_to_true_edge(self) -> None:
        sessions = [date(2024, 6, d) for d in (1, 2, 3)]
        inner = ScalarCondition(field_id="close", operator="op.greater_than", value=100.0)
        condition = TemporalCondition(
            condition=inner, event="became_true", within_bars=2, interval_id="1d"
        )
        # close: day1=90 (false), day2=95 (false), day3=105 (true) -> edge on day3
        closes = {sessions[0]: 90.0, sessions[1]: 95.0, sessions[2]: 105.0}
        resolver = FieldResolver(
            value_at=lambda ticker, cid, params, as_of: closes[as_of],
            average_at=lambda *args: None,
            event_occurred=lambda *args: None,
            recent_sessions=lambda ticker, as_of, n: sessions,
        )

        assert evaluate_condition(condition, "AAPL", sessions[2], resolver) is True

    def test_no_transition_returns_false(self) -> None:
        sessions = [date(2024, 6, d) for d in (1, 2, 3)]
        inner = ScalarCondition(field_id="close", operator="op.greater_than", value=100.0)
        condition = TemporalCondition(
            condition=inner, event="became_true", within_bars=2, interval_id="1d"
        )
        resolver = FieldResolver(
            value_at=lambda ticker, cid, params, as_of: 50.0,
            average_at=lambda *args: None,
            event_occurred=lambda *args: None,
            recent_sessions=lambda ticker, as_of, n: sessions,
        )

        assert evaluate_condition(condition, "AAPL", sessions[2], resolver) is False


class TestGroupFolding:
    def test_and_group_requires_all_children(self) -> None:
        passing = ConditionNode(
            node_id="n1",
            condition=ScalarCondition(field_id="close", operator="op.greater_than", value=1.0),
        )
        failing = ConditionNode(
            node_id="n2",
            condition=ScalarCondition(field_id="close", operator="op.less_than", value=1.0),
        )
        root = GroupNode(node_id="root", op="and", children=[passing, failing])
        resolver = _resolver(values={"close": 50.0})

        assert evaluate_node(root, "AAPL", _AS_OF, resolver) is False

    def test_or_group_requires_one_child(self) -> None:
        passing = ConditionNode(
            node_id="n1",
            condition=ScalarCondition(field_id="close", operator="op.greater_than", value=1.0),
        )
        failing = ConditionNode(
            node_id="n2",
            condition=ScalarCondition(field_id="close", operator="op.less_than", value=1.0),
        )
        root = GroupNode(node_id="root", op="or", children=[passing, failing])
        resolver = _resolver(values={"close": 50.0})

        assert evaluate_node(root, "AAPL", _AS_OF, resolver) is True

    def test_not_group_inverts_single_child(self) -> None:
        child = ConditionNode(
            node_id="n1",
            condition=ScalarCondition(field_id="close", operator="op.greater_than", value=1.0),
        )
        root = GroupNode(node_id="root", op="not", children=[child])
        resolver = _resolver(values={"close": 50.0})

        assert evaluate_node(root, "AAPL", _AS_OF, resolver) is False

    def test_not_evaluable_child_fails_closed_in_and_group(self) -> None:
        unevaluable = ConditionNode(
            node_id="n1",
            condition=PatternCondition(pattern_id="x", min_confidence=0.5, interval_id="1d"),
        )
        root = GroupNode(node_id="root", op="and", children=[unevaluable])

        assert (
            evaluate_node(root, "AAPL", _AS_OF, _resolver()) is False
        ), "a not-evaluable condition must never silently pass a screen"

    def test_disabled_node_is_treated_as_absent(self) -> None:
        failing = ConditionNode(
            node_id="n1",
            condition=ScalarCondition(field_id="close", operator="op.less_than", value=1.0),
            enabled=False,
        )
        root = GroupNode(node_id="root", op="and", children=[failing])

        assert evaluate_node(root, "AAPL", _AS_OF, _resolver()) is True, (
            "a disabled node in an 'and' group contributes nothing, so an otherwise-empty "
            "and-group passes"
        )


class TestFindUnevaluableConditions:
    def test_finds_pattern_and_study_output_and_unsupported_baseline(self) -> None:
        pattern = ConditionNode(
            node_id="p1",
            condition=PatternCondition(pattern_id="x", min_confidence=0.5, interval_id="1d"),
        )
        study = ConditionNode(
            node_id="s1",
            condition=StudyOutputCondition(study_id="c1", output_name="o", predicate="p"),
        )
        relative = ConditionNode(
            node_id="r1",
            condition=RelativeCondition(
                field_id="close",
                baseline=IndexBaseline(index_id="spx"),
                multiple=1.0,
                operator="op.greater_than",
            ),
        )
        evaluable = ConditionNode(
            node_id="e1",
            condition=ScalarCondition(field_id="close", operator="op.greater_than", value=1.0),
        )
        root = GroupNode(node_id="root", op="and", children=[pattern, study, relative, evaluable])

        node_ids = find_unevaluable_conditions(root)

        assert set(node_ids) == {"p1", "s1", "r1"}, f"expected p1/s1/r1 flagged, got {node_ids}"
