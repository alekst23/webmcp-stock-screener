"""Lookahead-risk classification for a filter tree (T-1014-5 AC4/AC5).

Pure -- no port calls, no I/O. `field_class_of` is a plain callable the
engine builds once from `FundamentalsPort.field_ids()`; this module never
imports a Protocol, so its tests use bare functions instead of fake port
classes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from domain.models.screener import (
    Condition,
    ConditionNode,
    EventRelativeCondition,
    FieldClass,
    FilterNode,
    GroupNode,
    RangeCondition,
    RelativeCondition,
    ScalarCondition,
    SeriesComparisonCondition,
    TemporalCondition,
)

FieldClassifier = Callable[[str], FieldClass]

LOOKAHEAD_FUTURE_EVENT = "future_event_reference"
LOOKAHEAD_FUNDAMENTAL_FIELD = "fundamental_field_reference"


@dataclass(frozen=True)
class LookaheadFinding:
    """One condition node's lookahead exposure and how the engine handled
    it. `handling` is always stated in plain terms (AC4: "warns ... and
    states how it was handled"), never left implicit."""

    node_id: str
    code: str
    handling: str


@dataclass(frozen=True)
class LookaheadReport:
    findings: list[LookaheadFinding] = field(default_factory=list)

    @property
    def has_risk(self) -> bool:
        return bool(self.findings)


def classify_tree(root: FilterNode, field_class_of: FieldClassifier) -> LookaheadReport:
    """Walks every enabled node in the tree and collects a finding for
    each lookahead-exposed condition. Disabled nodes are not walked --
    they cannot affect a run's results, so flagging them would be noise."""
    findings: list[LookaheadFinding] = []
    _walk(root, field_class_of, findings)
    return LookaheadReport(findings=findings)


def _walk(node: FilterNode, field_class_of: FieldClassifier, out: list[LookaheadFinding]) -> None:
    if not node.enabled:
        return
    if isinstance(node, GroupNode):
        for child in node.children:
            _walk(child, field_class_of, out)
        return
    finding = classify_condition(node.node_id, node.condition, field_class_of)
    if finding is not None:
        out.append(finding)
    if isinstance(node.condition, TemporalCondition):
        inner = ConditionNode(node_id=node.node_id, condition=node.condition.condition)
        _walk(inner, field_class_of, out)


def classify_condition(
    node_id: str, condition: Condition, field_class_of: FieldClassifier
) -> LookaheadFinding | None:
    """Classifies one condition in isolation (no tree context) -- used
    directly by unit tests and by `_walk` for the tree traversal."""
    if isinstance(condition, EventRelativeCondition) and condition.direction == "future":
        return LookaheadFinding(
            node_id=node_id,
            code=LOOKAHEAD_FUTURE_EVENT,
            handling=(
                f"Condition references a future '{condition.event_type_id}' event, which is "
                "not knowable at a historical decision date unless already publicly "
                "announced. Evaluated on an explicit lag: only occurrences already known as "
                "of the decision date are counted."
            ),
        )
    field_id = _referenced_field_id(condition)
    if field_id is not None and field_class_of(field_id) == FieldClass.FUNDAMENTAL:
        return LookaheadFinding(
            node_id=node_id,
            code=LOOKAHEAD_FUNDAMENTAL_FIELD,
            handling=(
                f"Condition references fundamental field '{field_id}', which can be "
                "restated after the fact. Evaluated using only the figure as reported at "
                "or before the decision date, not any later restatement."
            ),
        )
    return None


def _referenced_field_id(condition: Condition) -> str | None:
    """The single catalog field ID a condition's *primary* operand names,
    for FUNDAMENTAL classification. `series_comparison` uses its left
    operand only -- the engine's per-side evaluation still resolves the
    right operand through the same fundamentals check at run time, this
    is a static, single-pass classification for the run-level warning
    list, not the full runtime guard."""
    if isinstance(condition, (ScalarCondition, RangeCondition, RelativeCondition)):
        return condition.field_id
    if isinstance(condition, SeriesComparisonCondition):
        return condition.left.catalog_id
    return None
