"""FastAPI application entrypoint.

Run locally from backend/:
    uv run uvicorn main:app --reload

Serves the T-1001-2 platform spike endpoint today. T-1001-5 will add the
real 5 networked WebMCP tool endpoints alongside it.
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes.spike import router as spike_router


def _allowed_origins() -> list[str]:
    """CORS origins allowed to call this API, from CORS_ALLOWED_ORIGINS
    (comma-separated). Defaults to the local Vite dev server so the spike
    tool's fetch() from the frontend works out of the box (see
    backend/.env.example)."""
    raw = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app = FastAPI(title="WebMCP Pattern Research Workbench API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(spike_router)


def main() -> None:
    print("Hello from backend!")


if __name__ == "__main__":
    main()
