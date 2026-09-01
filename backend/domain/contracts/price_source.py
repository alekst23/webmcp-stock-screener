from datetime import date
from typing import Protocol

from domain.models.price import PriceBar


class PriceSource(Protocol):
    """Upstream daily-OHLCV provider, used at ingestion time only -- never
    during a user's search (see docs/reference/data-provider.md).

    The two methods map onto the provider's two endpoints, which exist for
    two different jobs: `fetch_history` is the per-ticker range endpoint the
    one-time backfill uses (1 call per ticker, any date range), and
    `fetch_exchange_day` is the bulk-by-exchange endpoint the nightly delta
    uses (one call for a whole exchange, one day).

    Both return adjusted PriceBars and raise domain.errors.PriceSourceError
    on transport or payload failures.
    """

    def fetch_history(self, ticker: str, from_date: date, to_date: date) -> list[PriceBar]: ...

    def fetch_exchange_day(self, exchange: str, day: date) -> list[PriceBar]: ...
