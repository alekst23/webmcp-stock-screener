"""Pandas/numpy-backed implementation of PatternResearchEngine (T-1001-3).

Per-day condition series are computed panel-wide via pandas groupby/rolling
(see `infra/expression.py`) rather than hand-rolled loops — this is why the
project chose Python/pandas over a hand-rolled TypeScript version (see
docs/plan.md's risk section). The exception is the temporal walk from one
step's resolution to the next: each step's window is defined *relative to
where the previous step resolved*, which is inherently sequential per
candidate anchor. That walk loops over a small number of candidate anchors
(places step 0 fired), not over the full panel.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal

import numpy as np
import pandas as pd

from domain.contracts.engine import SampleStrategy, SplitMode
from domain.models.instance import Instance, InstanceSet
from domain.models.measurement import InstanceWindow, MeasureResult
from domain.models.pattern import Setup, SetupStep, Study
from domain.models.price import PriceBar
from domain.models.universe import TickerMetadata
from infra.expression import BASE_FIELDS, ExpressionEvaluator, parse_expression

# Sparse-completed-matches fallback threshold (spec.md "Instance search").
_PARTIAL_FALLBACK_THRESHOLD = 5

_StepStatus = Literal["resolved", "failed", "partial"]


@dataclass(frozen=True)
class _StepOutcome:
    status: _StepStatus
    position: int | None  # resolved day_idx, only set when status == "resolved"


def bars_to_panel(bars: list[PriceBar]) -> pd.DataFrame:
    """Build the sorted, ticker-grouped DataFrame the engine operates on."""
    frame = pd.DataFrame([bar.model_dump() for bar in bars])
    frame["date"] = frame["date"].apply(
        lambda d: d if isinstance(d, date) else pd.Timestamp(d).date()
    )
    frame = frame.sort_values(["ticker", "date"]).reset_index(drop=True)
    return frame


class PandasPatternResearchEngine:
    """Infra-layer adapter over an in-memory OHLCV panel (mock today, real
    EODHD-backed later — same contract either way, per PatternResearchEngine)."""

    def __init__(
        self, panel: pd.DataFrame, universe: dict[str, TickerMetadata] | None = None
    ) -> None:
        self._panel = panel
        self._universe = universe or {}
        self._studies: dict[str, Study] = {}  # keyed by name — "referenceable by name"
        self._setups: dict[str, Setup] = {}
        self._next_id = 1

    @classmethod
    def from_price_bars(
        cls, bars: list[PriceBar], universe: dict[str, TickerMetadata] | None = None
    ) -> "PandasPatternResearchEngine":
        return cls(bars_to_panel(bars), universe)

    def _new_id(self, prefix: str) -> str:
        value = f"{prefix}_{self._next_id}"
        self._next_id += 1
        return value

    def _known_names(self) -> frozenset[str]:
        return BASE_FIELDS | {study.name for study in self._studies.values()}

    # ---- Study definition (AC1, AC2) ----

    def define_study(self, name: str, expression: str) -> Study:
        parse_expression(expression, self._known_names())  # raises ExpressionError
        study = Study(id=self._new_id("study"), name=name, expression=expression)
        self._studies[study.name] = study
        return study

    # ---- Setup definition (AC3) ----

    def define_setup(self, name: str | None, steps: list[SetupStep]) -> Setup:
        known = self._known_names()
        for step in steps:
            parse_expression(step.condition, known)
        setup = Setup(id=self._new_id("setup"), name=name, steps=steps)
        self._setups[setup.id] = setup
        return setup

    # ---- Instance search (AC4, AC5, AC6) ----

    def find_instances(
        self,
        setup: Setup,
        from_date: date | None = None,
        to_date: date | None = None,
        min_market_cap: float | None = None,
        sectors: list[str] | None = None,
    ) -> InstanceSet:
        panel = self._filter_universe(min_market_cap, sectors)
        search_from = from_date or panel["date"].min()
        search_to = to_date or panel["date"].max()

        study_expressions = {s.name: s.expression for s in self._studies.values()}
        evaluator = ExpressionEvaluator(panel, study_expressions)
        conditions = [evaluator.evaluate_condition(step.condition) for step in setup.steps]

        complete, partial = self._search_all_tickers(
            panel, setup.steps, conditions, search_from, search_to
        )
        include_partial = len(complete) < _PARTIAL_FALLBACK_THRESHOLD
        instances = complete + (partial if include_partial else [])
        instances.sort(key=lambda inst: (inst.date, inst.ticker))

        return InstanceSet(
            id=self._new_id("set"),
            setup_id=setup.id,
            instances=instances,
            complete_count=len(complete),
            partial_count=len(partial) if include_partial else 0,
            from_date=search_from,
            to_date=search_to,
        )

    def _filter_universe(
        self, min_market_cap: float | None, sectors: list[str] | None
    ) -> pd.DataFrame:
        if min_market_cap is None and sectors is None:
            return self._panel
        allowed = {
            ticker
            for ticker, meta in self._universe.items()
            if (min_market_cap is None or (meta.market_cap or 0) >= min_market_cap)
            and (sectors is None or meta.sector in sectors)
        }
        return self._panel[self._panel["ticker"].isin(allowed)]

    def _search_all_tickers(
        self,
        panel: pd.DataFrame,
        steps: list[SetupStep],
        conditions: list[pd.Series],
        search_from: date,
        search_to: date,
    ) -> tuple[list[Instance], list[Instance]]:
        complete: list[Instance] = []
        partial: list[Instance] = []
        for ticker, ticker_panel in panel.groupby("ticker", sort=False):
            positions = ticker_panel.index
            dates = ticker_panel["date"].to_numpy()
            local_conditions = [series.loc[positions].to_numpy() for series in conditions]
            anchors = np.flatnonzero(local_conditions[0])
            for anchor in anchors:
                if not (search_from <= dates[anchor] <= search_to):
                    continue
                self._record_anchor(
                    str(ticker), dates, local_conditions, steps, int(anchor), complete, partial
                )
        return complete, partial

    def _record_anchor(
        self,
        ticker: str,
        dates: np.ndarray,
        conditions: list[np.ndarray],
        steps: list[SetupStep],
        anchor: int,
        complete: list[Instance],
        partial: list[Instance],
    ) -> None:
        outcome = self._walk_anchor(conditions, steps, anchor, len(dates))
        if outcome is None:
            return
        status, position, steps_resolved = outcome
        if status == "resolved":
            complete.append(Instance(ticker=ticker, date=dates[position], completeness=1.0))
        else:
            fraction = steps_resolved / len(steps)
            partial.append(Instance(ticker=ticker, date=dates[position], completeness=fraction))

    def _walk_anchor(
        self, conditions: list[np.ndarray], steps: list[SetupStep], anchor: int, length: int
    ) -> tuple[Literal["resolved", "partial"], int, int] | None:
        """Sequentially resolves each step (after the anchor) relative to
        where the previous one resolved. Returns None on a decisive failure
        (this start never matches the pattern), or the furthest reached
        position with a status of "resolved" (full sequence completed) or
        "partial" (still possible, but the panel's trailing edge doesn't
        cover the next step's window yet)."""
        position = anchor
        for step_index in range(1, len(steps)):
            outcome = self._resolve_step(
                conditions[step_index], steps[step_index], position, length
            )
            if outcome.status == "failed":
                return None
            if outcome.status == "partial":
                return ("partial", position, step_index)
            assert outcome.position is not None
            position = outcome.position
        return ("resolved", position, len(steps))

    def _resolve_step(
        self, condition: np.ndarray, step: SetupStep, prev_position: int, length: int
    ) -> _StepOutcome:
        assert step.within is not None, "non-anchor step must declare a within window"
        window_start = prev_position + step.within[0]
        window_end = prev_position + step.within[1]
        if step.sustained:
            return self._resolve_sustained_step(condition, window_start, window_end, length)
        return self._resolve_first_true_step(condition, window_start, window_end, length)

    def _resolve_sustained_step(
        self, condition: np.ndarray, window_start: int, window_end: int, length: int
    ) -> _StepOutcome:
        """Requires `condition` true on every day of [window_start, window_end].
        Resolves (if satisfied) at window_end — the step isn't fully
        confirmed until its last required day is checked."""
        available_end = min(window_end, length - 1)
        if window_start > available_end:
            return _StepOutcome("partial", None)  # window hasn't started yet in loaded data
        if not condition[window_start : available_end + 1].all():
            return _StepOutcome("failed", None)
        if available_end < window_end:
            return _StepOutcome("partial", None)  # held so far; window not fully in range yet
        return _StepOutcome("resolved", window_end)

    def _resolve_first_true_step(
        self, condition: np.ndarray, window_start: int, window_end: int, length: int
    ) -> _StepOutcome:
        """Requires `condition` true on at least one day of the window.
        Resolves at the EARLIEST such day (AC: only the earliest valid
        completion counts for one start)."""
        available_end = min(window_end, length - 1)
        if window_start <= available_end:
            segment = condition[window_start : available_end + 1]
            true_offsets = np.flatnonzero(segment)
            if len(true_offsets):
                return _StepOutcome("resolved", window_start + int(true_offsets[0]))
        if window_end > available_end:
            return _StepOutcome("partial", None)
        return _StepOutcome("failed", None)

    # ---- Delivered by T-1001-4 (depends on this ticket) ----

    def sample_instances(
        self,
        instance_set: InstanceSet,
        n: int = 12,
        strategy: SampleStrategy = "recent",
        horizon_days: int | None = None,
    ) -> list[Instance]:
        raise NotImplementedError("delivered by T-1001-4")

    def measure(
        self,
        instance_set: InstanceSet,
        horizon_days: int,
        metric: str | None = None,
        compare_to_base_rate: bool = True,
    ) -> MeasureResult:
        raise NotImplementedError("delivered by T-1001-4")

    def split_instances(
        self,
        instance_set: InstanceSet,
        mode: SplitMode,
        expression: str | None = None,
        horizon_days: int | None = None,
        threshold: float | None = None,
    ) -> list[InstanceSet]:
        raise NotImplementedError("delivered by T-1001-4")

    def get_instance_windows(
        self,
        instance_set: InstanceSet,
        n: int = 12,
        strategy: SampleStrategy = "recent",
        window: tuple[int, int] = (-20, 20),
    ) -> list[InstanceWindow]:
        raise NotImplementedError("delivered by T-1001-4")
