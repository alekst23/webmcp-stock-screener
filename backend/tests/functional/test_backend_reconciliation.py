"""Backend reconciliation: deletes modules that serve no surface, keeps
modules the shipping surface needs, repoints/confirms the deployment
health check, and keeps the layered architecture intact.
"""

from __future__ import annotations

import importlib
import re
from pathlib import Path

import yaml  # type: ignore[import-untyped]  # stub-less: only used to parse a fixture file
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent

_RETIRED_PATHS = (
    BACKEND_ROOT / "api" / "routes" / "research.py",
    BACKEND_ROOT / "api" / "schemas" / "research.py",
    BACKEND_ROOT / "api" / "routes" / "spike.py",
    BACKEND_ROOT / "api" / "schemas" / "spike.py",
    BACKEND_ROOT / "domain" / "models" / "instance.py",
    BACKEND_ROOT / "domain" / "models" / "measurement.py",
    BACKEND_ROOT / "domain" / "models" / "pattern.py",
    BACKEND_ROOT / "domain" / "contracts" / "engine.py",
    BACKEND_ROOT / "infra" / "pandas_engine.py",
    BACKEND_ROOT / "tests" / "mocks" / "mock_pattern_research_engine.py",
    BACKEND_ROOT / "tests" / "functional" / "test_research_routes.py",
    BACKEND_ROOT / "tests" / "functional" / "test_spike_ping.py",
    BACKEND_ROOT / "tests" / "unit" / "test_pattern_research_engine.py",
    BACKEND_ROOT / "tests" / "unit" / "test_query_engine_stats.py",
    BACKEND_ROOT / "tests" / "unit" / "test_universe_metadata.py",
)


class TestDeadModulesRemoved:
    """spec.md "Backend reconciliation / Dead module" scenario."""

    def test_research_routes_no_longer_registered_in_main(self) -> None:
        main_source = (BACKEND_ROOT / "main.py").read_text()

        assert "research_router" not in main_source, (
            "expected backend/main.py to no longer reference research_router (AC2/AC4), found "
            f"it in:\n{main_source}"
        )
        assert "spike_router" not in main_source, (
            f"expected backend/main.py to no longer reference spike_router (AC2/AC4), found it "
            f"in:\n{main_source}"
        )
        assert "api.routes.research" not in main_source, (
            "expected backend/main.py to no longer import api.routes.research (AC2/AC4), found "
            f"it in:\n{main_source}"
        )
        assert "api.routes.spike" not in main_source, (
            f"expected backend/main.py to no longer import api.routes.spike (AC2/AC4), found it "
            f"in:\n{main_source}"
        )

    def test_spike_module_and_its_test_are_deleted(self) -> None:
        for path in (
            BACKEND_ROOT / "api" / "routes" / "spike.py",
            BACKEND_ROOT / "api" / "schemas" / "spike.py",
            BACKEND_ROOT / "tests" / "functional" / "test_spike_ping.py",
        ):
            assert not path.exists(), f"expected {path} to have been deleted (AC2), but it exists"

    def test_pandas_engine_and_legacy_domain_models_deleted_if_new_screener_does_not_need_them(
        self,
    ) -> None:
        for path in _RETIRED_PATHS:
            assert not path.exists(), f"expected {path} to have been deleted (AC2), but it exists"

    def test_universe_metadata_coverage_rehomed_before_its_test_file_is_deleted(self) -> None:
        old_file = BACKEND_ROOT / "tests" / "unit" / "test_universe_metadata.py"
        assert not old_file.exists(), (
            f"expected {old_file} to have been deleted after its coverage was re-homed, but it "
            "exists"
        )

        rehomed_file = BACKEND_ROOT / "tests" / "unit" / "test_universe_eligibility.py"
        rehomed_source = rehomed_file.read_text()
        assert "class TestUniverseMetadataParsing" in rehomed_source, (
            f"expected {rehomed_file} to contain the re-homed TestUniverseMetadataParsing "
            f"class, found:\n{rehomed_source}"
        )
        assert "parse_screener_csv" in rehomed_source, (
            "expected the re-homed test to still exercise infra.nasdaq_screener's "
            f"parse_screener_csv, found:\n{rehomed_source}"
        )

        # Every consumer that used to import fixtures from the deleted module
        # must now point somewhere that still exists (AC3 -- the suite must
        # actually collect and pass, not merely have the class present).
        pipeline_test = BACKEND_ROOT / "tests" / "functional" / "test_real_data_pipeline.py"
        pipeline_source = pipeline_test.read_text()
        assert "test_universe_metadata" not in pipeline_source, (
            f"expected {pipeline_test} to no longer import from the deleted "
            f"test_universe_metadata module, found:\n{pipeline_source}"
        )


