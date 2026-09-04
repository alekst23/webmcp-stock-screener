"""T-0025-2's HTTP boundary onto `domain.screener_run_engine.PortScreenerRunEngine`:
a screener definition in, a bounded ranked result set (or a named refusal)
out. Stateless -- no job store, no persistence, mirroring
`api/routes/chart.py`'s thin synchronous dependency-injection convention
rather than `api/routes/backtest.py`'s async-job one (the epic's own
"stateless... in, out" framing rules out a background job here).

Deliberately thin: request validation and error mapping only. All
narrowing/resolution/evaluation/ranking logic stays in the domain engine --
this file never computes anything.
"""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Depends, HTTPException, Request

from api.schemas.screener import ScreenerRunRequestWire, ScreenerRunResponseWire
from domain.contracts.screener_run_engine import ScreenerRunEngine

router = APIRouter(prefix="/api/screener", tags=["screener"])

# Mirrors api/routes/backtest.py's/chart.py's own _NO_ENGINE/_NO_PANEL
# convention: this route reads off the same loaded panel, so it fails the
# same way for the same reason.
_NO_ENGINE = (
    "No price panel is loaded, so there is nothing to screen against. The panel could "
    "not be read from object storage and no local mock panel exists. From "
    "backend/, run `uv run python scripts/generate_mock_panel.py` first."
)


def get_screener_engine(request: Request) -> ScreenerRunEngine:
    engine = getattr(request.app.state, "screener_engine", None)
    if engine is None:
        raise HTTPException(status_code=503, detail=_NO_ENGINE)
    return cast(ScreenerRunEngine, engine)


@router.post("/run", response_model=ScreenerRunResponseWire)
def run_screener(
    payload: ScreenerRunRequestWire,
    engine: ScreenerRunEngine = Depends(get_screener_engine),
) -> ScreenerRunResponseWire:
    return engine.run(payload)
