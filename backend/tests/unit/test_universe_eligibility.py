"""T-0016-13: infra/universe_eligibility.py -- measuring a panel's tickers
against the enforced floor (domain/universe_floor.py) and round-tripping
the result as a stored CSV.

``TestUniverseMetadataParsing`` below re-homes nasdaq_screener.py parsing
coverage from the now-deleted test_universe_metadata.py: that file also
covered the retiring pandas pattern-research engine and was deleted whole,
but its nasdaq_screener.py coverage is for shared, kept infra and would
otherwise be silently dropped.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from domain.models.price import PriceBar
from domain.models.universe import TickerMetadata
from infra.nasdaq_screener import parse_screener_csv, universe_from_csv, universe_to_csv
from infra.panel_frame import bars_to_panel
from infra.universe_eligibility import (
    compute_eligible_universe,
    eligibility_from_csv,
    eligibility_to_csv,
)

START = date(2024, 1, 1)
AS_OF = START + timedelta(days=299)

# The Nasdaq screener export fixture's as-of date. A separate date from
# the eligibility tests' AS_OF above -- the two test classes below are
# otherwise unrelated, just co-located in this module after re-homing.
METADATA_AS_OF = date(2026, 8, 26)

# The Nasdaq screener export's real header and row shape. The rows exercise,
# in order: an ordinary listing, a blank market cap (common for recent
# listings), a blank sector, a slash-form share class, and a footnote row
# with a whitespace-bearing symbol.
_HEADER = (
    "Symbol,Name,Last Sale,Net Change,% Change,"
    "Market Cap,Country,IPO Year,Volume,Sector,Industry"
)

SCREENER_CSV = (
    _HEADER
    + """
