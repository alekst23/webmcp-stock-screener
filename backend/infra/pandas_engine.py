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

import random
from dataclasses import dataclass
from datetime import date
from typing import Literal

import numpy as np
import pandas as pd

from domain.contracts.engine import SampleStrategy, SplitMode
from domain.models.instance import Instance, InstanceSet
from domain.models.measurement import BaseRateResult, InstanceWindow, MeasureResult
from domain.models.pattern import Setup, SetupStep, Study
from domain.models.price import PriceBar
from domain.models.universe import TickerMetadata
from infra.expression import BASE_FIELDS, ExpressionEvaluator, parse_expression
from infra.panel_frame import PanelFrame

# Sparse-completed-matches fallback threshold (spec.md "Instance search").
_PARTIAL_FALLBACK_THRESHOLD = 5

# Base rate (AC3) is computed over a random sample of the whole panel's
# anchor points rather than every row, so measure() stays fast even on a
# large real-data panel; 500 draws is plenty to stabilize median/hit-rate.
_BASE_RATE_SAMPLE_SIZE = 500

_StepStatus = Literal["resolved", "failed", "partial"]


@dataclass(frozen=True)
class _StepOutcome:
    status: _StepStatus
    position: int | None  # resolved day_idx, only set when status == "resolved"


def _min_date(frame: pd.DataFrame) -> date:
    """Earliest date in a (possibly universe-filtered) view of the panel.

    The `date` column holds ordinals, not date objects -- see
    infra/panel_frame.py for why.
    """
    return date.fromordinal(int(frame["date"].min()))


def _max_date(frame: pd.DataFrame) -> date:
    return date.fromordinal(int(frame["date"].max()))


