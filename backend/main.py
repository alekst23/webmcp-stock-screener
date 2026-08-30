"""FastAPI application entrypoint.

Run locally from backend/:
    uv run uvicorn main:app --reload

Serves the T-1001-2 platform spike endpoint and T-1001-5's 5 real networked
WebMCP tool endpoints (api/routes/research.py).
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Awaitable, Callable

import pandas as pd
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from limits import RateLimitItem, parse
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from api.routes.research import router as research_router
from api.routes.spike import router as spike_router
from domain.models.price import PriceBar
from infra.pandas_engine import PandasPatternResearchEngine

PANEL_PATH = Path(__file__).resolve().parent / "data" / "mock" / "panel.parquet"


def _allowed_origins() -> list[str]:
    """CORS origins allowed to call this API, from CORS_ALLOWED_ORIGINS
    (comma-separated). Defaults to the local Vite dev server so the spike
    tool's fetch() from the frontend works out of the box (see
    backend/.env.example)."""
    raw = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _load_engine() -> PandasPatternResearchEngine | None:
    """Load the mock panel into memory once at startup (docs/plan.md: 'loaded
    into memory at startup for low-latency reads'). Returns None when the
    panel hasn't been generated yet -- api/routes/research.py's dependency
    then surfaces a clear 503 instead of crashing app startup, mirroring the
    spike endpoint's own guard."""
    if not PANEL_PATH.exists():
        return None
    frame = pd.read_parquet(PANEL_PATH)
    bars = [PriceBar(**row) for row in frame.to_dict("records")]
    return PandasPatternResearchEngine.from_price_bars(bars)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.engine = _load_engine()
    yield


def _rate_limit_default() -> str:
    """Default per-client request budget for every route, from
    RATE_LIMIT_DEFAULT (limits' "<count>/<period>" syntax, e.g. "60/minute").
    Deployed alone with mock data (T-1001-8), the goal is basic abuse
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

    def __init__(self, app: ASGIApp, limiter: Limiter, rate_limit: RateLimitItem) -> None:
        super().__init__(app)
        self._limiter = limiter
        self._rate_limit = rate_limit

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        client_key = get_remote_address(request)
        if not self._limiter.limiter.hit(self._rate_limit, client_key):
            return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429)
        return await call_next(request)


limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="WebMCP Pattern Research Workbench API", lifespan=_lifespan)

app.add_middleware(RateLimitMiddleware, limiter=limiter, rate_limit=parse(_rate_limit_default()))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(spike_router)
app.include_router(research_router)


def main() -> None:
    print("Hello from backend!")


if __name__ == "__main__":
    main()
