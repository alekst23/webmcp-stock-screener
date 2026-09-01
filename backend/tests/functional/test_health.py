"""T-0016-2: liveness endpoint for the App Runner health check.

Exercises api/routes/health.py's HTTP wiring against real app instances --
NOT api/routes/spike.py or api/routes/research.py, which stay the answer for
"is the panel real and current" (see docs/design/aws-replatform/technical.md's
"Liveness endpoint" section). AC6 (that surface is unchanged) is covered by
the existing test_research_routes.py/test_panel_disclosure.py suites; this
file only adds one reachability check to confirm the health route didn't
disturb it.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import main as main_module
from api.routes.health import HEALTH_PATH
from api.routes.health import router as health_router
from api.routes.spike import PANEL_PATH as SPIKE_PANEL_PATH
from infra.object_store import S3PanelStore
from scripts.generate_mock_panel import generate_panel, write_panel


def _reload_app() -> None:
    """Reload `main` so a just-patched env var or module attribute takes
    effect -- main.py reads both once at import/lifespan time (same
    rationale as test_deploy_ops.py's `_reload_app_with_panel`)."""
    importlib.reload(main_module)


class TestHealthLivenessEndpoint:
    def test_health_returns_success_when_the_mock_panel_is_loaded(self) -> None:
        write_panel(generate_panel(), output_path=SPIKE_PANEL_PATH)
        _reload_app()

        with TestClient(main_module.app) as client:
            response = client.get(HEALTH_PATH)

        assert response.status_code == 200, (
            f"expected 200 with the mock panel loaded (AC2), got {response.status_code}: "
            f"{response.text}"
        )

    def test_health_returns_success_when_no_panel_is_loaded_at_all(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        _reload_app()  # reset PANEL_PATH to its default before repointing it
        # No R2/S3 env vars are set in the test environment, so pointing the
        # mock fallback at a file that doesn't exist leaves startup's
        # _load_engine() with nothing to load at all -- AC2's other half.
        monkeypatch.setattr(main_module, "PANEL_PATH", tmp_path / "absent.parquet")

        with TestClient(main_module.app) as client:
            assert (
                main_module.app.state.engine is None
            ), f"expected no engine to have loaded, got {main_module.app.state.engine!r}"
            response = client.get(HEALTH_PATH)

        assert response.status_code == 200, (
            f"expected 200 with no panel loaded at all (AC2), got {response.status_code}: "
            f"{response.text}"
        )

    def test_health_probe_performs_no_file_or_object_store_io(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        write_panel(generate_panel(), output_path=SPIKE_PANEL_PATH)
        _reload_app()

        with TestClient(main_module.app) as client:
            # Patched only after startup's own (legitimate, one-time) load
            # has already run, so a nonzero call count can only mean the
            # /health request path itself performed I/O (AC3).
            read_bytes_mock = MagicMock(side_effect=AssertionError("unexpected file I/O"))
            get_object_mock = MagicMock(side_effect=AssertionError("unexpected object-store I/O"))
            monkeypatch.setattr(Path, "read_bytes", read_bytes_mock)
            monkeypatch.setattr(S3PanelStore, "get_object", get_object_mock)

            response = client.get(HEALTH_PATH)

        assert response.status_code == 200, (
            f"expected 200 from a probe with no I/O available, got {response.status_code}: "
            f"{response.text}"
        )
        assert read_bytes_mock.call_count == 0, (
            "expected the health probe to perform no file I/O (AC3), but Path.read_bytes was "
            f"called {read_bytes_mock.call_count} time(s)"
        )
        assert get_object_mock.call_count == 0, (
            "expected the health probe to perform no object-store call (AC3), but "
            f"S3PanelStore.get_object was called {get_object_mock.call_count} time(s)"
        )


class TestHealthRateLimitExemption:
    def test_health_probe_is_exempt_while_another_route_is_still_throttled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A 1/minute budget makes the boundary deterministic and fast: any
        # exemption failure shows up on the 2nd request, not the 61st.
        monkeypatch.setenv("RATE_LIMIT_DEFAULT", "1/minute")
        _reload_app()
        write_panel(generate_panel(), output_path=SPIKE_PANEL_PATH)

        with TestClient(main_module.app) as client:
            health_responses = [client.get(HEALTH_PATH) for _ in range(5)]
            spike_responses = [client.get("/api/spike/ping") for _ in range(2)]

        for index, response in enumerate(health_responses):
            assert response.status_code == 200, (
                f"expected health probe {index}, over a 1/minute budget, to stay exempt "
                f"(AC4), got {response.status_code}: {response.text}"
            )

        assert spike_responses[0].status_code == 200, (
            "expected the 1st spike request, within the 1/minute budget, to return 200, got "
            f"{spike_responses[0].status_code}: {spike_responses[0].text}"
        )
        assert spike_responses[1].status_code == 429, (
            "expected the 2nd spike request, over the 1/minute budget, to be throttled -- "
            "proving the budget is genuinely active and health's exemption isn't just a high "
            f"limit, got {spike_responses[1].status_code}: {spike_responses[1].text}"
        )

        monkeypatch.delenv("RATE_LIMIT_DEFAULT", raising=False)
        _reload_app()  # restore the real default for any later test


class TestHealthIndependentOfSpikeStack:
    def test_health_works_when_no_other_router_is_registered(self) -> None:
        # Deliberately builds a bare app with ONLY health_router -- no
        # spike_router, no research_router -- to prove AC5 structurally:
        # deleting every /api/spike route cannot break this endpoint,
        # because nothing about it depends on spike existing in the first
        # place.
        app = FastAPI()
        app.include_router(health_router)

        with TestClient(app) as client:
            response = client.get(HEALTH_PATH)

        assert response.status_code == 200, (
            "expected /health to work with every other router absent (AC5), got "
            f"{response.status_code}: {response.text}"
        )


class TestResearchPanelUnaffected:
    def test_research_panel_endpoint_is_still_reachable(self) -> None:
        write_panel(generate_panel(), output_path=SPIKE_PANEL_PATH)
        _reload_app()

        with TestClient(main_module.app) as client:
            response = client.get("/api/research/panel")

        assert response.status_code == 200, (
            "expected GET /api/research/panel to remain the provenance answer, unchanged "
            f"(AC6), got {response.status_code}: {response.text}"
        )
