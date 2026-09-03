"""T-1014-6: PanelPriceSeriesPort / NoFundamentalsPort / PanelReferenceDataPort
-- the real infra adapters wiring T-1014-5's engine Protocols to the loaded
OHLCV panel and Nasdaq-screener universe metadata."""

from __future__ import annotations

from datetime import date, timedelta

from domain.models.panel import PanelStatus
from domain.models.price import PriceBar
from domain.models.screener import SeriesRef, UniverseSpec
from domain.models.universe import TickerMetadata
from infra.panel_frame import PanelFrame
from infra.panel_market_data import (
    NoFundamentalsPort,
    PanelPriceSeriesPort,
    PanelReferenceDataPort,
)

# ---- Fixture builders ---------------------------------------------------


def _bar(ticker: str, day: date, close: float, volume: int = 1_000_000) -> PriceBar:
    return PriceBar(
        ticker=ticker,
        date=day,
        open=close,
        high=close + 0.5,
        low=close - 0.5,
        close=close,
        volume=volume,
    )


def _daily_bars(
    ticker: str, closes: list[float], start: date, volume: int = 1_000_000
) -> list[PriceBar]:
    return [_bar(ticker, start + timedelta(days=i), c, volume) for i, c in enumerate(closes)]


def _status(as_of: date = date(2024, 6, 1), source: str = "mock") -> PanelStatus:
    return PanelStatus(
        as_of=as_of, first_date=date(2024, 1, 1), ticker_count=2, row_count=1, source=source
    )


def _universe(**overrides: object) -> UniverseSpec:
    base = dict(universe_id="u1", label="Test universe")
    base.update(overrides)
    return UniverseSpec(**base)  # type: ignore[arg-type]


# ---- PanelPriceSeriesPort -----------------------------------------------


class TestPanelPriceSeriesPort:
    def test_get_bars_returns_bars_in_range(self) -> None:
        start = date(2024, 1, 1)
        bars = _daily_bars("AAA", [10.0, 11.0, 12.0, 13.0], start)
        port = PanelPriceSeriesPort(PanelFrame.from_bars(bars), _status())

        result = port.get_bars("AAA", start + timedelta(days=1), start + timedelta(days=2))

        assert [b.close for b in result] == [
            11.0,
            12.0,
        ], f"expected middle two closes, got {result}"

    def test_get_bars_unknown_ticker_returns_empty(self) -> None:
        bars = _daily_bars("AAA", [10.0], date(2024, 1, 1))
        port = PanelPriceSeriesPort(PanelFrame.from_bars(bars), _status())

        result = port.get_bars("ZZZ", date(2024, 1, 1), date(2024, 1, 5))

        assert result == [], f"expected no bars for an unknown ticker, got {result}"

    def test_get_series_resolves_recognized_ohlc_field(self) -> None:
        start = date(2024, 1, 1)
        bars = _daily_bars("AAA", [10.0, 20.0, 30.0], start)
        port = PanelPriceSeriesPort(PanelFrame.from_bars(bars), _status())

        observed = port.get_series(
            "AAA", SeriesRef(catalog_id="close"), start, start + timedelta(days=2)
        )

        assert [o.value for o in observed] == [10.0, 20.0, 30.0], f"got {observed}"

    def test_get_series_unrecognized_catalog_id_returns_empty_not_error(self) -> None:
        # The port's documented contract: an unrecognized series is "not
        # evaluable," never a fabricated value or an exception.
        bars = _daily_bars("AAA", [10.0], date(2024, 1, 1))
        port = PanelPriceSeriesPort(PanelFrame.from_bars(bars), _status())

        observed = port.get_series(
            "AAA", SeriesRef(catalog_id="rsi_14"), date(2024, 1, 1), date(2024, 1, 1)
        )

        assert observed == [], f"expected [] for an unrecognized series, got {observed}"

    def test_has_ticker_distinguishes_unknown_ticker_from_empty_window(self) -> None:
        bars = _daily_bars("AAA", [10.0], date(2024, 1, 1))
        port = PanelPriceSeriesPort(PanelFrame.from_bars(bars), _status())

        assert port.has_ticker("AAA") is True, "expected the panel's own ticker to be known"
        assert port.has_ticker("ZZZ") is False, "expected a ticker never in the panel to be unknown"

    def test_provenance_reflects_panel_status(self) -> None:
        bars = _daily_bars("AAA", [10.0], date(2024, 1, 1))
        status = _status(as_of=date(2024, 6, 15), source="object-store")
        port = PanelPriceSeriesPort(PanelFrame.from_bars(bars), status)

        provenance = port.provenance()

        assert provenance.as_of.date() == date(2024, 6, 15), f"got {provenance.as_of}"
        assert provenance.source_id == "panel.object-store", f"got {provenance.source_id}"
        assert provenance.liveness == "historical", f"got {provenance.liveness}"


# ---- NoFundamentalsPort ---------------------------------------------------


