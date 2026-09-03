"""FastAPI application entrypoint.

Run locally from backend/:
    uv run uvicorn main:app --reload

Serves the liveness health check plus the similarity, backtest, chart and
panel-status routes that back the new panel/workspace surface. The platform
spike endpoint and the legacy 5-endpoint research/pattern-search surface
(api/routes/research.py), along with the pandas pattern-research engine
underneath it, have been retired -- neither has an importer left in the
tree. (api/routes/chart.py and api/routes/panel.py are their own small,
new-surface routes added post-cutover after research.py's deletion turned
out to have taken two live new-surface dependencies down with it -- see
their own module docstrings.)
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from limits import RateLimitItem, parse
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from api.routes.backtest import router as backtest_router
from api.routes.chart import router as chart_router
from api.routes.health import HEALTH_PATH
from api.routes.health import router as health_router
from api.routes.panel import router as panel_router
from api.routes.similarity import router as similarity_router
from application.backtest_jobs import BacktestJobStore
from application.load_panel import load_panel
from domain.backtest_engine import PortBacktestEngine
from domain.contracts.backtest_engine import BacktestEngine
from domain.models.panel import PanelStatus
from infra.object_store import S3PanelStore, config_from_env
from infra.panel_market_data import NoFundamentalsPort, PanelPriceSeriesPort, PanelReferenceDataPort
from infra.similarity_engine import PandasSimilarityEngine

PANEL_PATH = Path(__file__).resolve().parent / "data" / "mock" / "panel.parquet"


def _allowed_origins() -> list[str]:
    """CORS origins allowed to call this API, from CORS_ALLOWED_ORIGINS
    (comma-separated). Defaults to the local Vite dev server so a fetch()
    from the frontend works out of the box (see backend/.env.example)."""
    raw = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _panel_store() -> S3PanelStore | None:
    """The R2/S3 panel store, or None when its config isn't set.

    None is a supported state, not a misconfiguration: local checkouts and
    test runs have no object-store credentials and fall back to the mock
    panel below (see application/load_panel.py)."""
    config = config_from_env()
    return S3PanelStore(config) if config else None


def _require_real_panel() -> bool:
    """T-0016-12: opt-in production guard, off by default, so a deploy can
    refuse to start on the mock panel instead of silently serving synthetic
    data as though it were real. Every local checkout and the whole test
    suite leave REQUIRE_REAL_PANEL unset and are unaffected; render.yaml
    turns it on for the production web service only (see
    backend/.env.example)."""
    return os.environ.get("REQUIRE_REAL_PANEL", "").strip().lower() in {"1", "true"}


def _load_engine() -> (
    tuple[
        PandasSimilarityEngine | None,
        BacktestEngine | None,
        PanelStatus | None,
        PanelPriceSeriesPort | None,
    ]
):
    """Load the panel into memory once at startup (docs/plan.md: 'loaded into
    memory at startup for low-latency reads'), preferring the real
    object-store panel over T-0001-1's mock one.

    Returns (None, None, None, None) when no panel exists anywhere --
    api/routes/similarity.py's, api/routes/backtest.py's and
    api/routes/chart.py's dependencies then surface a clear 503 instead of
    crashing app startup, mirroring the liveness probe's own tolerance for a
    missing panel (api/routes/health.py). That fallback is itself refused
    when REQUIRE_REAL_PANEL is set and no object store is configured -- see
    `_require_real_panel` and `load_panel`.

    The same `PanelPriceSeriesPort` instance backs both the backtest
    engine's price port and api/routes/chart.py's bar-serving endpoint
    (T-1014-6 built it, this reuses it rather than constructing a second
    wrapper over the same panel)."""
    loaded = load_panel(_panel_store(), PANEL_PATH, require_object_store=_require_real_panel())
    if loaded is None:
        return None, None, None, None
    similarity_engine = PandasSimilarityEngine(loaded.panel, loaded.status)
    price_series_port = PanelPriceSeriesPort(loaded.panel, loaded.status)
    backtest_engine = PortBacktestEngine(
        price_port=price_series_port,
        fundamentals_port=NoFundamentalsPort(),
        reference_port=PanelReferenceDataPort(loaded.panel, loaded.universe),
    )
    return similarity_engine, backtest_engine, loaded.status, price_series_port


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    (
        app.state.similarity_engine,
        app.state.backtest_engine,
        app.state.panel_status,
        app.state.price_series_port,
    ) = _load_engine()
    app.state.backtest_jobs = BacktestJobStore()
    yield


def _rate_limit_default() -> str:
    """Default per-client request budget for every route, from
    RATE_LIMIT_DEFAULT (limits' "<count>/<period>" syntax, e.g. "60/minute").
    Deployed alone with mock data (T-0001-8), the goal is basic abuse
    protection, not tuned capacity planning -- see docs/plan.md's
    rate-limiting decision (backend/.env.example)."""
    return os.environ.get("RATE_LIMIT_DEFAULT", "60/minute")


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Applies a single per-client-address budget to every request.

    slowapi's own SlowAPIMiddleware locates the matched route by walking
    `app.routes` and matching each entry's `.endpoint` attribute -- but
    FastAPI (as of 0.141) lazily wraps `include_router()`-registered routes
    behind an opaque `_IncludedRouter` with no `.endpoint`, so that walk
    never finds a match and every request is silently exempted (verified
    empirically: request counts never reached the configured storage under
    SlowAPIMiddleware). Checking the limit here -- keyed only by client
    address, since AC4 wants blanket abuse protection rather than
    per-endpoint budgets -- sidesteps that incompatibility while still
    reusing slowapi/limits' storage and window-counting strategy.
    """

    def __init__(
        self,
        app: ASGIApp,
        limiter: Limiter,
        rate_limit: RateLimitItem,
        exempt_paths: frozenset[str] = frozenset(),
    ) -> None:
        super().__init__(app)
        self._limiter = limiter
        self._rate_limit = rate_limit
        self._exempt_paths = exempt_paths

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        # The liveness probe (T-0016-2 AC4) is exempt so a platform health
        # check at its own interval can never be throttled into a false
        # negative -- checked by path, not by keying off the caller's
        # address, since the whole point is that this path has no budget.
        if request.url.path in self._exempt_paths:
            return await call_next(request)
        client_key = get_remote_address(request)
        if not self._limiter.limiter.hit(self._rate_limit, client_key):
            return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429)
        return await call_next(request)


limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="WebMCP Pattern Research Workbench API", lifespan=_lifespan)

app.add_middleware(
    RateLimitMiddleware,
    limiter=limiter,
    rate_limit=parse(_rate_limit_default()),
    exempt_paths=frozenset({HEALTH_PATH}),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(similarity_router)
app.include_router(backtest_router)
app.include_router(chart_router)
app.include_router(panel_router)


def main() -> None:
    print("Hello from backend!")


if __name__ == "__main__":
    main()
