"""T-1001-8: rate limiting and CORS lockdown for the deployed backend.

Both tests reload the `main` module after patching the relevant env var,
since `main.py` reads `RATE_LIMIT_DEFAULT`/`CORS_ALLOWED_ORIGINS` once at
import time (see main.py's `_rate_limit_default`/`_allowed_origins`) --
a fresh app + limiter is the only way to exercise a specific value from a
test.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

import main as main_module
from api.routes.spike import PANEL_PATH
from scripts.generate_mock_panel import generate_panel, write_panel


def _reload_app_with_panel() -> None:
    """Reload `main` so the just-patched env var takes effect, then
    regenerate the mock panel `/api/spike/ping` reads from (same setup as
    test_spike_ping.py -- the panel is a gitignored build artifact)."""
    importlib.reload(main_module)
    write_panel(generate_panel(), output_path=PANEL_PATH)


class TestRateLimiting:
    def test_excessive_requests_return_429_after_threshold(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A low, test-only budget makes the 429 boundary deterministic and
        # fast to exercise, rather than firing 61 real requests against
        # production's actual default.
        monkeypatch.setenv("RATE_LIMIT_DEFAULT", "3/minute")
        _reload_app_with_panel()

        with TestClient(main_module.app) as client:
            responses = [client.get("/api/spike/ping") for _ in range(4)]

        for index, response in enumerate(responses[:3]):
            assert response.status_code == 200, (
                f"expected request {index}, within the 3/minute budget, to return 200, "
                f"got {response.status_code}: {response.text}"
            )
        over_budget = responses[3]
        assert over_budget.status_code == 429, (
            "expected the 4th request, over the 3/minute budget, to return 429, got "
            f"{over_budget.status_code}: {over_budget.text}"
        )

        monkeypatch.delenv("RATE_LIMIT_DEFAULT", raising=False)
        _reload_app_with_panel()  # restore the real default for any later test


class TestCorsConfiguration:
    def test_only_configured_origin_is_allowed_by_cors(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://allowed.example.com")
        _reload_app_with_panel()

        with TestClient(main_module.app) as client:
            allowed = client.get(
                "/api/spike/ping", headers={"Origin": "https://allowed.example.com"}
            )
            disallowed = client.get(
                "/api/spike/ping", headers={"Origin": "https://not-allowed.example.com"}
            )

        assert (
            allowed.headers.get("access-control-allow-origin") == "https://allowed.example.com"
        ), f"expected the configured origin to be echoed back, got headers {dict(allowed.headers)}"
        assert "access-control-allow-origin" not in disallowed.headers, (
            "expected an origin outside CORS_ALLOWED_ORIGINS to get no allow header, got "
            f"headers {dict(disallowed.headers)}"
        )

        monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
        _reload_app_with_panel()  # restore the local-dev default for any later test
