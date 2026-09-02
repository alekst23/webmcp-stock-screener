from domain.lookahead import (
    LOOKAHEAD_FUNDAMENTAL_FIELD,
    LOOKAHEAD_FUTURE_EVENT,
    classify_condition,
    classify_tree,
)
from domain.models.screener import (
    ConditionNode,
    EventRelativeCondition,
    FieldClass,
    GroupNode,
    RangeCondition,
    RelativeCondition,
    ScalarCondition,
    TemporalCondition,
)

_FUNDAMENTAL_FIELDS = {"revenue_growth", "eps"}


def _field_class_of(field_id: str) -> FieldClass:
    return FieldClass.FUNDAMENTAL if field_id in _FUNDAMENTAL_FIELDS else FieldClass.PRICE


class TestClassifyCondition:
    def test_future_event_relative_is_flagged(self) -> None:
        condition = EventRelativeCondition(
            event_type_id="earnings", direction="future", window_days=5
        )

        finding = classify_condition("n1", condition, _field_class_of)

        assert finding is not None, "a future-direction event_relative condition must be flagged"
        assert (
            finding.code == LOOKAHEAD_FUTURE_EVENT
        ), f"expected future-event code, got {finding.code}"
        assert (
            "lag" in finding.handling.lower()
        ), f"handling text must state the lag was applied, got: {finding.handling!r}"

    def test_past_event_relative_is_not_flagged(self) -> None:
        condition = EventRelativeCondition(
            event_type_id="earnings", direction="past", window_days=5
        )

        finding = classify_condition("n1", condition, _field_class_of)

        assert (
            finding is None
        ), "a past-direction event_relative condition carries no lookahead risk"

    def test_fundamental_field_is_flagged(self) -> None:
        condition = ScalarCondition(
            field_id="revenue_growth", operator="op.greater_than", value=0.1
        )

        finding = classify_condition("n1", condition, _field_class_of)

        assert finding is not None, "a condition on a fundamentals-class field must be flagged"
        assert (
            finding.code == LOOKAHEAD_FUNDAMENTAL_FIELD
        ), f"expected fundamental code, got {finding.code}"

    def test_price_field_is_not_flagged(self) -> None:
        condition = ScalarCondition(field_id="close", operator="op.greater_than", value=100.0)

        finding = classify_condition("n1", condition, _field_class_of)

        assert finding is None, "a condition on a price-class field carries no lookahead risk"

    def test_range_condition_on_fundamental_field_is_flagged(self) -> None:
        condition = RangeCondition(field_id="eps", lower=0.0, upper=5.0)

        finding = classify_condition("n1", condition, _field_class_of)

        assert finding is not None, "a range condition on a fundamentals field must be flagged"
        assert finding.code == LOOKAHEAD_FUNDAMENTAL_FIELD

    def test_relative_condition_on_fundamental_field_is_flagged(self) -> None:
        from domain.models.screener import OwnMovingAverageBaseline

        condition = RelativeCondition(
            field_id="revenue_growth",
            baseline=OwnMovingAverageBaseline(window_bars=4),
            multiple=1.0,
            operator="op.greater_than",
        )

        finding = classify_condition("n1", condition, _field_class_of)

        assert finding is not None
        assert finding.code == LOOKAHEAD_FUNDAMENTAL_FIELD


class TestClassifyTree:
    def test_recurses_into_temporal_inner_condition(self) -> None:
        inner = ScalarCondition(field_id="eps", operator="op.greater_than", value=1.0)
        temporal = TemporalCondition(
            condition=inner, event="became_true", within_bars=5, interval_id="1d"
        )
        root = GroupNode(
            node_id="root",
            op="and",
            children=[ConditionNode(node_id="n1", condition=temporal)],
        )

        report = classify_tree(root, _field_class_of)

        assert report.has_risk, "the inner fundamentals condition must surface through temporal"
        assert [f.code for f in report.findings] == [LOOKAHEAD_FUNDAMENTAL_FIELD]

    def test_disabled_nodes_are_not_walked(self) -> None:
        condition = ScalarCondition(
            field_id="revenue_growth", operator="op.greater_than", value=0.1
        )
        root = GroupNode(
            node_id="root",
            op="and",
            children=[ConditionNode(node_id="n1", condition=condition, enabled=False)],
        )

        report = classify_tree(root, _field_class_of)

        assert not report.has_risk, "a disabled node cannot affect a run, so it produces no finding"

    def test_clean_tree_has_no_findings(self) -> None:
        condition = ScalarCondition(field_id="close", operator="op.greater_than", value=10.0)
        root = GroupNode(
            node_id="root", op="and", children=[ConditionNode(node_id="n1", condition=condition)]
        )

        report = classify_tree(root, _field_class_of)

        assert report.findings == [], f"expected no findings, got {report.findings}"
        assert not report.has_risk
