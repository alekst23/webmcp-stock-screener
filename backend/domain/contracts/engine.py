from datetime import date
from typing import Literal, Protocol

from domain.models.instance import Instance, InstanceSet
from domain.models.measurement import InstanceWindow, MeasureResult
from domain.models.pattern import Setup, SetupStep, Study

SampleStrategy = Literal["random", "recent", "best", "worst"]
SplitMode = Literal["outcome", "condition"]


class PatternResearchEngine(Protocol):
    """The query engine's contract, implemented by an infra adapter over the
    panel (mock in early development, real EODHD-backed later — same
    contract either way). T-1001-3 delivers define_study/define_setup/
    find_instances; T-1001-4 adds the four methods below."""

    def define_study(self, name: str, expression: str) -> Study:
        """Raises domain.errors.ExpressionError on an unsupported expression."""
        ...

    def define_setup(self, name: str | None, steps: list[SetupStep]) -> Setup: ...

    def find_instances(
        self,
        setup: Setup,
        from_date: date | None = None,
        to_date: date | None = None,
        min_market_cap: float | None = None,
        sectors: list[str] | None = None,
    ) -> InstanceSet:
        """Returns every completed occurrence of `setup` in the loaded panel.

        If fewer than 5 completed instances are found, also includes partial
        (in-progress) matches — see spec.md's "Instance search" scenarios for
        the exact threshold and completion-scoring rules.
        """
        ...

    def sample_instances(
        self,
        instance_set: InstanceSet,
        n: int = 12,
        strategy: SampleStrategy = "recent",
        horizon_days: int | None = None,
    ) -> list[Instance]:
        """horizon_days is required when strategy is "best" or "worst"."""
        ...

    def measure(
        self,
        instance_set: InstanceSet,
        horizon_days: int,
        metric: str | None = None,
        compare_to_base_rate: bool = True,
    ) -> MeasureResult:
        """Partial instances in `instance_set` are excluded from the
        statistic; `MeasureResult.excluded_partial_count` reports how many.
        """
        ...

    def split_instances(
        self,
        instance_set: InstanceSet,
        mode: SplitMode,
        expression: str | None = None,
        horizon_days: int | None = None,
        threshold: float | None = None,
    ) -> list[InstanceSet]:
        """mode="outcome" requires horizon_days; mode="condition" requires
        expression."""
        ...

    def get_instance_windows(
        self,
        instance_set: InstanceSet,
        n: int = 12,
        strategy: SampleStrategy = "recent",
        window: tuple[int, int] = (-20, 20),
    ) -> list[InstanceWindow]:
        """Backs showGrid's data needs (T-1001-7 renders the chart)."""
        ...