class TestNoFundamentalsPort:
    def test_reports_no_coverage_honestly(self) -> None:
        port = NoFundamentalsPort()

        assert port.field_ids() == frozenset(), "expected no fundamentals fields to be claimed"
        assert port.supports_point_in_time() is False, "expected no point-in-time claim"
        assert (
            port.get_reported_value("AAA", "pe_ratio", date(2024, 1, 1)) is None
        ), "expected None rather than a fabricated reported value"


# ---- PanelReferenceDataPort ------------------------------------------------


class TestPanelReferenceDataPort:
    def test_capability_flags_are_all_false(self) -> None:
        bars = _daily_bars("AAA", [10.0], date(2024, 1, 1))
        port = PanelReferenceDataPort(PanelFrame.from_bars(bars), {})

        assert port.includes_delisted() is False
        assert port.includes_merged() is False
        assert port.includes_renamed() is False

    def test_universe_members_defaults_to_every_panel_ticker(self) -> None:
        start = date(2024, 1, 1)
        bars = _daily_bars("AAA", [10.0] * 5, start) + _daily_bars("BBB", [10.0] * 5, start)
        port = PanelReferenceDataPort(PanelFrame.from_bars(bars), {})

        members = port.get_universe_members(start + timedelta(days=2), _universe())

        assert members == ["AAA", "BBB"], f"expected both tickers, got {members}"

    def test_explicit_tickers_are_honored(self) -> None:
        start = date(2024, 1, 1)
        bars = _daily_bars("AAA", [10.0] * 5, start) + _daily_bars("BBB", [10.0] * 5, start)
        port = PanelReferenceDataPort(PanelFrame.from_bars(bars), {})

        members = port.get_universe_members(start + timedelta(days=2), _universe(tickers=["BBB"]))

        assert members == ["BBB"], f"expected only the explicit ticker list, got {members}"

    def test_excluded_tickers_are_removed(self) -> None:
        start = date(2024, 1, 1)
        bars = _daily_bars("AAA", [10.0] * 5, start) + _daily_bars("BBB", [10.0] * 5, start)
        port = PanelReferenceDataPort(PanelFrame.from_bars(bars), {})

        members = port.get_universe_members(
            start + timedelta(days=2), _universe(excluded_tickers=["AAA"])
        )

        assert members == ["BBB"], f"expected AAA excluded, got {members}"

    def test_min_price_filters_out_cheap_tickers_as_of_the_date(self) -> None:
        start = date(2024, 1, 1)
        bars = _daily_bars("AAA", [5.0] * 5, start) + _daily_bars("BBB", [50.0] * 5, start)
        port = PanelReferenceDataPort(PanelFrame.from_bars(bars), {})

        members = port.get_universe_members(start + timedelta(days=2), _universe(min_price=10.0))

        assert members == ["BBB"], f"expected only the pricier ticker, got {members}"

    def test_min_market_cap_uses_ticker_metadata(self) -> None:
        start = date(2024, 1, 1)
        bars = _daily_bars("AAA", [10.0] * 5, start) + _daily_bars("BBB", [10.0] * 5, start)
        meta = {
            "AAA": TickerMetadata(ticker="AAA", market_cap=1e9, as_of=start),
            "BBB": TickerMetadata(ticker="BBB", market_cap=1e6, as_of=start),
        }
        port = PanelReferenceDataPort(PanelFrame.from_bars(bars), meta)

        members = port.get_universe_members(
            start + timedelta(days=2), _universe(min_market_cap=1e8)
        )

        assert members == ["AAA"], f"expected only the large-cap ticker, got {members}"

    def test_min_market_cap_excludes_ticker_with_no_metadata(self) -> None:
        start = date(2024, 1, 1)
        bars = _daily_bars("AAA", [10.0] * 5, start)
        port = PanelReferenceDataPort(PanelFrame.from_bars(bars), {})

        members = port.get_universe_members(
            start + timedelta(days=2), _universe(min_market_cap=1.0)
        )

        assert members == [], f"expected no metadata to mean excluded, got {members}"

    def test_membership_is_point_in_time_ticker_with_no_data_yet_is_excluded(self) -> None:
        # BBB only starts trading later than the rebalance date -- point-in-
        # time membership (not "does BBB exist anywhere in the panel") is
        # what makes the survivorship statement true rather than aspirational.
        early = date(2024, 1, 1)
        later = date(2024, 6, 1)
        bars = _daily_bars("AAA", [10.0] * 5, early) + _daily_bars("BBB", [10.0] * 5, later)
        port = PanelReferenceDataPort(PanelFrame.from_bars(bars), {})

        members = port.get_universe_members(early + timedelta(days=2), _universe())

        assert members == ["AAA"], f"expected BBB (not yet trading) excluded, got {members}"

    def test_no_delisting_or_event_data(self) -> None:
        bars = _daily_bars("AAA", [10.0], date(2024, 1, 1))
        port = PanelReferenceDataPort(PanelFrame.from_bars(bars), {})

        assert port.get_delisting_events(date(2024, 1, 1), date(2024, 12, 31)) == []
        assert (
            port.get_event_occurrences("AAA", "earnings", date(2024, 1, 1), date(2024, 12, 31))
            == []
        )
