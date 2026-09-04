"""Python-side mirror of the screener filter tree (EPIC-1009).

EPIC-1009 is implemented entirely in browser-side TypeScript
(`src/lib/screener/definition.ts`, `conditions.ts`) -- its own ticket docs
say so explicitly. No Python-side screener model exists anywhere in
`backend/` before this file. This module is a field-for-field mirror of
`conditions.ts`'s eight condition variants (same variant names, same
fields, snake_cased) so a later ticket can losslessly translate a TS
`ScreenerDefinition` into this shape when it builds the HTTP boundary --
the same relationship `domain/models/similarity.py` has with
`src/lib/workbench/similarity/domain/contract.ts`.

`FieldClass` has no TS counterpart: TS never evaluates a filter tree
against history, so it has never needed to know whether a field is
price-derived, a reported fundamental, or event/calendar data. This
engine does, for lookahead and point-in-time-correctness handling
(see domain/lookahead.py).
"""

from __future__ import annotations

from enum import Enum
from typing import Literal, Union

from pydantic import BaseModel, Field

ComparisonValue = Union[float, str, bool]


class FieldClass(str, Enum):
    """What kind of data a catalog field ID resolves to, for lookahead and
    point-in-time purposes. PRICE covers raw OHLCV fields and any
    price-derived study (a moving average is always knowable as of its own
    bar's date -- there is no restatement risk in a closing price).
    FUNDAMENTAL covers reported company figures, which can be restated
    after the fact. EVENT covers calendar/event data (earnings dates and
    similar), where a *future* occurrence is not knowable at a historical
    decision date unless the event was already announced."""

    PRICE = "price"
    FUNDAMENTAL = "fundamental"
    EVENT = "event"


class SeriesRef(BaseModel):
    """A named series (a catalog field or study ID) plus its parameters --
    mirrors conditions.ts's `SeriesRef`. Never a free-form expression."""

    catalog_id: str
    params: dict[str, ComparisonValue] = Field(default_factory=dict)


class ScalarCondition(BaseModel):
    """`field_id` compared against a literal value. Mirrors
    conditions.ts's `ScalarCondition`."""

    type: Literal["scalar"] = "scalar"
    field_id: str
    operator: str
    value: ComparisonValue
    unit: str | None = None


class RangeCondition(BaseModel):
    """`field_id` within [lower, upper]. Mirrors conditions.ts's
    `RangeCondition`."""

    type: Literal["range"] = "range"
    field_id: str
    lower: float
    upper: float
    lower_inclusive: bool = True
    upper_inclusive: bool = True


class SeriesComparisonCondition(BaseModel):
    """One series compared against another (e.g. close vs. its own 20-day
    average). Mirrors conditions.ts's `SeriesComparisonCondition`."""

    type: Literal["series_comparison"] = "series_comparison"
    left: SeriesRef
    right: SeriesRef
    operator: str


TemporalEvent = Literal["crossed_above", "crossed_below", "became_true"]


class TemporalCondition(BaseModel):
    """Wraps an inner condition with a "this happened within N bars"
    requirement. The only recursive variant -- mirrors conditions.ts's
    `TemporalCondition`."""

    type: Literal["temporal"] = "temporal"
    condition: "Condition"
    event: TemporalEvent
    within_bars: int
    interval_id: str


EventRelativeDirection = Literal["past", "future"]


class EventRelativeCondition(BaseModel):
    """A condition relative to a dated event (e.g. "within 5 days of
    earnings"). `direction="future"` is the ticket's central lookahead
    example: referencing an event that has not yet happened, and may not
    yet have been publicly knowable, at the historical decision date.
    Mirrors conditions.ts's `EventRelativeCondition`."""

    type: Literal["event_relative"] = "event_relative"
    event_type_id: str
    direction: EventRelativeDirection
    window_days: int


class PatternCondition(BaseModel):
    """Chart-pattern match with a minimum confidence. Mirrors
    conditions.ts's `PatternCondition`. Evaluation requires the TS-only
    pattern-recognition catalog -- see domain/filter_evaluation.py, which
    reports this family as not evaluable rather than fabricating a
    match."""

    type: Literal["pattern"] = "pattern"
    pattern_id: str
    min_confidence: float
    interval_id: str


class OwnMovingAverageBaseline(BaseModel):
    kind: Literal["own_moving_average"] = "own_moving_average"
    window_bars: int


class PeerGroupBaseline(BaseModel):
    kind: Literal["peer_group"] = "peer_group"
    group_id: str


class IndexBaseline(BaseModel):
    kind: Literal["index"] = "index"
    index_id: str


RelativeBaseline = Union[OwnMovingAverageBaseline, PeerGroupBaseline, IndexBaseline]


class RelativeCondition(BaseModel):
    """`field_id` compared against `multiple` times a baseline. Mirrors
    conditions.ts's `RelativeCondition`. Only the `own_moving_average`
    baseline is evaluable here (see filter_evaluation.py) -- peer-group and
    index baselines need ports this project has no source for yet."""

    type: Literal["relative"] = "relative"
    field_id: str
    baseline: RelativeBaseline
    multiple: float
    operator: str


class StudyOutputCondition(BaseModel):
    """A named output of a (possibly custom) study compared via a
    predicate. Mirrors conditions.ts's `StudyOutputCondition`. Evaluation
    requires the TS-only custom-study engine -- reported as not evaluable,
    same as `pattern`."""

    type: Literal["study_output"] = "study_output"
    study_id: str
    params: dict[str, ComparisonValue] = Field(default_factory=dict)
    output_name: str
    predicate: str


Condition = Union[
    ScalarCondition,
    RangeCondition,
    SeriesComparisonCondition,
    TemporalCondition,
    EventRelativeCondition,
    PatternCondition,
    RelativeCondition,
    StudyOutputCondition,
]

TemporalCondition.model_rebuild()


class ConditionNode(BaseModel):
    node_id: str
    kind: Literal["condition"] = "condition"
    condition: Condition = Field(discriminator="type")
    enabled: bool = True


class GroupNode(BaseModel):
    node_id: str
    kind: Literal["group"] = "group"
    op: Literal["and", "or", "not"]
    children: list["FilterNode"] = Field(default_factory=list)
    enabled: bool = True


FilterNode = Union[GroupNode, ConditionNode]

GroupNode.model_rebuild()


class UniverseSpec(BaseModel):
    """The set of instruments a backtest or a screener run walks.
    Deliberately smaller than TS's `UniverseSpec` (no industries/indexes/
    exchanges -- nothing on the Python side classifies those yet); extending
    it is additive and does not require touching the engine's evaluation
    logic.

    `tickers=None` means "resolved by the reference-data port from the
    other fields, as of each rebalance date" -- the mechanism that makes
    the survivorship statement (AC2) describe real, point-in-time
    membership rather than today's membership applied retroactively.

    `sectors` (T-0025-1): an any-of inclusion filter against the loaded
    Nasdaq-screener metadata's sector classification
    (`domain.models.universe.TickerMetadata.sector`). Like `min_market_cap`,
    this is resolved by `infra.panel_market_data.PanelReferenceDataPort`,
    not evaluated here -- this module only carries the shape.
    """

    universe_id: str
    label: str
    tickers: list[str] | None = None
    sectors: list[str] | None = None
    min_price: float | None = None
    min_avg_volume: float | None = None
    min_market_cap: float | None = None
    excluded_tickers: list[str] = Field(default_factory=list)
