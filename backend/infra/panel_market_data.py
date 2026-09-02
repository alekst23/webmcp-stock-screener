"""Market-data port adapters for the backtest engine (T-1014-6).

T-1014-5 defined `PriceSeriesPort`/`FundamentalsPort`/`ReferenceDataPort`
(domain/contracts/market_data.py) and built `PortBacktestEngine` against
them, but only ever wired fixture fakes in its own unit tests -- its
Solution Approach is explicit that this repo has no real implementation of
any of the three, and building one is *this* ticket's job, not a change to
T-1014-5's own files.

`PanelPriceSeriesPort` reuses `PandasSimilarityEngine`'s established
technique (`PanelFrame` bounds + numpy searchsorted) over the same loaded
OHLCV panel -- real price data genuinely backs forward returns and
drawdowns. `NoFundamentalsPort` and the corporate-action/event surface of
`PanelReferenceDataPort` are honest "no coverage" defaults: this repo has
no point-in-time fundamentals source and no delisting/event calendar in
Python (T-1014-5's own note). Reporting that explicitly -- empty
`field_ids()`, `includes_delisted() is False`, empty event lists -- is this
program's established "explicit unavailable, never a placeholder" pattern
(domain/panel_disclosure.py, unavailableMarketData.ts on the TS side), not
a shortcut: the engine's own survivorship/lookahead logic already turns
these honest capability flags into an honest reported statement.
"""

from __future__ import annotations

from datetime import date, datetime, time, timezone

import numpy as np

from domain.contracts.market_data import (
    DelistingEvent,
    EventOccurrence,
    ReportedValue,
    SeriesObservation,
)
from domain.models.backtest import BACKTEST_ENGINE_VERSION
from domain.models.panel import PanelStatus
from domain.models.price import PriceBar
from domain.models.screener import SeriesRef, UniverseSpec
from domain.models.similarity import MarketDataProvenance
from domain.models.universe import TickerMetadata
from infra.panel_frame import PanelFrame

_OHLC_FIELDS = ("open", "high", "low", "close")

# Trailing window used for a rebalance date's average-volume liquidity
# filter -- the same 20-session convention `own_moving_average` conditions
# default to elsewhere in this engine's fixtures.
_AVG_VOLUME_WINDOW = 20


def _row_range(panel: PanelFrame, ticker: str, from_date: date, to_date: date) -> tuple[int, int]:
    """Absolute [start, stop) row range for `ticker` within [from_date,
    to_date], inclusive. Empty (0, 0) when the ticker or range has no rows.
    Mirrors infra/similarity_engine.py's own `_bar_range` technique over
    `PanelFrame`'s public bounds/frame surface -- no PanelFrame change
    needed."""
    bounds = panel.bounds(ticker)
    if bounds is None:
        return (0, 0)
    lower, upper = bounds
    dates = panel.frame["date"].to_numpy()[lower:upper]
    lo = int(dates.searchsorted(from_date.toordinal(), side="left"))
    hi = int(dates.searchsorted(to_date.toordinal(), side="right"))
    if hi <= lo:
        return (0, 0)
    return lower + lo, lower + hi


def _row_on_or_before(panel: PanelFrame, ticker: str, as_of: date) -> int | None:
    """The last row position for `ticker` at or before `as_of`, or None if
    the ticker has no data that early. This is what makes universe
    membership resolution point-in-time (T-1014-5 AC's survivorship intent)
    rather than reading today's snapshot."""
    bounds = panel.bounds(ticker)
    if bounds is None:
        return None
    start, stop = bounds
    dates = panel.frame["date"].to_numpy()[start:stop]
    idx = int(np.searchsorted(dates, as_of.toordinal(), side="right")) - 1
    return None if idx < 0 else start + idx


