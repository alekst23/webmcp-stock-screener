"""T-1015-2: failing test stubs for the capability-parity check deliverable.

Validates the structure of
``docs/plan/EPIC-1015/capability-parity-matrix.md`` against T-1015-2's
acceptance criteria and the "Capability-parity check" behavioral scenarios
in ``docs/design/legacy-surface-cutover/spec.md``. Documentation artifact,
not application code -- these stubs parse the committed matrix rather than
import any contract, since this ticket introduces none.
"""

from __future__ import annotations

from pathlib import Path

import pytest

MATRIX_PATH = (
    Path(__file__).resolve().parents[2]
    / "docs"
    / "plan"
    / "EPIC-1015"
    / "capability-parity-matrix.md"
)


class TestExactMatch:
    def test_backend_address_resolution_recorded_as_exact_match(self) -> None:
        pytest.fail(
            "not implemented: T-1015-2 -- apiConfig.ts's resolveApiBaseUrl is recorded as an "
            "exact, shared-code match, cleared for deletion of nothing (it's kept)"
        )


class TestPartialMatch:
    def test_temporal_setup_matching_recorded_as_partial_with_reduction_stated(self) -> None:
        pytest.fail(
            "not implemented: T-1015-2 -- multi-step temporal sequencing is recorded as a "
            "partial match, with the inter-step-window reduction explicitly stated, not just "
            "flagged unreachable"
        )

    def test_every_partial_match_appears_in_the_signoff_section(self) -> None:
        pytest.fail(
            "not implemented: T-1015-2 AC5 -- every row marked partial also appears in the "
            "'Drops and partial matches -- for user sign-off' section"
        )


class TestDeliberateDrop:
    def test_instance_splitting_recorded_as_drop_not_deleted_silently(self) -> None:
        pytest.fail(
            "not implemented: T-1015-2 -- splitInstances has no new-surface equivalent and is "
            "recorded as a drop with a stated reason, surfaced for sign-off"
        )

    def test_every_drop_appears_in_the_signoff_section(self) -> None:
        pytest.fail(
            "not implemented: T-1015-2 AC5 -- every row marked drop also appears in the "
            "sign-off section, readable without reading the whole matrix"
        )


class TestDocOnlyToolCountsAsDrop:
    def test_unwired_but_merged_tool_group_counts_as_a_drop(self) -> None:
        pytest.fail(
            "not implemented: T-1015-2 AC3 -- a tool group gated behind a false "
            "*_TOOLS_ENABLED flag with no external caller is recorded as a drop "
            "('reachability gap'), not a match, even though the code exists and is merged"
        )


class TestNoGoVerdict:
    def test_verdict_states_what_must_change_to_reach_go(self) -> None:
        pytest.fail(
            "not implemented: T-1015-2 AC6 -- the matrix's Go/No-Go section states concretely "
            "what must change (flag flips, sign-offs, the get_canvas_state fix) for a no-go "
            "to become a go"
        )

    def test_no_legacy_file_deleted_or_modified_by_this_ticket(self) -> None:
        pytest.fail(
            "not implemented: T-1015-2 AC7 -- diff this ticket's commits against the legacy "
            "file set from T-1015-1's inventory and assert no overlap"
        )
