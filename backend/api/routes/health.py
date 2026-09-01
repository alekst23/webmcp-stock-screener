"""T-0016-2: liveness endpoint for the platform's health check (AWS App
Runner probes an HTTP GET at a configured interval).

Liveness only, not readiness: success means this process is up and serving
HTTP, nothing about whether a panel is loaded or which one. T-0013-5 chose
to disclose panel degradation to the user rather than fail on it; a probe
that asserted panel readiness would turn a visible-but-working degraded
deploy into an outage the moment the mock fallback is what's serving. Panel
provenance and staleness stay on `GET /api/research/panel` -- see
docs/design/aws-replatform/technical.md's "Liveness endpoint" section.

Deliberately imports nothing from api.routes.spike or api.routes.research:
this module's registration in main.py does not depend on either coexisting,
so deleting every route under /api/spike (AC5) cannot break this one.
"""

from __future__ import annotations

from fastapi import APIRouter

from api.schemas.health import HealthResponse

HEALTH_PATH = "/health"

router = APIRouter(tags=["health"])


@router.get(HEALTH_PATH, response_model=HealthResponse)
def health() -> HealthResponse:
    """Return success whenever this process is up and serving HTTP.

    No `Request`, no dependency on `app.state`, no file or object-store
    read, and no panel computation (AC1-AC3) -- there is nothing here for
    any of those to depend on.
    """
    return HealthResponse(status="ok")