class PanelPriceSeriesPort:
    """`PriceSeriesPort` over the loaded OHLCV panel. Price-class data only
    (AC's "no lookahead risk" premise): raw OHLC fields, always knowable as
    of their own bar date."""

    def __init__(self, panel: PanelFrame, panel_status: PanelStatus) -> None:
        self._panel = panel
        self._panel_status = panel_status

    def get_bars(self, ticker: str, from_date: date, to_date: date) -> list[PriceBar]:
        start, stop = _row_range(self._panel, ticker, from_date, to_date)
        return [self._panel.bar_at(i) for i in range(start, stop)]

    def get_series(
        self, ticker: str, series_ref: SeriesRef, from_date: date, to_date: date
    ) -> list[SeriesObservation]:
        # An unrecognized catalog_id (any price-derived study id this port
        # does not implement) returns [] -- the port's own documented
        # contract for "not evaluable," never a fabricated value.
        if series_ref.catalog_id not in _OHLC_FIELDS:
            return []
        start, stop = _row_range(self._panel, ticker, from_date, to_date)
        column = self._panel.frame[series_ref.catalog_id].to_numpy()
        return [
            SeriesObservation(self._panel.date_at(i), float(column[i])) for i in range(start, stop)
        ]

    def provenance(self) -> MarketDataProvenance:
        status = self._panel_status
        source_label = (
            "Object-store panel" if status.source == "object-store" else "Mock demo panel"
        )
        return MarketDataProvenance(
            as_of=datetime.combine(status.as_of, time.min, tzinfo=timezone.utc),
            source_id=f"panel.{status.source}",
            source_label=source_label,
            liveness="historical",
            timezone="UTC",
            price_adjustment="adjusted",
            engine_version=BACKTEST_ENGINE_VERSION,
        )


class NoFundamentalsPort:
    """Honest "no fundamentals coverage" default (`FundamentalsPort`). No
    point-in-time reported-figures source exists in this repo's Python side
    -- every field classifies as PRICE (domain/backtest_engine.py's
    `_field_class_of`), so no fundamentals-lookahead warning can fire
    incorrectly, and any condition naming a field this port can't serve
    resolves to "not evaluable" rather than a guessed value."""

    def field_ids(self) -> frozenset[str]:
        return frozenset()

    def supports_point_in_time(self) -> bool:
        return False

    def get_reported_value(self, ticker: str, field_id: str, as_of: date) -> ReportedValue | None:
        return None


class PanelReferenceDataPort:
    """`ReferenceDataPort` over the loaded panel's ticker set plus the
    Nasdaq-screener-sourced `TickerMetadata` (the same market-cap source
    `PandasPatternResearchEngine._filter_universe` already reads). No
    delisting/corporate-action or event calendar exists in Python, so those
    surfaces are honestly empty rather than fabricated."""

    def __init__(self, panel: PanelFrame, universe_meta: dict[str, TickerMetadata]) -> None:
        self._panel = panel
        self._universe_meta = universe_meta
        self._all_tickers: list[str] = list(panel.frame["ticker"].cat.categories)

    def includes_delisted(self) -> bool:
        return False

    def includes_merged(self) -> bool:
        return False

    def includes_renamed(self) -> bool:
        return False

    def get_universe_members(self, as_of: date, universe: UniverseSpec) -> list[str]:
        excluded = set(universe.excluded_tickers)
        candidates = universe.tickers if universe.tickers is not None else self._all_tickers
        return sorted(
            ticker
            for ticker in candidates
            if ticker not in excluded and self._passes_liquidity(ticker, as_of, universe)
        )

    def _passes_liquidity(self, ticker: str, as_of: date, universe: UniverseSpec) -> bool:
        row = _row_on_or_before(self._panel, ticker, as_of)
        if row is None:
            return False
        if universe.min_price is not None and self._panel.close_at(row) < universe.min_price:
            return False
        if (
            universe.min_avg_volume is not None
            and self._avg_volume(ticker, row) < universe.min_avg_volume
        ):
            return False
        if universe.min_market_cap is not None:
            meta = self._universe_meta.get(ticker)
            if meta is None or meta.market_cap is None or meta.market_cap < universe.min_market_cap:
                return False
        return True

    def _avg_volume(self, ticker: str, as_of_row: int) -> float:
        bounds = self._panel.bounds(ticker)
        assert bounds is not None  # as_of_row came from this ticker's own range
        start, _stop = bounds
        window_start = max(start, as_of_row - _AVG_VOLUME_WINDOW + 1)
        volumes = self._panel.frame["volume"].to_numpy()[window_start : as_of_row + 1]
        return float(volumes.mean()) if len(volumes) else 0.0

    def get_delisting_events(self, from_date: date, to_date: date) -> list[DelistingEvent]:
        return []

    def get_event_occurrences(
        self, ticker: str, event_type_id: str, from_date: date, to_date: date
    ) -> list[EventOccurrence]:
        return []
