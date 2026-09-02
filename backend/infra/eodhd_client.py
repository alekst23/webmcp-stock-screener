"""EODHD adapter: the project's only outbound market-data dependency.

Ingestion-time only. The app never calls EODHD during a user's search --
`findInstances`, `measure`, `showGrid` all read our own stored panel (see
docs/reference/data-provider.md). Two endpoints for two jobs: the per-ticker
range endpoint backfills any length of history in one call per ticker, and
the bulk-by-exchange endpoint carries one whole trading day for the nightly
delta.

Adjustment convention is the load-bearing detail here. EODHD returns `close`
(the raw historical print) alongside `adjusted_close` (back-adjusted for
splits and dividends as of today), and does NOT return adjusted
open/high/low. `PriceBar` commits every OHLC field to the adjusted basis, so
open/high/low are scaled by the same adjusted_close/close ratio -- take
`close` directly and O/H/L would sit on a different price basis than C,
silently corrupting every bar spanning a split or ex-dividend date.
"""

from __future__ import annotations

from datetime import date

import requests

from domain.errors import PriceSourceError
from domain.models.price import PriceBar

EODHD_BASE_URL = "https://eodhd.com/api"

# Well beyond a normal response, but a hung ingestion job that never returns
# is worse than one that fails: the nightly cron has to terminate.
_REQUEST_TIMEOUT_SECONDS = 60


def eodhd_row_to_price_bar(ticker: str, row: dict) -> PriceBar:
    """Map one EODHD EOD row onto our adjusted-OHLCV PriceBar contract.

    `close` comes from `adjusted_close` directly; `open`/`high`/`low` are raw
    in EODHD's response and are scaled by the same factor that turns `close`
    into `adjusted_close`. See this module's header for why.
    """
    adjustment_factor = row["adjusted_close"] / row["close"] if row["close"] else 1.0
    return PriceBar(
        ticker=ticker,
        date=date.fromisoformat(row["date"]),
        open=round(row["open"] * adjustment_factor, 4),
        high=round(row["high"] * adjustment_factor, 4),
        low=round(row["low"] * adjustment_factor, 4),
        close=round(row["adjusted_close"], 4),
        volume=int(row["volume"]),
    )


def bulk_row_to_price_bar(row: dict) -> PriceBar:
    """Map one row of the bulk-by-exchange payload.

    Same field names as the per-ticker endpoint plus a `code` naming the
    ticker, since a bulk response spans the whole exchange.
    """
    return eodhd_row_to_price_bar(str(row["code"]).upper(), row)


class EodhdClient:
    """PriceSource implementation over EODHD's HTTP API.

    `session` is injectable so tests exercise the real request-building and
    response-mapping code against a stub transport, without a live (paid)
    call.
    """

    def __init__(
        self,
        api_key: str,
        session: requests.Session | None = None,
        base_url: str = EODHD_BASE_URL,
    ) -> None:
        self._api_key = api_key
        self._session = session or requests.Session()
        self._base_url = base_url.rstrip("/")

    def _get(self, path: str, params: dict[str, str]) -> list[dict]:
        url = f"{self._base_url}/{path}"
        try:
            response = self._session.get(
                url,
                params={"api_token": self._api_key, "fmt": "json", **params},
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError):
            # `from None`: `api_token` travels as a query parameter, and
            # `requests` embeds the fully resolved URL -- token included --
            # in an HTTPError's own message. Chaining the cause would put
            # the key in any traceback or log this exception's chain ends
            # up in (T-0016-5 AC6).
            raise PriceSourceError(f"EODHD request failed for {path}") from None
        if not isinstance(payload, list):
            raise PriceSourceError(f"EODHD returned a non-list payload for {path}")
        return payload

    def fetch_history(self, ticker: str, from_date: date, to_date: date) -> list[PriceBar]:
        """One call to the per-ticker range endpoint, whatever the range."""
        rows = self._get(
            f"eod/{ticker}",
            {"period": "d", "from": from_date.isoformat(), "to": to_date.isoformat()},
        )
        symbol = ticker.split(".")[0].upper()
        try:
            return [eodhd_row_to_price_bar(symbol, row) for row in rows]
        except (KeyError, TypeError, ValueError) as exc:
            raise PriceSourceError(f"Malformed EODHD EOD row for {ticker}") from exc

    def fetch_exchange_day(self, exchange: str, day: date) -> list[PriceBar]:
        """One bulk-by-exchange call covering a single trading day.

        Verified against the paid tier: a single US call returns all ~44,500
        rows for one date with no pagination, closing
        docs/reference/data-provider.md's open question.
        """
        rows = self._get(f"eod-bulk-last-day/{exchange}", {"date": day.isoformat()})
        try:
            return [bulk_row_to_price_bar(row) for row in rows]
        except (KeyError, TypeError, ValueError) as exc:
            raise PriceSourceError(f"Malformed EODHD bulk row for {exchange} on {day}") from exc

    def fetch_symbols(
        self,
        exchange: str = "US",
        exchanges: list[str] | None = None,
        security_type: str = "Common Stock",
    ) -> list[str]:
        """Listed tickers, from the exchange symbol list.

        A better universe source than the Nasdaq screener export for the
        ticker *list*: it is authoritative for what the price endpoints will
        actually serve. It carries no sector or market cap, so the screener
        CSV is still what feeds `TickerMetadata` (AC3).

        `US` covers far more than the listed market -- of ~18,000 common
        stocks the great majority are OTC tiers (PINK, OTCQB, OTCQX,
        OTCGREY, OTCCE, OTCMKTS), which have neither the liquidity nor the
        data quality this research is about. `exchanges` narrows to real
        listings; the default (NASDAQ/NYSE/AMEX) is ~6,300 tickers.
        """
        rows = self._get(f"exchange-symbol-list/{exchange}", {})
        wanted = {name.upper() for name in (exchanges or [])}
        symbols = [
            str(row["Code"]).upper()
            for row in rows
            if str(row.get("Type", "")) == security_type
            and (not wanted or str(row.get("Exchange", "")).upper() in wanted)
        ]
        return sorted(set(symbols))
