"""T-1015-7: failing test stubs for the documentation cutover.

Validates that README.md, docs/tools.md, docs/design/, and
docs/reference/ describe the shipped surface after T-1015-4/T-1015-6 land
-- no reference to a deleted file, tool, route, endpoint, or env var, and
every command/URL named is actually runnable.

Each stub currently fails with ``pytest.fail("not implemented")``; the
real assertions land when T-1015-7 is implemented.
"""

from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]


class TestDocsCutoverHappyPath:
    """spec.md "Documentation cutover / Happy path" scenario."""

    def test_readme_names_only_paths_routes_and_commands_that_exist(self) -> None:
        pytest.fail(
            "not implemented: T-1015-7 AC1 -- every path/route/endpoint/command README.md "
            "names is verified to exist post-cutover"
        )

    def test_tools_md_lists_no_retired_tool_and_has_no_stale_code_layout_section(self) -> None:
        pytest.fail(
            "not implemented: T-1015-7 AC2 -- none of the 11 legacy tool names appear in "
            "docs/tools.md, and its 'Code layout' section names only surviving files"
        )

    def test_readme_health_check_command_targets_health_not_spike_ping(self) -> None:
        pytest.fail(
            "not implemented: T-1015-7 -- README's documented health-check command hits "
            "/health, not /api/spike/ping"
        )


class TestSupersededSpec:
    """spec.md "Documentation cutover / Superseded spec" scenario."""

    def test_pattern_research_workbench_spec_marked_superseded_or_removed(self) -> None:
        pytest.fail(
            "not implemented: T-1015-7 AC3 -- docs/design/pattern-research-workbench/spec.md "
            "is either marked superseded or removed and de-indexed"
        )

    def test_design_index_has_no_dangling_entries(self) -> None:
        pytest.fail(
            "not implemented: T-1015-7 AC3 -- every entry in docs/design/README.md resolves "
            "to an existing file"
        )


class TestRecordedDrop:
    """spec.md "Documentation cutover / Recorded drop" scenario."""

    def test_every_accepted_drop_is_documented_outside_the_plan_folder(self) -> None:
        pytest.fail(
            "not implemented: T-1015-7 AC5 -- the 6 accepted-drop capabilities from "
            "capability-parity-matrix.md are documented in docs/tools.md or the design index, "
            "not only under docs/plan/EPIC-1015/"
        )


class TestNoDanglingReferences:
    """T-1015-7 AC6."""

    def test_no_doc_references_a_deleted_file_tool_route_endpoint_or_env_var(self) -> None:
        pytest.fail(
            "not implemented: T-1015-7 AC6 -- grep README.md, docs/tools.md, docs/design/, "
            "docs/reference/ for the 11 legacy tool names and any retired file path"
        )
