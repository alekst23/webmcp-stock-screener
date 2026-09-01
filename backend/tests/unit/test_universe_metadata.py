"""T-1001-9 AC3: sector and market cap for universe filtering, parsed from a
free Nasdaq screener CSV export (docs/reference/data-provider.md)."""

from datetime import date, timedelta

from domain.models.pattern import Setup, SetupStep
from domain.models.price import PriceBar
from domain.models.universe import TickerMetadata
from infra.nasdaq_screener import parse_screener_csv, universe_from_csv, universe_to_csv
from infra.pandas_engine import PandasPatternResearchEngine

AS_OF = date(2026, 8, 26)

# The Nasdaq screener export's real header and row shape. The rows exercise,
# in order: an ordinary listing, a blank market cap (common for recent
# listings), a blank sector, a slash-form share class, and a footnote row
# with a whitespace-bearing symbol.
_HEADER = (
    "Symbol,Name,Last Sale,Net Change,% Change,"
    "Market Cap,Country,IPO Year,Volume,Sector,Industry"
)

SCREENER_CSV = _HEADER + """
AAPL,Apple Inc.,$232.80,1.23,0.53%,3510000000000.00,US,1980,44000000,Technology,Hardware
NEWC,Newco Holdings,$11.05,0.00,0.00%,,US,2026,120000,Health Care,Biotech
FUND,Closed End Fund,$18.42,-0.02,-0.11%,850000000.00,US,,15000,,
BRK/A,Berkshire Class A,$712000.00,100.00,0.01%,1020000000000.00,US,,900,Finance,Insurance
NOT A TICKER,Footnote row from the export,,,,,,,,,
"""


class TestUniverseMetadataParsing:
    def test_parse_nasdaq_screener_csv_produces_valid_ticker_metadata(self) -> None:
        universe = parse_screener_csv(SCREENER_CSV, AS_OF)

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
        assert apple.as_of == AS_OF, f"expected as_of {AS_OF}, got {apple.as_of}"

    def test_missing_market_cap_or_sector_degrades_to_none_without_dropping_the_ticker(
        self,
    ) -> None:
        # Dropping these would silently shrink every *unfiltered* search too,
        # not just the ones that ask for a market-cap floor.
        universe = parse_screener_csv(SCREENER_CSV, AS_OF)

        assert universe["NEWC"].market_cap is None, f"got {universe['NEWC'].market_cap}"
        assert universe["NEWC"].sector == "Health Care", f"got {universe['NEWC'].sector}"
        assert universe["FUND"].sector is None, f"got {universe['FUND'].sector}"
        assert universe["FUND"].market_cap == 850_000_000.0, f"got {universe['FUND'].market_cap}"

    def test_share_class_symbols_are_normalized_to_the_panel_convention(self) -> None:
        # The screener writes BRK/A; price data uses BRK-A. Left unnormalized,
        # every class-A/B listing silently misses its metadata and is filtered
        # out of any minMarketCap search.
        universe = parse_screener_csv(SCREENER_CSV, AS_OF)

        assert "BRK-A" in universe, f"expected BRK-A, got {sorted(universe)}"
        assert universe["BRK-A"].ticker == "BRK-A", f"got {universe['BRK-A'].ticker}"

    def test_universe_round_trips_through_the_stored_csv_form(self) -> None:
        # The object store holds the parsed form, so the API never re-does
        # column guessing at startup (application/load_panel.py).
        original = parse_screener_csv(SCREENER_CSV, AS_OF)

        restored = universe_from_csv(universe_to_csv(original))

        assert restored == original, f"round trip changed the universe: {restored}"


class TestUniverseFilteringUsesTheMetadata:
    def test_min_market_cap_and_sector_filters_narrow_the_engine_universe(self) -> None:
        start = date(2024, 1, 1)
        bars = [
            PriceBar(
                ticker=ticker,
                date=start + timedelta(days=offset),
                open=10.0,
                high=11.0,
                low=9.0,
                close=10.0,
                volume=1_000,
            )
            for ticker in ("AAPL", "NEWC", "FUND")
            for offset in range(10)
        ]
        engine = PandasPatternResearchEngine.from_price_bars(
            bars, parse_screener_csv(SCREENER_CSV, AS_OF)
        )
        setup = Setup(id="setup_1", name="always", steps=[SetupStep(condition="close > 0")])

        big_tech = engine.find_instances(setup, min_market_cap=1e12, sectors=["Technology"])

        found = {instance.ticker for instance in big_tech.instances}
        assert found == {"AAPL"}, f"expected only AAPL to survive the filter, got {found}"
