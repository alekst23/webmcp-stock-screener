"""T-1001-2 platform spike endpoint.

Deliberately reads the mock Parquet panel with pandas directly in the route
handler -- no read abstraction here; a proper panel-reading contract belongs
to T-1001-3. This whole module is throwaway, superseded once T-1001-5 wires
the real tool endpoints.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from fastapi import APIRouter, HTTPException

from api.schemas.spike import SpikePingResponse
from domain.models.price import PriceBar

router = APIRouter(prefix="/api/spike", tags=["spike"])

PANEL_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "mock" / "panel.parquet"


@router.get("/ping", response_model=SpikePingResponse)
def ping() -> SpikePingResponse:
    """Return one sample row read live from the mock panel on disk.

    Exists to prove a WebMCP tool's ``execute()`` can reach this backend
    over a real HTTP request and get back data sourced from a separate,
    genuinely running process -- not a hardcoded or in-process response
    (T-1001-2 AC3/AC4).
    """
    if not PANEL_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail=(
                f"Mock panel not found at {PANEL_PATH}. From backend/, run "
                "`uv run python scripts/generate_mock_panel.py` first."
            ),
        )

    frame = pd.read_parquet(PANEL_PATH)
    row = frame.iloc[0]
    sample = PriceBar(
        ticker=str(row["ticker"]),
        date=row["date"],
        open=float(row["open"]),
        high=float(row["high"]),
        low=float(row["low"]),
        close=float(row["close"]),
        volume=int(row["volume"]),
    )
    return SpikePingResponse(message="pong from a live FastAPI backend", sample=sample)
