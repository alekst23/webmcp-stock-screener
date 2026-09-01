from datetime import date

from pydantic import BaseModel


class Instance(BaseModel):
    """One (ticker, date) occurrence of a setup. `completeness` is 1.0 for a
    fully resolved match; below 1.0 for a partial match still in progress at
    the trailing edge of the loaded panel (see spec.md's "Instance search"
    scenarios for when partials are surfaced)."""

    ticker: str
    date: date
    completeness: float = 1.0


class InstanceSet(BaseModel):
    """The result of searching for a setup's occurrences. complete_count and
    partial_count are stored (not derived) so every producer of an
    InstanceSet states them explicitly, matching spec.md's "the result
    reports completed and partial counts separately"."""

    id: str
    setup_id: str
    instances: list[Instance]
    complete_count: int
    partial_count: int
    from_date: date
    to_date: date
    # Set this was derived from via a split, if any.
    parent_id: str | None = None
    label: str | None = None
