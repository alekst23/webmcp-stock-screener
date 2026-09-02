from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Liveness response (T-0016-2): process identity only.

    Deliberately carries no panel state -- that would make this a readiness
    signal, which api/routes/health.py's module docstring explains is out of
    scope."""

    status: str
