"""T-0016-12: render.yaml must declare the object-store variable names
infra/object_store.py actually reads.

T-0016-3 renamed those variables from R2_* to OBJECT_STORE_* and cut the old
names rather than aliasing them, but never updated render.yaml -- so a
Render redeploy off this branch would leave the bucket unnamed,
`config_from_env` would return None, and the service would silently serve
the mock panel while passing its health check. This test is the regression
guard for that exact drift recurring.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml  # type: ignore[import-untyped]  # stub-less: only used to parse a fixture file

from infra.object_store import OBJECT_STORE_VARS

# backend/tests/unit/<this file> -> backend/tests/unit -> backend/tests
# -> backend -> repo root, where render.yaml actually lives.
_RENDER_YAML = Path(__file__).resolve().parents[3] / "render.yaml"


def _services() -> dict[str, dict[str, Any]]:
    manifest = yaml.safe_load(_RENDER_YAML.read_text())
    return {service["type"]: service for service in manifest["services"]}


def _declared_env_var_keys(service: dict[str, Any]) -> set[str]:
    return {entry["key"] for entry in service.get("envVars", [])}


@pytest.fixture(scope="module")
def services() -> dict[str, dict[str, Any]]:
    return _services()


class TestRenderYamlDeclaresCurrentObjectStoreVars:
    def test_web_service_declares_every_current_object_store_var(
        self, services: dict[str, dict[str, Any]]
    ) -> None:
        declared = _declared_env_var_keys(services["web"])

        missing = set(OBJECT_STORE_VARS) - declared
        assert not missing, (
            f"render.yaml's web service is missing {sorted(missing)}; "
            f"infra/object_store.py reads {OBJECT_STORE_VARS}"
        )

    def test_cron_service_declares_every_current_object_store_var(
        self, services: dict[str, dict[str, Any]]
    ) -> None:
        declared = _declared_env_var_keys(services["cron"])

        missing = set(OBJECT_STORE_VARS) - declared
        assert not missing, (
            f"render.yaml's cron service is missing {sorted(missing)}; "
            f"infra/object_store.py reads {OBJECT_STORE_VARS}"
        )

    def test_no_service_still_declares_the_old_r2_prefixed_names(
        self, services: dict[str, dict[str, Any]]
    ) -> None:
        for service_type, service in services.items():
            leftover = {key for key in _declared_env_var_keys(service) if key.startswith("R2_")}
            assert not leftover, f"render.yaml's {service_type} service still has {leftover}"
