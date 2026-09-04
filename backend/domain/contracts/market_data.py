"""Market-data ports the backtest engine reads through (T-1014-5).

No Python-side reference/fundamentals port exists anywhere in this repo
before this file -- EPIC-1008's "domain ports for reference, fundamental,
and price history data" were never built in Python; EPIC-1008 itself is
TypeScript-only (`src/lib/discovery/`), and its own scope explicitly
excludes "building the reference/fundamental data itself." These three
Protocols are this ticket's own new contract, built and tested against
fixtures (fakes implementing them), per the ticket's "do not build a mock
pipeline" instruction -- there is nothing to build against yet.

Domain layer -- imports nothing from infra. `PriceSeriesPort` is
deliberately separate from the existing `PriceSource` (infra/eodhd_client.py's
contract): that one is documented as "ingestion time only -- never during a
user's search." This one is a query-time port over already-ingested
history, a different job.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

from domain.models.price import PriceBar
from domain.models.screener import ComparisonValue, SeriesRef, UniverseSpec
from domain.models.similarity import MarketDataProvenance


class SeriesObservation:
    """One (date, value) point of a resolved price-class series -- a raw
    OHLCV field or a price-derived study (e.g. a moving average). Not a
    Pydantic model: this is an internal computation value passed between
    domain functions, never serialized on its own."""

    __slots__ = ("on_date", "value")

    def __init__(self, on_date: date, value: float) -> None:
        self.on_date = on_date
        self.value = value

    def __repr__(self) -> str:  # pragma: no cover -- debugging aid only
        return f"SeriesObservation({self.on_date!r}, {self.value!r})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, SeriesObservation):
            return NotImplemented
        return self.on_date == other.on_date and self.value == other.value


class PriceSeriesPort(Protocol):
    """Query-time access to price-class data: raw OHLCV and price-derived
    studies. Always "price class" for lookahead purposes -- a bar's own
    close is knowable as of its own date, with no restatement risk."""

    def get_bars(self, ticker: str, from_date: date, to_date: date) -> list[PriceBar]:
        """Raises domain.errors.PriceSourceError on transport failure."""
        ...

    def get_series(
        self, ticker: str, series_ref: SeriesRef, from_date: date, to_date: date
    ) -> list[SeriesObservation]:
        """Resolves a catalog field or study ID (e.g. a moving average) to
        its daily values over the range. Returns an empty list if the
        series is not recognized -- callers treat that as "not evaluable,"
        never as a false condition."""
        ...

    def provenance(self) -> MarketDataProvenance:
        """The as_of/source/liveness/timezone/currency/price-adjustment
        envelope covering every price-class read this port serves. One
        call per run -- the engine does not ask per-ticker, since a single
        source backs the whole panel."""
        ...


class ReportedValue:
    """One fundamentals figure as it was known at `reported_date` -- the
    date the figure became public, not the fiscal period it describes.
    Point-in-time correctness (AC5) means filtering on
    `reported_date <= as_of`, never on the fiscal period alone."""

    __slots__ = ("value", "fiscal_period", "reported_date")

    def __init__(self, value: float, fiscal_period: str, reported_date: date) -> None:
        self.value = value
        self.fiscal_period = fiscal_period
        self.reported_date = reported_date

    def __repr__(self) -> str:  # pragma: no cover -- debugging aid only
        return f"ReportedValue({self.value!r}, {self.fiscal_period!r}, {self.reported_date!r})"


class FundamentalsPort(Protocol):
    """Point-in-time access to reported company figures."""

    def field_ids(self) -> frozenset[str]:
        """Which catalog field IDs this source can serve -- the
        classification signal AC5 needs to tell a fundamentals-sourced
        condition from a price-sourced one."""
        ...

    def supports_point_in_time(self) -> bool:
        """False means this source can only serve the latest-known value of
        a figure, not what was known as of an arbitrary historical date --
        the engine must warn (AC5) rather than claim point-in-time
        correctness it cannot back up."""
        ...

    def get_reported_value(self, ticker: str, field_id: str, as_of: date) -> ReportedValue | None:
        """The figure as known at `as_of` -- the most recent report with
        `reported_date <= as_of`, never a later restatement. None if no
        report was public yet."""
        ...


class DelistingEvent:
    """One corporate action affecting universe survivorship."""

    __slots__ = ("ticker", "event_date", "kind", "successor_ticker")

    def __init__(
        self,
        ticker: str,
        event_date: date,
        kind: str,
        successor_ticker: str | None = None,
    ) -> None:
        self.ticker = ticker
        self.event_date = event_date
        self.kind = kind  # "delisted" | "merged" | "renamed"
        self.successor_ticker = successor_ticker


class EventOccurrence:
    """One dated event (e.g. an earnings report) plus when the market
    first knew about it. `known_as_of < event_date` is the normal case
    (a scheduled, pre-announced event); `known_as_of == event_date` means
    the event itself was the announcement (unscheduled news) -- either way,
    a decision date before `known_as_of` could not have referenced this
    occurrence. This is the field `event_relative`/`direction=future`
    lookahead detection keys off."""

    __slots__ = ("ticker", "event_type_id", "event_date", "known_as_of")

    def __init__(
        self, ticker: str, event_type_id: str, event_date: date, known_as_of: date
    ) -> None:
        self.ticker = ticker
        self.event_type_id = event_type_id
        self.event_date = event_date
        self.known_as_of = known_as_of


class ReferenceDataPort(Protocol):
    """Point-in-time universe membership, corporate actions, and event
    calendars. The capability flags below (not "did any event happen to
    appear in this fixture") are what the survivorship statement is built
    from -- a source that structurally excludes delisted tickers says so
    even on a range with no delistings at all."""

    def includes_delisted(self) -> bool:
        ...

    def includes_merged(self) -> bool:
        ...

    def includes_renamed(self) -> bool:
        ...

    def get_universe_members(self, as_of: date, universe: UniverseSpec) -> list[str]:
        """Universe membership as of `as_of` -- not today's membership.
        This is what makes the survivorship statement describe real
        history rather than today's index composition applied
        retroactively."""
        ...

    def get_delisting_events(self, from_date: date, to_date: date) -> list[DelistingEvent]:
        ...

    def get_event_occurrences(
        self, ticker: str, event_type_id: str, from_date: date, to_date: date
    ) -> list[EventOccurrence]:
        ...


class SectorCatalog(Protocol):
    """Read-only lookup of which sector values the loaded universe metadata
    actually contains (T-0025-1 AC4) -- lets a caller tell "this sector was
    never in the loaded data" apart from "this sector matched zero
    instruments," which `ReferenceDataPort.get_universe_members` alone
    cannot distinguish.

    Deliberately a separate Protocol rather than a new `ReferenceDataPort`
    method: `ReferenceDataPort` already has a structural implementer
    (`test_backtest_engine.py`'s `FakeReferenceDataPort`) with no use for
    this method -- adding it there would force that fake to grow a method
    it never calls. `PanelReferenceDataPort` implements both Protocols; a
    caller that needs both (T-0025-2's screener engine) takes both as
    separate constructor parameters over the same concrete instance.
    """

    def unrecognized_sectors(self, sectors: list[str]) -> list[str]:
        """Which of `sectors` do not appear as any ticker's sector in the
        loaded metadata. Empty means every requested value is recognized."""
        ...


__all__ = [
    "SeriesObservation",
    "PriceSeriesPort",
    "ReportedValue",
    "FundamentalsPort",
    "DelistingEvent",
    "EventOccurrence",
    "ReferenceDataPort",
    "SectorCatalog",
    "ComparisonValue",
    "MarketDataProvenance",
]
