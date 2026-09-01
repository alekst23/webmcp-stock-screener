from pydantic import BaseModel

from domain.models.price import PriceBar


class BaseRateResult(BaseModel):
    median: float
    hit_rate: float


class MeasureResult(BaseModel):
    metric: str
    horizon_days: int
    count: int
    median: float
    mean: float
    hit_rate: float
    base_rate: BaseRateResult | None = None
    # Present when the input set contained partial instances excluded from
    # the statistic — see spec.md's "Partial instances present" scenario.
    excluded_partial_count: int | None = None


class InstanceWindow(BaseModel):
    """A window of price bars around one instance's anchor date, for
    small-multiples rendering (the actual chart is T-1001-7's job)."""

    ticker: str
    bars: list[PriceBar]
