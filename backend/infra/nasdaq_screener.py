"""Parse a Nasdaq stock-screener CSV export into TickerMetadata.

Sector and market cap are not covered by our EODHD plan (they live on the
pricier Fundamentals tier), and they change slowly enough that a periodic
free CSV export is the right shape of source -- see
docs/reference/data-provider.md. The export's header is:

    Symbol,Name,Last Sale,Net Change,% Change,Market Cap,Country,IPO Year,
    Volume,Sector,Industry

The export carries no date of its own, so `as_of` is supplied by the caller
(the file's modification date, or the day it was downloaded) rather than
guessed here -- TickerMetadata.as_of exists precisely so a stale universe
snapshot is visible rather than implied.
"""

from __future__ import annotations

import csv
import io
from datetime import date

from domain.models.universe import TickerMetadata

SYMBOL_COLUMN = "Symbol"
SECTOR_COLUMN = "Sector"
MARKET_CAP_COLUMN = "Market Cap"


def _clean_market_cap(raw: str) -> float | None:
    """Market cap as a float, or None when the export leaves it blank.

    Blank is common and legitimate (recent listings, funds, some ADRs), so a
    missing value degrades the ticker to "unfiltered by market cap" rather
    than dropping it from the universe entirely -- dropping it would silently
    shrink every unfiltered search too.
    """
    value = raw.strip().replace("$", "").replace(",", "")
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _clean_symbol(raw: str) -> str | None:
    """Normalize a screener symbol to the panel's ticker convention.

    Nasdaq writes share classes with a slash (BRK/A) where price data uses a
    hyphen or a dot; the panel's tickers come from EODHD, which uses a
    hyphen. Symbols carrying whitespace are export artifacts (test issues,
    footnote rows) and are skipped.
    """
    value = raw.strip().upper()
    if not value or any(character.isspace() for character in value):
        return None
    return value.replace("/", "-")


def parse_screener_csv(text: str, as_of: date) -> dict[str, TickerMetadata]:
    """Build the ticker -> metadata map the engine filters its universe with.

    Later rows win on a duplicate symbol, matching the export's own
    convention of listing the primary line last.
    """
    universe: dict[str, TickerMetadata] = {}
    for row in csv.DictReader(io.StringIO(text)):
        symbol = _clean_symbol(row.get(SYMBOL_COLUMN) or "")
        if symbol is None:
            continue
        sector = (row.get(SECTOR_COLUMN) or "").strip() or None
        universe[symbol] = TickerMetadata(
            ticker=symbol,
            sector=sector,
            market_cap=_clean_market_cap(row.get(MARKET_CAP_COLUMN) or ""),
            as_of=as_of,
        )
    return universe


def universe_to_csv(universe: dict[str, TickerMetadata]) -> str:
    """Round-trip the parsed universe back out as CSV.

    The object store holds the parsed form, not the raw export, so the
    backend never re-does column guessing at startup and a change to the
    screener's column names can only break the ingestion script.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(["ticker", "sector", "market_cap", "as_of"])
    for meta in sorted(universe.values(), key=lambda item: item.ticker):
        writer.writerow(
            [
                meta.ticker,
                meta.sector or "",
                "" if meta.market_cap is None else meta.market_cap,
                meta.as_of.isoformat(),
            ]
        )
    return buffer.getvalue()


def universe_from_csv(text: str) -> dict[str, TickerMetadata]:
    """Read back what `universe_to_csv` wrote."""
    universe: dict[str, TickerMetadata] = {}
    for row in csv.DictReader(io.StringIO(text)):
        ticker = (row.get("ticker") or "").strip().upper()
        if not ticker:
            continue
        market_cap = (row.get("market_cap") or "").strip()
        universe[ticker] = TickerMetadata(
            ticker=ticker,
            sector=(row.get("sector") or "").strip() or None,
            market_cap=float(market_cap) if market_cap else None,
            as_of=date.fromisoformat((row["as_of"]).strip()),
        )
    return universe
