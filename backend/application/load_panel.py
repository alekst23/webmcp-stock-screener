"""Resolve the panel and universe metadata the API serves at startup.

Object storage first, the local mock panel as fallback. The fallback is not a
transitional shim: a local checkout, every test run, and a first deploy
against an empty bucket all legitimately have no stored panel, and each must
still boot rather than fail closed on a missing object.

Damage is handled the same way: a panel with an unreadable row group is
loaded without it and says which tickers are missing, rather than refusing to
serve the ones that are fine. Only a panel with nothing readable in it is a
failure (T-1016-5).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import pyarrow as pa

from domain.contracts.panel_store import PanelStore
from domain.models.panel import PanelStatus
from domain.models.universe import TickerMetadata
from infra.nasdaq_screener import universe_from_csv
from infra.panel_frame import PanelFrame
from infra.panel_io import panel_status_from_frame, parquet_bytes_to_panel
from infra.panel_query import read_panel_resilient

PANEL_KEY = "panel.parquet"
UNIVERSE_KEY = "universe.csv"


@dataclass(frozen=True)
class LoadedPanel:
    panel: PanelFrame
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
        loaded = _loaded(store.get_object(panel_key), source="object-store")
        if loaded is not None:
            return LoadedPanel(loaded.panel, _load_universe(store, universe_key), loaded.status)
    if mock_path.exists():
        loaded = _loaded(mock_path.read_bytes(), source="mock")
        if loaded is not None:
            return loaded
    return None


def _loaded(data: bytes, source: str) -> LoadedPanel | None:
    frame, missing = _read(data)
    if frame.empty:
        return None
    status = panel_status_from_frame(frame, source=source).model_copy(
        update={"is_synthetic": source == "mock", "missing": missing}
    )
    return LoadedPanel(PanelFrame(frame), {}, status)


def _read(data: bytes) -> tuple[pd.DataFrame, list[str]]:
    """The intact panel if it reads, otherwise whatever of it does.

    Schema drift is deliberately not caught here: a panel whose columns have
    drifted is a producer bug, and serving part of it would hide the bug
    behind a coverage notice.
    """
    try:
        return parquet_bytes_to_panel(data), []
    except (pa.ArrowException, OSError, ValueError):
        pass
    try:
        salvaged = read_panel_resilient(data)
    except (pa.ArrowException, OSError, ValueError):
        # Not even the footer parsed: there is no partial answer to give, and
        # the caller falls through to the next source or to no panel at all.
        return pd.DataFrame(), []
    return salvaged.frame, salvaged.missing


def _load_universe(store: PanelStore, universe_key: str) -> dict[str, TickerMetadata]:
    """Sector/market-cap metadata is optional: without it the engine simply
    cannot narrow by minMarketCap/sectors, which is strictly better than
    refusing to serve price data at all."""
    if not store.object_exists(universe_key):
        return {}
    return universe_from_csv(store.get_object(universe_key).decode("utf-8"))