class TestSurvivingModulesUnaffected:
    """spec.md "Backend reconciliation / Surviving module" scenario."""

    def test_expression_py_survives_and_similarity_features_still_imports_it(self) -> None:
        expression_path = BACKEND_ROOT / "infra" / "expression.py"
        assert expression_path.exists(), (
            f"expected {expression_path} to remain -- it is imported by "
            "infra/similarity_features.py (EPIC-1012, live)"
        )

        similarity_features_source = (BACKEND_ROOT / "infra" / "similarity_features.py").read_text()
        assert "expression" in similarity_features_source, (
            "expected infra/similarity_features.py to still import from infra.expression, "
            f"found:\n{similarity_features_source}"
        )

        # Importable, not merely present on disk.
        import infra.expression  # noqa: F401
        import infra.similarity_features  # noqa: F401

    def test_similarity_and_backtest_routes_and_their_tests_still_pass(self) -> None:
        for path in (
            BACKEND_ROOT / "api" / "routes" / "similarity.py",
            BACKEND_ROOT / "api" / "routes" / "backtest.py",
            BACKEND_ROOT / "tests" / "functional" / "test_similarity_routes.py",
            BACKEND_ROOT / "tests" / "unit" / "test_backtest_routes.py",
        ):
            assert path.exists(), f"expected {path} to remain (AC3), but it is missing"

        main_source = (BACKEND_ROOT / "main.py").read_text()
        assert "similarity_router" in main_source, (
            "expected backend/main.py to still register similarity_router (AC3/AC4), found:\n"
            f"{main_source}"
        )
        assert "backtest_router" in main_source, (
            "expected backend/main.py to still register backtest_router (AC3/AC4), found:\n"
            f"{main_source}"
        )


