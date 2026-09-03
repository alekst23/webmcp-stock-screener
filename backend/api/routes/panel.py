"""The loaded panel's own status endpoint (post-EPIC-1015 hardening: bug
fix, see git history).

T-1015-4 deleted api/routes/research.py, including the only route that
served the panel's provenance/freshness (`GET /api/research/panel`) --
`src/lib/workspace/panelStatus.ts`'s `fetchPanelStatus`, a live new-surface
consumer feeding the shell's data-freshness pill, depended on it. T-1015-4's
"no importer outside the retiring set" check was import-graph based and
missed this the same way it missed the chart's bars endpoint: the frontend
calls the URL as a string, not a static import.

`domain/panel_disclosure.py`'s `disclose()` (T-0013-5) was deleted alongside
the route as "unused" -- true only because its sole caller had just been
removed in the same commit. It is pure domain logic over `PanelStatus`, with
no coupling to the retired pattern-research engine, so it is restored
unmodified rather than reimplemented.

Deliberately thin, mirroring api/routes/similarity.py's own convention: the
route resolves the panel status main.py's lifespan already loaded into
`app.state`, discloses it, and returns it.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Request

from domain.models.panel import PanelStatus
from domain.panel_disclosure import disclose

router = APIRouter(prefix="/api/panel", tags=["panel"])

# Mirrors api/routes/similarity.py's and api/routes/chart.py's own _NO_PANEL
# guard: this route reads off the same loaded panel, so it fails the same
# way for the same reason.
_NO_PANEL = (
    "No price panel is loaded, so there is nothing to report. The panel could "
    "not be read from object storage and no local mock panel exists. From "
    "backend/, run `uv run python scripts/generate_mock_panel.py` first."
)


@router.get("/status", response_model=PanelStatus)
def get_status(request: Request) -> PanelStatus:
    status = getattr(request.app.state, "panel_status", None)
    if not isinstance(status, PanelStatus):
        raise HTTPException(status_code=503, detail=_NO_PANEL)
    return disclose(status, today=date.today())