AAPL,Apple Inc.,$232.80,1.23,0.53%,3510000000000.00,US,1980,44000000,Technology,Hardware
NEWC,Newco Holdings,$11.05,0.00,0.00%,,US,2026,120000,Health Care,Biotech
FUND,Closed End Fund,$18.42,-0.02,-0.11%,850000000.00,US,,15000,,
BRK/A,Berkshire Class A,$712000.00,100.00,0.01%,1020000000000.00,US,,900,Finance,Insurance
NOT A TICKER,Footnote row from the export,,,,,,,,,
"""
)


def _history(
    ticker: str, days: int, close: float, volume: int, start: date = START
) -> list[PriceBar]:
    return [
        PriceBar(
            ticker=ticker,
            date=start + timedelta(days=offset),
            open=close,
            high=close + 1.0,
            low=max(close - 1.0, 0.01),
            close=close,
            volume=volume,
        )
        for offset in range(days)
    ]


class TestComputeEligibleUniverse:
    def test_a_ticker_clearing_all_three_floors_is_admitted(self) -> None:
        frame = bars_to_panel(_history("RICH", days=300, close=100.0, volume=1_000_000))

        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        assert "RICH" in eligible, f"expected RICH admitted, got {sorted(eligible)}"
        record = eligible["RICH"]
        assert record.median_dollar_volume == pytest.approx(100_000_000.0), record
        assert record.history_sessions == 300, record
        assert record.as_of == AS_OF, record

    def test_a_ticker_with_low_dollar_volume_is_excluded(self) -> None:
        frame = bars_to_panel(_history("THIN", days=300, close=100.0, volume=1_000))

        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        assert "THIN" not in eligible, f"expected THIN excluded, got {sorted(eligible)}"

    def test_a_ticker_with_short_history_is_excluded(self) -> None:
        frame = bars_to_panel(_history("NEW", days=100, close=100.0, volume=1_000_000))

        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        assert (
            "NEW" not in eligible
        ), f"expected NEW excluded (100 sessions), got {sorted(eligible)}"

    def test_a_ticker_below_the_price_floor_is_excluded(self) -> None:
        frame = bars_to_panel(_history("PENNY", days=300, close=0.50, volume=100_000_000))

        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        assert (
            "PENNY" not in eligible
        ), f"expected PENNY excluded (close $0.50), got {sorted(eligible)}"

    def test_the_window_is_market_wide_not_per_ticker(self) -> None:
        # A ticker whose own trading stopped well before the panel's most
        # recent 60-session window still had plenty of history and volume
        # while it traded, but reports no dollar volume in *this* window
        # rather than a stale median from that history.
        stale = _history(
            "STALE", days=300, close=100.0, volume=1_000_000, start=START - timedelta(days=300)
        )
        fresh = _history("FRESH", days=300, close=100.0, volume=1_000_000, start=START)
        frame = bars_to_panel(stale + fresh)

        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        assert (
            "STALE" not in eligible
        ), f"expected STALE excluded (no rows in the recent window), got {sorted(eligible)}"
        assert "FRESH" in eligible, f"expected FRESH admitted, got {sorted(eligible)}"

    def test_an_empty_frame_admits_nothing(self) -> None:
        frame = bars_to_panel([])

        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        assert eligible == {}, f"expected no eligible tickers from an empty frame, got {eligible}"


class TestEligibilityCsvRoundTrip:
    def test_round_trip_preserves_every_field(self) -> None:
        frame = bars_to_panel(_history("RICH", days=300, close=100.0, volume=1_000_000))
        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        restored = eligibility_from_csv(eligibility_to_csv(eligible))

        assert restored == eligible, f"round trip changed the record: {restored} != {eligible}"

    def test_an_empty_set_round_trips_to_an_empty_set(self) -> None:
        restored = eligibility_from_csv(eligibility_to_csv({}))

        assert restored == {}, f"expected an empty set, got {restored}"


class TestUniverseMetadataParsing:
    """Re-homed from the deleted test_universe_metadata.py: sector and
    market cap for universe filtering, parsed from a free Nasdaq screener
    CSV export (docs/reference/data-provider.md)."""

    def test_parse_nasdaq_screener_csv_produces_valid_ticker_metadata(self) -> None:
        universe = parse_screener_csv(SCREENER_CSV, METADATA_AS_OF)

        assert set(universe) == {
            "AAPL",
            "NEWC",
            "FUND",
            "BRK-A",
        }, f"unexpected ticker set: {sorted(universe)}"

        apple = universe["AAPL"]
        assert isinstance(apple, TickerMetadata), f"expected TickerMetadata, got {type(apple)}"
        assert apple.ticker == "AAPL", f"expected ticker AAPL, got {apple.ticker}"
        assert apple.sector == "Technology", f"expected Technology, got {apple.sector}"
        assert apple.market_cap == 3.51e12, f"expected 3.51e12, got {apple.market_cap}"
        assert apple.as_of == METADATA_AS_OF, f"expected as_of {METADATA_AS_OF}, got {apple.as_of}"

    def test_missing_market_cap_or_sector_degrades_to_none_without_dropping_the_ticker(
        self,
    ) -> None:
        # Dropping these would silently shrink every *unfiltered* search too,
        # not just the ones that ask for a market-cap floor.
        universe = parse_screener_csv(SCREENER_CSV, METADATA_AS_OF)

        assert universe["NEWC"].market_cap is None, f"got {universe['NEWC'].market_cap}"
        assert universe["NEWC"].sector == "Health Care", f"got {universe['NEWC'].sector}"
        assert universe["FUND"].sector is None, f"got {universe['FUND'].sector}"
        assert universe["FUND"].market_cap == 850_000_000.0, f"got {universe['FUND'].market_cap}"

    def test_share_class_symbols_are_normalized_to_the_panel_convention(self) -> None:
        # The screener writes BRK/A; price data uses BRK-A. Left unnormalized,
        # every class-A/B listing silently misses its metadata and is filtered
        # out of any minMarketCap search.
        universe = parse_screener_csv(SCREENER_CSV, METADATA_AS_OF)

        assert "BRK-A" in universe, f"expected BRK-A, got {sorted(universe)}"
        assert universe["BRK-A"].ticker == "BRK-A", f"got {universe['BRK-A'].ticker}"

    def test_universe_round_trips_through_the_stored_csv_form(self) -> None:
        # The object store holds the parsed form, so the API never re-does
        # column guessing at startup (application/load_panel.py).
        original = parse_screener_csv(SCREENER_CSV, METADATA_AS_OF)

        restored = universe_from_csv(universe_to_csv(original))

        assert restored == original, f"round trip changed the universe: {restored}"