class TestHealthCheckTargetsRealEndpoint:
    """spec.md "Backend reconciliation / Health check on retired endpoint" scenario."""

    def test_render_yaml_health_check_path_points_at_an_existing_endpoint(self) -> None:
        render_config = yaml.safe_load((REPO_ROOT / "render.yaml").read_text())
        services = render_config["services"]
        # Only the web service has a healthCheckPath at all -- the nightly
        # cron service is probed by its own run/exit status, not HTTP.
        health_check_paths = {
            service["healthCheckPath"] for service in services if "healthCheckPath" in service
        }

        from api.routes.health import HEALTH_PATH

        assert health_check_paths == {HEALTH_PATH}, (
            f"expected render.yaml's healthCheckPath to match api/routes/health.py's own "
            f"HEALTH_PATH constant {HEALTH_PATH!r} (AC5), got {sorted(health_check_paths)}"
        )

        import main as main_module

        importlib.reload(main_module)
        with TestClient(main_module.app) as client:
            response = client.get(HEALTH_PATH)

        assert response.status_code == 200, (
            f"expected {HEALTH_PATH} to resolve to a real, registered route after this "
            f"ticket's deletions (AC5), got {response.status_code}: {response.text}"
        )

    def test_health_endpoint_reports_genuine_service_health_not_spike_data(self) -> None:
        health_source = (BACKEND_ROOT / "api" / "routes" / "health.py").read_text()
        import_lines = [
            line.strip()
            for line in health_source.splitlines()
            if re.match(r"^\s*(from|import)\s", line)
        ]

        assert not any("api.routes.spike" in line for line in import_lines), (
            f"expected api/routes/health.py's imports to not include api.routes.spike, found: "
            f"{import_lines}"
        )
        assert not any("api.routes.research" in line for line in import_lines), (
            f"expected api/routes/health.py's imports to not include api.routes.research, "
            f"found: {import_lines}"
        )
        assert not any(
            "pandas" in line for line in import_lines
        ), f"expected api/routes/health.py to read no panel data (AC5), found: {import_lines}"

        import main as main_module

        importlib.reload(main_module)
        with TestClient(main_module.app) as client:
            response = client.get("/health")

        assert response.status_code == 200, (
            f"expected /health to report genuine liveness, got {response.status_code}: "
            f"{response.text}"
        )
        assert response.json() == {"status": "ok"}, (
            f"expected /health's own liveness payload, not echoed panel/spike data, got "
            f"{response.json()}"
        )

    def test_health_test_classes_repointed_off_spike_and_research_endpoints(self) -> None:
        test_health_source = (BACKEND_ROOT / "tests" / "functional" / "test_health.py").read_text()
        code_lines = [
            line for line in test_health_source.splitlines() if not line.strip().startswith("#")
        ]
        code_only = "\n".join(code_lines)

        for class_name in (
            "TestHealthRateLimitExemption",
            "TestHealthIndependentOfSpikeStack",
            "TestResearchPanelUnaffected",
        ):
            assert class_name in test_health_source, (
                f"expected {class_name} to still exist in test_health.py, found:\n"
                f"{test_health_source}"
            )

        assert '"/api/spike/ping"' not in code_only, (
            "expected test_health.py's code (comments aside) to no longer exercise "
            f"/api/spike/ping as its vehicle, found:\n{code_only}"
        )
        assert '"/api/research/panel"' not in code_only, (
            "expected test_health.py's code (comments aside) to no longer exercise "
            f"/api/research/panel as its vehicle, found:\n{code_only}"
        )
        import_lines = [
            line.strip() for line in code_lines if re.match(r"^\s*(from|import)\s", line)
        ]
        assert not any("api.routes.spike" in line for line in import_lines), (
            f"expected test_health.py to no longer import from api.routes.spike, found: "
            f"{import_lines}"
        )


class TestLayeringHolds:
    """spec.md "Backend reconciliation / Layering" scenario."""

    def test_domain_layer_imports_nothing_from_infra_after_cleanup(self) -> None:
        domain_dir = BACKEND_ROOT / "domain"
        offenders: dict[str, list[str]] = {}

        for path in sorted(domain_dir.rglob("*.py")):
            source = path.read_text()
            bad_lines = [
                line.strip()
                for line in source.splitlines()
                if re.match(r"^\s*(from|import)\s+infra(\.|\s)", line)
            ]
            if bad_lines:
                offenders[str(path.relative_to(BACKEND_ROOT))] = bad_lines

        assert not offenders, (
            f"expected backend/domain/ to import nothing from backend/infra/ (AC7), found:\n"
            f"{offenders}"
        )

    def test_cors_still_admits_deployed_frontend_and_local_dev_origins(self) -> None:
        main_source = (BACKEND_ROOT / "main.py").read_text()

        assert "CORS_ALLOWED_ORIGINS" in main_source, (
            f"expected backend/main.py to still read CORS_ALLOWED_ORIGINS (AC6), found:\n"
            f"{main_source}"
        )
        assert "http://localhost:5173" in main_source, (
            f"expected backend/main.py's CORS default to still admit the local dev origin "
            f"(AC6), found:\n{main_source}"
        )
        assert "CORSMiddleware" in main_source, (
            f"expected backend/main.py to still register CORSMiddleware (AC6), found:\n"
            f"{main_source}"
        )

        env_example = (BACKEND_ROOT / ".env.example").read_text()
        assert "CORS_ALLOWED_ORIGINS" in env_example, (
            f"expected backend/.env.example to still document CORS_ALLOWED_ORIGINS for the "
            f"deployed frontend origin (AC6), found:\n{env_example}"
        )
