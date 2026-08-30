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

import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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


app = FastAPI(title="WebMCP Pattern Research Workbench API", lifespan=_lifespan)

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
