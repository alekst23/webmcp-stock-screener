"""Resolve the panel and universe metadata the API serves at startup.

Object storage first, the local mock panel as fallback. The fallback is not a
transitional shim: a local checkout, every test run, and a first deploy
against an empty bucket all legitimately have no stored panel, and each must
still boot rather than fail closed on a missing object.

Damage is handled the same way: a panel with an unreadable row group is
loaded without it and says which tickers are missing, rather than refusing to
serve the ones that are fine. Only a panel with nothing readable in it is a
failure (T-0013-5).

A configured store is a different matter. `store is None` means no bucket
was ever named -- the mock fallback is correct there. `store is not None`
means a bucket was named, so `ensure_reachable()` runs before anything else
and its PanelStoreError is left to propagate: a wrong bucket, a denied
permission, or credentials that never resolve must abort startup, never
degrade to the mock panel (T-0016-3).

`store is None` being "correct" is itself opt-out, not universal: a
production deploy that never named a bucket is exactly the hazard T-0016-12
exists to close (Render's declared config drifting from the code's expected
variable names would otherwise fail this way, invisibly). `require_object_store`
is that ticket's flag -- off by default so this fallback keeps working for
every local checkout and every existing test unchanged, and when on, `store
is None` refuses to start instead of falling through to the mock.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import pyarrow as pa

from domain.contracts.panel_store import PanelStore
from domain.errors import PanelStoreError
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
    *,
    require_object_store: bool = False,
) -> LoadedPanel | None:
    """Load the best available panel, or None when there is none at all.

    None (rather than an exception) keeps the existing degenerate-startup
    behavior intact: api/routes/research.py already answers 503 with a
    remediation message when no engine is loaded.

    `require_object_store` (T-0016-12) is the opt-in production guard: with
    it True and `store` None, the mock fallback below is refused rather than
    taken, raising PanelStoreError instead. Off by default, it never fires
    for a local checkout or the test suite. It is not consulted at all when
    `store is not None` -- a configured-but-unreachable store already aborts
    startup on its own via `ensure_reachable()`, and duplicating that check
    here would just be a second way to reach the same failure.
    """
    if store is not None:
        store.ensure_reachable()
        if store.object_exists(panel_key):
            loaded = _loaded(store.get_object(panel_key), source="object-store")
            if loaded is not None:
                return LoadedPanel(loaded.panel, _load_universe(store, universe_key), loaded.status)
    elif require_object_store:
        raise PanelStoreError(
            "REQUIRE_REAL_PANEL is set but no object store is configured "
            "(OBJECT_STORE_BUCKET is unset); refusing to start on the mock panel."
        )
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
