"""Screener run request/result contract (T-0025-2).

No committed HTTP/TS contract exists yet for this endpoint --
`HttpScreenerEvaluationPort` (EPIC-0026) doesn't exist anywhere in the repo,
so these are fresh Pydantic models, not a mirror of an existing TS type the
way `domain.models.screener` mirrors `conditions.ts`. Field names follow
`docs/design/screener-core/technical.md`'s `ScreenerRun` table and the
frontend's `toWireScreenerRun` snake_case expectations where an equivalent
already exists there, so EPIC-0026's HTTP port has a minimal-translation
target rather than a shape it has to reinvent.

`ScreenerRunResult` is one flat shape with `status` discriminating what the
rest of the fields mean -- mirrors `api/schemas/backtest.py`'s
`BacktestResultsResponse` convention ("one shape, status discriminates")
rather than a tagged Pydantic Union, matching this codebase's own
established pattern for "one endpoint, several outcomes":

- `'refused'`: a blocking `ValidationProblem` prevented execution (e.g. an
  empty-resolving universe, T-0025-2 AC3). No `matches`/`provenance`.
- `'valid'`: `dry_run=true` found no blocking problem (T-0025-2 AC2). Ran
  universe-narrowing and field-resolution, never evaluated the filter tree.
- `'complete'`: a real, executed run.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from domain.models.screener import FilterNode, UniverseSpec
from domain.models.similarity import InstrumentRef, MarketDataProvenance

# Bumped whenever the ranking/validation/evaluation-wiring rules in
# domain/screener_run_engine.py change -- provenance is decorative
# otherwise, same convention as domain/models/backtest.py's
# BACKTEST_ENGINE_VERSION.
SCREENER_ENGINE_VERSION = "1.0.0"

RankingDirection = Literal["asc", "desc"]


class RankingField(BaseModel):
    """One field a screener run ranks by. Carries only `field_id` (no
    params dict) -- see infra/panel_market_data.py's module-level note on
    why `field.price.change_pct`'s lookback is expressed as an id suffix
    rather than a params entry for exactly this reason."""

    field_id: str
    direction: RankingDirection = "desc"
    weight: float = 1.0


class RankingSpec(BaseModel):
    """Mirrors `docs/design/screener-core/technical.md`'s `RankingSpec`
    table. `normalization` documents the one normalization this engine
    implements (percentile-rank, `spec.md`'s Open Question 3 assumption) --
    carried as a field, not hardcoded, so a result states the basis it was
    ranked on rather than leaving it to be inferred."""

    fields: list[RankingField] = Field(default_factory=list)
    tie_break: RankingField | None = None
    normalization: str = "percentile_rank"


class ValidationProblem(BaseModel):
    """A machine-readable code plus a human-readable explanation -- never a
    bare string, so a caller can branch on `code` (`empty_universe`,
    `unrecognized_value`, `condition_not_evaluable`) without parsing prose.
    Mirrors `domain.models.backtest.BacktestWarning`'s shape, extended with
    the node/universe-criterion naming AC2 asks a dry_run problem to
    carry."""

    severity: Literal["blocking", "advisory"]
    code: str
    message: str
    node_ids: list[str] = Field(default_factory=list)
    universe_criteria: list[str] = Field(default_factory=list)


PROBLEM_EMPTY_UNIVERSE = "empty_universe"
PROBLEM_UNRECOGNIZED_VALUE = "unrecognized_value"
PROBLEM_CONDITION_NOT_EVALUABLE = "condition_not_evaluable"


class FilterNodeEvaluation(BaseModel):
    """One filter-tree node's evaluated state for one matched instrument
    (`docs/design/screener-core/technical.md`: "the evaluated value and
    pass/fail state of every enabled filter node keyed by node_id"). A
    group node has no single value to report -- `value` stays None for
    those, only leaf conditions populate it."""

    node_id: str
    passed: bool
    value: float | str | bool | None = None
    unit: str | None = None
    detail: str | None = None
    data_unavailable: bool = False


class ScreenerMatch(BaseModel):
    """One matched instrument, ranked. `instrument` reuses
    `domain.models.similarity.InstrumentRef` (T-0025-2 AC4's "id, symbol,
    exchange, asset type" shape already exists there) rather than inventing
    a second instrument-reference type."""

    instrument: InstrumentRef
    rank: int
    composite_score: float
    ranking_values: dict[str, float | None] = Field(default_factory=dict)
    node_evaluations: dict[str, FilterNodeEvaluation] = Field(default_factory=dict)


class ScreenerRunRequest(BaseModel):
    """`{universe, conditions, ranking, limit}` in, per the epic's stated
    contract shape. No caller-supplied `as_of`: T-0025-2 AC6/AC7's
    statelessness means every run always uses the loaded panel's own
    `as_of`, never a value the caller could get out of sync with."""

    universe: UniverseSpec
    filter_tree: FilterNode
    ranking: RankingSpec | None = None
    limit: int = 50
    dry_run: bool = False


class ScreenerRunResult(BaseModel):
    """The one shape `POST /screener/run` always returns -- see the module
    docstring for what each `status` means and which fields it populates."""

    status: Literal["complete", "refused", "valid"]
    as_of: date
    universe_count: int
    matched_count: int = 0
    returned_count: int = 0
    truncated: bool = False
    ranking_applied: bool = False
    matches: list[ScreenerMatch] = Field(default_factory=list)
    problems: list[ValidationProblem] = Field(default_factory=list)
    provenance: MarketDataProvenance | None = None
