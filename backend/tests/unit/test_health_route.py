"""T-0016-2: the liveness handler itself, isolated from HTTP/ASGI plumbing.

Proves AC1-AC3 at the fastest tier: the handler needs no request, no engine,
and no app state, so calling it directly (no TestClient, no lifespan) is
sufficient to exercise its full behavior.
"""

from __future__ import annotations

from api.routes.health import health


class TestHealthHandler:
    def test_health_returns_ok_status_with_no_arguments(self) -> None:
        response = health()

        assert response.status == "ok", f"expected status 'ok', got {response.status!r}"
