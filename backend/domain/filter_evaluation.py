"""Pure per-condition filter-tree evaluation (T-1014-5).

`FieldResolver` is a small dataclass of plain callables, not a Protocol --
the engine builds one per run from the three market-data ports, already
routing each field to the price or fundamentals source and applying
point-in-time filtering internally (AC5). This module never imports a
Protocol or a port, so its own tests use bare lambdas.

Returns `bool | None` throughout: `None` means "not evaluable with the
data available" -- `pattern`/`study_output` conditions (no TS-only
catalog to evaluate against), a `relative` condition with a `peer_group`/
`index` baseline (no such port exists), or an unrecognized operator. A
group folds `None` children as "does not pass" (fails closed) rather than
raising or silently treating them as true -- see `evaluate_condition`'s
group-folding rules below.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Callable

from domain.models.screener import (
    ComparisonValue,
    Condition,
    ConditionNode,
    EventRelativeCondition,
    FilterNode,
    GroupNode,
    OwnMovingAverageBaseline,
    PatternCondition,
    RangeCondition,
    RelativeCondition,
    ScalarCondition,
    SeriesComparisonCondition,
    StudyOutputCondition,
    TemporalCondition,
)

FieldParams = dict[str, ComparisonValue]

# ticker, catalog_id, params, as_of -> value known as of that date, or None
ValueAt = Callable[[str, str, FieldParams, date], "float | None"]
# ticker, catalog_id, params, as_of, window_bars -> trailing average, or None
AverageAt = Callable[[str, str, FieldParams, date, int], "float | None"]
# ticker, event_type_id, as_of, direction, window_days -> occurred, or None if unsupported
EventOccurred = Callable[[str, str, date, str, int], "bool | None"]
# ticker, as_of, n -> ascending session dates ending at (or before) as_of
RecentSessions = Callable[[str, date, int], list[date]]


@dataclass(frozen=True)
class FieldResolver:
    value_at: ValueAt
    average_at: AverageAt
    event_occurred: EventOccurred
    recent_sessions: RecentSessions


_COMPARATORS: dict[str, Callable[[float, float], bool]] = {
    "op.greater_than": lambda a, b: a > b,
    "op.less_than": lambda a, b: a < b,
    "op.greater_equal": lambda a, b: a >= b,
    "op.less_equal": lambda a, b: a <= b,
    "op.equals": lambda a, b: a == b,
    "op.not_equals": lambda a, b: a != b,
}


def _as_float(value: object) -> float | None:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    return None


def find_unevaluable_conditions(root: FilterNode) -> list[str]:
    """Static (data-independent) scan for conditions that can never be
    evaluated through the available ports -- `pattern`/`study_output`, and
    a `relative` condition with a `peer_group`/`index` baseline. Used by
    the engine to build an up-front warning naming the affected node IDs,
    rather than discovering the gap silently on every date walked."""
    found: list[str] = []
    _scan(root, found)
    return found


def _scan(node: FilterNode, out: list[str]) -> None:
    if isinstance(node, GroupNode):
        for child in node.children:
            _scan(child, out)
        return
    condition = node.condition
    if isinstance(condition, (PatternCondition, StudyOutputCondition)):
        out.append(node.node_id)
    elif isinstance(condition, RelativeCondition) and not isinstance(
        condition.baseline, OwnMovingAverageBaseline
    ):
        out.append(node.node_id)
    elif isinstance(condition, TemporalCondition):
        _scan(ConditionNode(node_id=node.node_id, condition=condition.condition), out)


def evaluate_node(node: FilterNode, ticker: str, as_of: date, resolver: FieldResolver) -> bool:
    """Evaluates a whole (sub)tree. A disabled group/condition node is
    skipped -- treated as absent, not as failing -- matching the editing
    tools' "enabled flag" semantics. `None` (not evaluable) folds to
    `False` at every level: a condition this engine cannot evaluate never
    silently passes a screen."""
    if not node.enabled:
        return True
    if isinstance(node, GroupNode):
        return _evaluate_group(node, ticker, as_of, resolver)
    result = evaluate_condition(node.condition, ticker, as_of, resolver)
    return bool(result)


def _evaluate_group(node: GroupNode, ticker: str, as_of: date, resolver: FieldResolver) -> bool:
    enabled_children = [c for c in node.children if c.enabled]
    if node.op == "not":
        # T-1009-1's arity rule: a well-formed `not` group holds exactly one
        # child. An empty/over-populated group (should not occur once
        # upstream normalization runs) evaluates to False rather than
        # guessing which child was intended.
        if len(enabled_children) != 1:
            return False
        return not evaluate_node(enabled_children[0], ticker, as_of, resolver)
    results = [evaluate_node(child, ticker, as_of, resolver) for child in enabled_children]
    if node.op == "and":
        return all(results) if results else True
    if node.op == "or":
        return any(results) if results else False
    return False


def evaluate_condition(
    condition: Condition, ticker: str, as_of: date, resolver: FieldResolver
) -> bool | None:
    """Evaluates one condition node in isolation. `None` means "not
    evaluable" -- callers that need a definite pass/fail (group folding)
    treat that as False; callers building diagnostics (the engine's
    warning list) can report it distinctly."""
    if isinstance(condition, ScalarCondition):
        return _evaluate_scalar(condition, ticker, as_of, resolver)
    if isinstance(condition, RangeCondition):
        return _evaluate_range(condition, ticker, as_of, resolver)
    if isinstance(condition, SeriesComparisonCondition):
        return _evaluate_series_comparison(condition, ticker, as_of, resolver)
    if isinstance(condition, RelativeCondition):
        return _evaluate_relative(condition, ticker, as_of, resolver)
    if isinstance(condition, TemporalCondition):
        return _evaluate_temporal(condition, ticker, as_of, resolver)
    if isinstance(condition, EventRelativeCondition):
        return resolver.event_occurred(
            ticker, condition.event_type_id, as_of, condition.direction, condition.window_days
        )
    if isinstance(condition, (PatternCondition, StudyOutputCondition)):
        return None  # requires the TS-only catalog's pattern/study engine
    return None


def _evaluate_scalar(
    condition: ScalarCondition, ticker: str, as_of: date, resolver: FieldResolver
) -> bool | None:
    comparator = _COMPARATORS.get(condition.operator)
    target = _as_float(condition.value)
    if comparator is None or target is None:
        return None
    observed = resolver.value_at(ticker, condition.field_id, {}, as_of)
    if observed is None:
        return None
    return comparator(observed, target)


def _evaluate_range(
    condition: RangeCondition, ticker: str, as_of: date, resolver: FieldResolver
) -> bool | None:
    observed = resolver.value_at(ticker, condition.field_id, {}, as_of)
    if observed is None:
        return None
    lower_ok = (
        observed >= condition.lower if condition.lower_inclusive else observed > condition.lower
    )
    upper_ok = (
        observed <= condition.upper if condition.upper_inclusive else observed < condition.upper
    )
    return lower_ok and upper_ok


def _evaluate_series_comparison(
    condition: SeriesComparisonCondition, ticker: str, as_of: date, resolver: FieldResolver
) -> bool | None:
    comparator = _COMPARATORS.get(condition.operator)
    if comparator is None:
        return None
    left = resolver.value_at(ticker, condition.left.catalog_id, condition.left.params, as_of)
    right = resolver.value_at(ticker, condition.right.catalog_id, condition.right.params, as_of)
    if left is None or right is None:
        return None
    return comparator(left, right)


def _evaluate_relative(
    condition: RelativeCondition, ticker: str, as_of: date, resolver: FieldResolver
) -> bool | None:
    if not isinstance(condition.baseline, OwnMovingAverageBaseline):
        return None  # peer_group / index baselines need ports this project has no source for
    comparator = _COMPARATORS.get(condition.operator)
    if comparator is None:
        return None
    observed = resolver.value_at(ticker, condition.field_id, {}, as_of)
    baseline = resolver.average_at(
        ticker, condition.field_id, {}, as_of, condition.baseline.window_bars
    )
    if observed is None or baseline is None:
        return None
    return comparator(observed, baseline * condition.multiple)


def _evaluate_temporal(
    condition: TemporalCondition, ticker: str, as_of: date, resolver: FieldResolver
) -> bool | None:
    """ "Occurred within N bars" -- walks the last `within_bars + 1`
    sessions (ascending) evaluating the inner condition at each, and looks
    for the requested transition: `crossed_above`/`became_true` is a
    False-to-True edge, `crossed_below` is a True-to-False edge. A
    simplification (documented in the ticket's Solution Approach): TS
    models temporal crossings over arbitrary series, this engine detects
    them as boolean-predicate edges, which is exact for a predicate that
    is itself a crossing (e.g. "close > sma_20") and an approximation for
    others."""
    sessions = resolver.recent_sessions(ticker, as_of, condition.within_bars + 1)
    if not sessions:
        return None
    previous: bool | None = None
    for session_date in sessions:
        current = evaluate_condition(condition.condition, ticker, session_date, resolver)
        if current is None:
            return None
        if previous is not None:
            if condition.event in ("crossed_above", "became_true") and current and not previous:
                return True
            if condition.event == "crossed_below" and not current and previous:
                return True
        previous = current
    return False