class PandasPatternResearchEngine:
    """Infra-layer adapter over an in-memory OHLCV panel (mock today, real
    EODHD-backed later — same contract either way, per PatternResearchEngine)."""

    def __init__(
        self, panel: PanelFrame, universe: dict[str, TickerMetadata] | None = None
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
        return cls(PanelFrame.from_bars(bars), universe)

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
        search_from = from_date or _min_date(panel)
        search_to = to_date or _max_date(panel)

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
        frame = self._panel.frame
        if min_market_cap is None and sectors is None:
            return frame
        allowed = {
            ticker
            for ticker, meta in self._universe.items()
            if (min_market_cap is None or (meta.market_cap or 0) >= min_market_cap)
            and (sectors is None or meta.sector in sectors)
        }
        return frame[frame["ticker"].isin(allowed)]

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
        from_code, to_code = search_from.toordinal(), search_to.toordinal()
        # observed=True: `ticker` is a categorical over the whole universe, so
        # a universe-filtered panel would otherwise yield an empty group per
        # excluded ticker.
        for ticker, ticker_panel in panel.groupby("ticker", sort=False, observed=True):
            positions = ticker_panel.index
            # Date ordinals, compared as integers and decoded only for the
            # handful of rows that actually become instances -- decoding every
            # row would allocate one date object per ticker-day.
            date_codes = ticker_panel["date"].to_numpy()
            local_conditions = [series.loc[positions].to_numpy() for series in conditions]
            anchors = np.flatnonzero(local_conditions[0])
            for anchor in anchors:
                if not (from_code <= date_codes[anchor] <= to_code):
                    continue
                self._record_anchor(
                    str(ticker), date_codes, local_conditions, steps, int(anchor), complete, partial
                )
        return complete, partial

    def _record_anchor(
        self,
        ticker: str,
        date_codes: np.ndarray,
        conditions: list[np.ndarray],
        steps: list[SetupStep],
        anchor: int,
        complete: list[Instance],
        partial: list[Instance],
    ) -> None:
        outcome = self._walk_anchor(conditions, steps, anchor, len(date_codes))
        if outcome is None:
            return
        status, position, steps_resolved = outcome
        on_date = date.fromordinal(int(date_codes[position]))
        if status == "resolved":
            complete.append(Instance(ticker=ticker, date=on_date, completeness=1.0))
        else:
            fraction = steps_resolved / len(steps)
            partial.append(Instance(ticker=ticker, date=on_date, completeness=fraction))

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

    # ---- Instance sampling (AC1) ----

    def sample_instances(
        self,
        instance_set: InstanceSet,
        n: int = 12,
        strategy: SampleStrategy = "recent",
        horizon_days: int | None = None,
    ) -> list[Instance]:
        if strategy == "recent":
            return sorted(instance_set.instances, key=lambda inst: inst.date, reverse=True)[:n]
        if strategy == "random":
            return random.sample(instance_set.instances, min(n, len(instance_set.instances)))
        if strategy in ("best", "worst"):
            if horizon_days is None:
                raise ValueError(f'sample strategy "{strategy}" requires horizon_days')
            return self._sample_by_forward_return(instance_set.instances, n, horizon_days, strategy)
        raise ValueError(f'unknown sample strategy "{strategy}"')

    def _sample_by_forward_return(
        self, instances: list[Instance], n: int, horizon_days: int, strategy: SampleStrategy
    ) -> list[Instance]:
        """Ranks by forward return, silently dropping instances whose return
        isn't computable yet (e.g. too close to the panel's trailing edge) —
        there's nothing to rank them by."""
        scored: list[tuple[float, Instance]] = []
        for inst in instances:
            ret = self._forward_return(inst.ticker, inst.date, horizon_days)
            if ret is not None:
                scored.append((ret, inst))
        scored.sort(key=lambda pair: pair[0], reverse=(strategy == "best"))
        return [inst for _, inst in scored[:n]]

    # ---- Outcome measurement (AC2, AC3) ----

    def measure(
        self,
        instance_set: InstanceSet,
        horizon_days: int,
        metric: str | None = None,
        compare_to_base_rate: bool = True,
    ) -> MeasureResult:
        # `metric` is a display label only — the only metric this engine
        # currently computes is closing-price forward return (spec.md gives
        # no other concrete metric definition to implement against).
        resolved = [inst for inst in instance_set.instances if inst.completeness >= 1.0]
        excluded_partial = len(instance_set.instances) - len(resolved)
        pairs = [(inst.ticker, inst.date) for inst in resolved]
        count, median, mean, hit_rate = self._summarize_returns(
            self._forward_returns(pairs, horizon_days)
        )
        base_rate = (
            self._compute_base_rate(instance_set, horizon_days) if compare_to_base_rate else None
        )
        return MeasureResult(
            metric=metric or "forward_return",
            horizon_days=horizon_days,
            count=count,
            median=median,
            mean=mean,
            hit_rate=hit_rate,
            base_rate=base_rate,
            excluded_partial_count=excluded_partial if excluded_partial > 0 else None,
        )

    def _compute_base_rate(self, instance_set: InstanceSet, horizon_days: int) -> BaseRateResult:
        pairs = self._broad_anchor_sample(instance_set.from_date, instance_set.to_date)
        _, median, _, hit_rate = self._summarize_returns(self._forward_returns(pairs, horizon_days))
        return BaseRateResult(median=median, hit_rate=hit_rate)

    def _broad_anchor_sample(self, from_date: date, to_date: date) -> list[tuple[str, date]]:
        """A broad, unbiased sample of (ticker, date) anchor points from the
        whole panel over the same period — NOT filtered to the setup's own
        instances, so it represents the base rate (AC3)."""
        return self._panel.anchor_sample(from_date, to_date, _BASE_RATE_SAMPLE_SIZE)

    def _forward_returns(self, pairs: list[tuple[str, date]], horizon_days: int) -> list[float]:
        returns = []
        for ticker, on_date in pairs:
            value = self._forward_return(ticker, on_date, horizon_days)
            if value is not None:
                returns.append(value)
        return returns

    def _summarize_returns(self, returns: list[float]) -> tuple[int, float, float, float]:
        if not returns:
            return 0, 0.0, 0.0, 0.0
        arr = np.array(returns, dtype=float)
        return len(arr), float(np.median(arr)), float(np.mean(arr)), float((arr > 0).mean())

    def _forward_return(self, ticker: str, on_date: date, horizon_days: int) -> float | None:
        """(close[i + horizon_days] - close[i]) / close[i], where i is
        `on_date`'s row position within `ticker`'s own sorted rows. None if
        `on_date` isn't found or the horizon runs past that ticker's edge."""
        bounds = self._panel.bounds(ticker)
        anchor = self._panel.row_position(ticker, on_date)
        if bounds is None or anchor is None:
            return None
        start, stop = bounds
        target = anchor + horizon_days
        if target < start or target >= stop:
            return None
        close0 = self._panel.close_at(anchor)
        if close0 == 0:
            return None
        return (self._panel.close_at(target) - close0) / close0

    # ---- Instance splitting (AC4) ----

    def split_instances(
        self,
        instance_set: InstanceSet,
        mode: SplitMode,
        expression: str | None = None,
        horizon_days: int | None = None,
        threshold: float | None = None,
    ) -> list[InstanceSet]:
        if mode == "outcome":
            if horizon_days is None:
                raise ValueError('split mode "outcome" requires horizon_days')
            return self._split_by_outcome(instance_set, horizon_days, threshold or 0.0)
        if mode == "condition":
            if expression is None:
                raise ValueError('split mode "condition" requires expression')
            return self._split_by_condition(instance_set, expression)
        raise ValueError(f'unknown split mode "{mode}"')

    def _split_by_outcome(
        self, instance_set: InstanceSet, horizon_days: int, threshold: float
    ) -> list[InstanceSet]:
        winners: list[Instance] = []
        losers: list[Instance] = []
        for inst in instance_set.instances:
            if inst.completeness < 1.0:
                continue  # no resolved forward return to classify by yet
            ret = self._forward_return(inst.ticker, inst.date, horizon_days)
            if ret is None:
                continue
            (winners if ret > threshold else losers).append(inst)
        return [
            self._child_set(instance_set, winners, "winners"),
            self._child_set(instance_set, losers, "losers"),
        ]

    def _split_by_condition(self, instance_set: InstanceSet, expression: str) -> list[InstanceSet]:
        study_expressions = {s.name: s.expression for s in self._studies.values()}
        evaluator = ExpressionEvaluator(self._panel.frame, study_expressions)
        condition = evaluator.evaluate_condition(expression)
        true_group: list[Instance] = []
        false_group: list[Instance] = []
        for inst in instance_set.instances:
            at_anchor = self._condition_at(condition, inst.ticker, inst.date)
            (true_group if at_anchor else false_group).append(inst)
        return [
            self._child_set(instance_set, true_group, f"{expression}: true"),
            self._child_set(instance_set, false_group, f"{expression}: false"),
        ]

    def _condition_at(self, condition: pd.Series, ticker: str, on_date: date) -> bool:
        position = self._panel.row_position(ticker, on_date)
        if position is None:
            return False
        return bool(condition.iloc[position])

    def _child_set(self, parent: InstanceSet, instances: list[Instance], label: str) -> InstanceSet:
        return InstanceSet(
            id=self._new_id("set"),
            setup_id=parent.setup_id,
            instances=instances,
            complete_count=sum(1 for inst in instances if inst.completeness >= 1.0),
            partial_count=sum(1 for inst in instances if inst.completeness < 1.0),
            from_date=parent.from_date,
            to_date=parent.to_date,
            parent_id=parent.id,
            label=label,
        )

    # ---- Grid visualization data (AC5) ----

    def get_instance_windows(
        self,
        instance_set: InstanceSet,
        n: int = 12,
        strategy: SampleStrategy = "recent",
        window: tuple[int, int] = (-20, 20),
    ) -> list[InstanceWindow]:
        sampled = self.sample_instances(instance_set, n=n, strategy=strategy)
        return [self._instance_window(inst, window) for inst in sampled]

    def _instance_window(self, instance: Instance, window: tuple[int, int]) -> InstanceWindow:
        bounds = self._panel.bounds(instance.ticker)
        anchor = self._panel.row_position(instance.ticker, instance.date)
        if bounds is None or anchor is None:
            return InstanceWindow(ticker=instance.ticker, bars=[])
        ticker_start, ticker_stop = bounds
        # Clip to this ticker's own edges rather than erroring — a shorter
        # window for one edge instance shouldn't fail the whole grid.
        start = max(ticker_start, anchor + window[0])
        end = min(ticker_stop - 1, anchor + window[1])
        bars = [self._panel.bar_at(position) for position in range(start, end + 1)]
        return InstanceWindow(ticker=instance.ticker, bars=bars)
