"""T-1015-8: failing test stubs for live-deployment cutover verification.

Unlike most functional tests in this suite, several of these assertions
can only be satisfied by a human executing the runbook against the real
Render backend and Cloudflare Workers frontend (see T-1015-8's Solution
Approach) -- no local run substitutes for the live one. They are still
written as failing stubs, per the test-design-phase convention, rather
than skip-marked: each becomes a real assertion recording the runbook's
outcome (e.g. asserting a recorded HTTP status/timestamp/URL from the
executed runbook), not a live network call made by the test suite itself.

Each stub currently fails with ``pytest.fail("not implemented")``.
"""

from __future__ import annotations

import pytest


class TestDeploymentVerificationHappyPath:
    """spec.md "Deployment verification / Happy path" scenario."""

    def test_full_ci_gate_passes_on_the_epic_branch(self) -> None:
        pytest.fail(
            "not implemented: T-1015-8 AC1 -- formatting, linting, typecheck, frontend tests, "
            "backend tests, and a production build all pass on the epic branch, no skips"
        )

    def test_deployed_backend_health_check_responds_successfully(self) -> None:
        pytest.fail(
            "not implemented: T-1015-8 AC3 -- GET https://<deployed-backend>/health returns 200, "
            "evidence recorded in docs/reference/deployment.md"
        )

    def test_deployed_frontend_loads_with_no_console_errors(self) -> None:
        pytest.fail(
            "not implemented: T-1015-8 AC4 -- deployed frontend renders the new surface with an "
            "empty browser console error list"
        )

    def test_representative_new_surface_flow_succeeds_end_to_end(self) -> None:
        pytest.fail(
            "not implemented: T-1015-8 AC5 -- a flow from capability-parity-matrix.md's "
            "confirmed-live rows completes against the deployed backend from a real browser"
        )


class TestCors:
    """spec.md "Deployment verification / CORS" scenario."""

    def test_deployed_frontend_origin_call_succeeds_against_deployed_backend(self) -> None:
        pytest.fail(
            "not implemented: T-1015-8 AC5 -- a real browser request from the deployed "
            "frontend's own origin to the deployed backend succeeds, confirming CORS_ALLOWED_"
            "ORIGINS admits it"
        )


class TestAgentReachability:
    """spec.md "Deployment verification / Agent reachability" scenario."""

    def test_webmcp_bridge_connects_on_the_deployed_app(self) -> None:
        pytest.fail(
            "not implemented: T-1015-8 AC6 -- a WebMCP-capable browser on the deployed app "
            "connects, the header reports connected, and registered tool names are the new "
            "surface's"
        )


class TestLegacyReachability:
    """spec.md "Deployment verification / Legacy reachability" scenario."""

    def test_no_legacy_route_or_endpoint_is_reachable(self) -> None:
        pytest.fail(
            "not implemented: T-1015-8 AC7 -- probing /, /dev, /spike, /api/spike/ping, and "
            "/api/research/* on the live deployment returns 404/not-found for every one"
        )


class TestRollback:
    """spec.md "Deployment verification / Rollback" scenario."""

    def test_rollback_path_is_stated_in_the_ticket_record(self) -> None:
        pytest.fail(
            "not implemented: T-1015-8 AC9 -- the ticket record names exactly what to revert "
            "and what to re-deploy on both platforms if the cutover must be undone"
        )
