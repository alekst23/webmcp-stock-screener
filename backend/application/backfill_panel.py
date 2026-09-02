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
from infra.panel_frame import bars_to_panel
from infra.panel_io import bars_to_parquet_bytes, panel_status
from infra.universe_eligibility import (
    ELIGIBILITY_KEY,
    compute_eligible_universe,
    eligibility_to_csv,
)

PANEL_KEY = "panel.parquet"

ProgressCallback = Callable[[str, int, int], None]


def backfill_panel(
    source: PriceSource,
    store: PanelStore,
    tickers: list[str],
    from_date: date,
    to_date: date,
    key: str = PANEL_KEY,
    eligibility_key: str = ELIGIBILITY_KEY,
    on_progress: ProgressCallback | None = None,
    enforce_floor: bool = False,
) -> PanelStatus:
    """Fetch every ticker's history, then write one panel object.

    A single unreachable ticker must not abandon a multi-thousand-call run,
    so per-ticker failures are recorded and skipped; a run that yields no
    bars at all is a real failure and raises.

    `enforce_floor` defaults off so every existing caller (schema-
    conformance tests, small rehearsal fixtures that could never clear a
    252-session history floor) keeps working unmodified -- see
    docs/plan/EPIC-0016/T-0016-13-universe-enforcement.md. The real ingest
    entry point (`scripts/backfill_panel.py`) opts in by default. When on,
    the fetched bars are measured against the enforced universe floor
    (domain/universe_floor.py) as one set, bars for tickers that do not
    clear it are dropped before the panel is written, and the eligible-set
    object is written alongside the panel for the nightly delta to consult.
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
    if enforce_floor:
        eligible = compute_eligible_universe(
            bars_to_panel(bars), as_of=max(bar.date for bar in bars)
        )
        bars = [bar for bar in bars if bar.ticker in eligible]
        if not bars:
            raise PriceSourceError(
                f"None of the fetched tickers cleared the enforced universe floor "
                f"({len(tickers)} tickers fetched) -- refusing to write an empty panel"
            )
        store.put_object(eligibility_key, eligibility_to_csv(eligible).encode("utf-8"))
    store.put_object(key, bars_to_parquet_bytes(bars))
    return panel_status(bars, source="object-store")
