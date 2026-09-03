"""T-1015-4: failing test stubs for backend reconciliation.

Deletes modules that serve no surface; keeps modules the new surface
needs; repoints/confirms the deployment health check; keeps the layered
architecture intact. See T-1015-4's Solution Approach for the concrete
module-by-module disposition this ticket executes.

Each stub currently fails with ``pytest.fail("not implemented")``; the
real assertions land when T-1015-4 is implemented.
"""

from __future__ import annotations

import pytest


class TestDeadModulesRemoved:
    """spec.md "Backend reconciliation / Dead module" scenario."""

    def test_research_routes_no_longer_registered_in_main(self) -> None:
        pytest.fail(
            "not implemented: T-1015-4 AC2/AC4 -- backend/main.py no longer calls "
            "app.include_router(research_router)"
        )

    def test_spike_module_and_its_test_are_deleted(self) -> None:
        pytest.fail(
            "not implemented: T-1015-4 AC2 -- backend/api/routes/spike.py, "
            "api/schemas/spike.py, and tests/functional/test_spike_ping.py no longer exist"
        )

    def test_pandas_engine_and_legacy_domain_models_deleted_if_new_screener_does_not_need_them(
        self,
    ) -> None:
        pytest.fail(
            "not implemented: T-1015-4 -- infra/pandas_engine.py, domain/models/instance.py, "
            "measurement.py, pattern.py, domain/contracts/engine.py deleted once confirmed "
            "unneeded by the new screener (per the inventory's classification)"
        )

    def test_universe_metadata_coverage_rehomed_before_its_test_file_is_deleted(self) -> None:
        pytest.fail(
            "not implemented: T-1015-4 -- nasdaq_screener.py parsing coverage incidentally "
            "covered by test_universe_metadata.py is re-homed into a surviving test file "
            "before that file is deleted"
        )


class TestSurvivingModulesUnaffected:
    """spec.md "Backend reconciliation / Surviving module" scenario."""

    def test_expression_py_survives_and_similarity_features_still_imports_it(self) -> None:
        pytest.fail(
            "not implemented: T-1015-4 -- infra/expression.py remains importable and "
            "infra/similarity_features.py's import of it still resolves"
        )

    def test_similarity_and_backtest_routes_and_their_tests_still_pass(self) -> None:
        pytest.fail(
            "not implemented: T-1015-4 AC3 -- backend/api/routes/similarity.py and backtest.py "
            "remain registered and their test suites pass unweakened"
        )


class TestHealthCheckTargetsRealEndpoint:
    """spec.md "Backend reconciliation / Health check on retired endpoint" scenario."""

    def test_render_yaml_health_check_path_points_at_an_existing_endpoint(self) -> None:
        pytest.fail(
            "not implemented: T-1015-4 AC5 -- render.yaml's healthCheckPath resolves to a "
            "route that exists after this ticket's deletions (expected: /health, already "
            "correct per T-1015-1's audit -- this test guards against regression)"
        )

    def test_health_endpoint_reports_genuine_service_health_not_spike_data(self) -> None:
        pytest.fail(
            "not implemented: T-1015-4 AC5 -- GET /health does not read the mock panel or "
            "depend on api.routes.spike/api.routes.research"
        )

    def test_health_test_classes_repointed_off_spike_and_research_endpoints(self) -> None:
        pytest.fail(
            "not implemented: T-1015-4 -- test_health.py's TestHealthRateLimitExemption, "
            "TestHealthIndependentOfSpikeStack, TestResearchPanelUnaffected no longer exercise "
            "/api/spike/ping or /api/research/panel as their vehicle"
        )


class TestLayeringHolds:
    """spec.md "Backend reconciliation / Layering" scenario."""

    def test_domain_layer_imports_nothing_from_infra_after_cleanup(self) -> None:
        pytest.fail(
            "not implemented: T-1015-4 AC7 -- arch-check style import scan of backend/domain/ "
            "finds no import from backend/infra/"
        )

    def test_cors_still_admits_deployed_frontend_and_local_dev_origins(self) -> None:
        pytest.fail(
            "not implemented: T-1015-4 AC6 -- CORS_ALLOWED_ORIGINS handling in main.py still "
            "admits both origins after the router cleanup"
        )
