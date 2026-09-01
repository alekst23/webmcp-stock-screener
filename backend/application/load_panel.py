"""Resolve the panel and universe metadata the API serves at startup.

Object storage first, the local mock panel as fallback. The fallback is not a
transitional shim: a local checkout, every test run, and a first deploy
against an empty bucket all legitimately have no stored panel, and each must
still boot rather than fail closed on a missing object.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from domain.contracts.panel_store import PanelStore
from domain.models.panel import PanelStatus
from domain.models.price import PriceBar
from domain.models.universe import TickerMetadata
from infra.nasdaq_screener import universe_from_csv
from infra.panel_io import panel_status, parquet_bytes_to_bars

PANEL_KEY = "panel.parquet"
UNIVERSE_KEY = "universe.csv"


@dataclass(frozen=True)
class LoadedPanel:
    bars: list[PriceBar]
    universe: dict[str, TickerMetadata]
    status: PanelStatus


def load_panel(
    store: PanelStore | None,
    mock_path: Path,
    panel_key: str = PANEL_KEY,
    universe_key: str = UNIVERSE_KEY,
) -> LoadedPanel | None:
    """Load the best available panel, or None when there is none at all.

    None (rather than an exception) keeps the existing degenerate-startup
    behavior intact: api/routes/research.py already answers 503 with a
    remediation message when no engine is loaded.
    """
    if store is not None and store.object_exists(panel_key):
        bars = parquet_bytes_to_bars(store.get_object(panel_key))
        universe = _load_universe(store, universe_key)
        return LoadedPanel(bars, universe, panel_status(bars, source="object-store"))
    if mock_path.exists():
        bars = parquet_bytes_to_bars(mock_path.read_bytes())
        return LoadedPanel(bars, {}, panel_status(bars, source="mock"))
    return None


def _load_universe(store: PanelStore, universe_key: str) -> dict[str, TickerMetadata]:
    """Sector/market-cap metadata is optional: without it the engine simply
    cannot narrow by minMarketCap/sectors, which is strictly better than
    refusing to serve price data at all."""
    if not store.object_exists(universe_key):
        return {}
    return universe_from_csv(store.get_object(universe_key).decode("utf-8"))
