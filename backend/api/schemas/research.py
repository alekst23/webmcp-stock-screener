"""Request schemas for T-0001-5's 5 networked WebMCP tool endpoints.

Stateless per request (docs/plan.md's "Sessions" section): defineStudy and
defineSetup run entirely client-side (no network call), so the server never
learns about a study or setup until a request that needs it arrives. Every
request below therefore carries its Setup/InstanceSet/Study data by value
rather than by a server-side id lookup. Response bodies reuse the domain
models directly (Instance, InstanceSet, MeasureResult, InstanceWindow) --
see api/routes/research.py.
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from domain.contracts.engine import SampleStrategy, SplitMode
from domain.models.instance import InstanceSet
from domain.models.pattern import Setup, Study


class FindInstancesRequest(BaseModel):
    setup: Setup
    # Every study currently defined in the caller's workspace, so setup step
    # conditions that reference one by name resolve on the (otherwise
    # study-ignorant) shared engine instance.
    studies: list[Study] = Field(default_factory=list)
    from_date: date | None = None
    to_date: date | None = None
    min_market_cap: float | None = None
    sectors: list[str] | None = None


class SampleInstancesRequest(BaseModel):
    instance_set: InstanceSet
    n: int = 12
    strategy: SampleStrategy = "recent"
    horizon_days: int | None = None


class MeasureRequest(BaseModel):
    instance_set: InstanceSet
    horizon_days: int
    metric: str | None = None
    compare_to_base_rate: bool = True


class SplitInstancesRequest(BaseModel):
    instance_set: InstanceSet
    mode: SplitMode
    # Only needed for mode="condition"; see FindInstancesRequest.studies.
    studies: list[Study] = Field(default_factory=list)
    expression: str | None = None
    horizon_days: int | None = None
    threshold: float | None = None


class InstanceWindowsRequest(BaseModel):
    instance_set: InstanceSet
    n: int = 12
    strategy: SampleStrategy = "recent"
    window: tuple[int, int] = (-20, 20)
