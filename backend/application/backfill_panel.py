"""One-time backfill: build the real panel from scratch and store it.

One API call per ticker (the per-ticker range endpoint returns any length of
history in a single call), so ~4,000-4,500 calls total -- well inside the
paid plan's 100,000/day cap. See docs/reference/data-provider.md.
"""

from __future__ import annotations

from datetime import date
from typing import Callable

from domain.contracts.panel_store import PanelStore
from domain.contracts.price_source import PriceSource
from domain.errors import PriceSourceError
from domain.models.panel import PanelStatus
from domain.models.price import PriceBar
from infra.panel_io import bars_to_parquet_bytes, panel_status

PANEL_KEY = "panel.parquet"

ProgressCallback = Callable[[str, int, int], None]


def backfill_panel(
    source: PriceSource,
    store: PanelStore,
    tickers: list[str],
    from_date: date,
    to_date: date,
    key: str = PANEL_KEY,
    on_progress: ProgressCallback | None = None,
) -> PanelStatus:
    """Fetch every ticker's history, then write one panel object.

    A single unreachable ticker must not abandon a multi-thousand-call run,
    so per-ticker failures are recorded and skipped; a run that yields no
    bars at all is a real failure and raises.
    """
    bars: list[PriceBar] = []
    failures: list[str] = []
    for index, ticker in enumerate(tickers, start=1):
        try:
            bars.extend(source.fetch_history(ticker, from_date, to_date))
        except PriceSourceError:
            failures.append(ticker)
        if on_progress:
            on_progress(ticker, index, len(tickers))
    if not bars:
        raise PriceSourceError(
            f"Backfill produced no bars for {len(tickers)} tickers "
            f"({len(failures)} failed) -- refusing to overwrite the stored panel"
        )
    store.put_object(key, bars_to_parquet_bytes(bars))
    return panel_status(bars, source="object-store")
