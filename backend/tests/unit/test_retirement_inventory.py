"""T-1015-1: failing test stubs for the retirement inventory deliverable.

The deliverable is a markdown artifact
(``docs/plan/EPIC-1015/retirement-inventory.md``), not application code —
these stubs validate its *structure* against T-1015-1's acceptance
criteria and the "Retirement inventory" behavioral scenarios in
``docs/design/legacy-surface-cutover/spec.md``, by parsing the committed
document. Each stub currently fails with ``pytest.fail("not implemented")``
per the test-design-phase convention; the parsing/assertion logic lands
when T-1015-1 is implemented for real (it already has a deliverable
committed — this stub suite is what should have gated it, and should gate
any future edit to the inventory).
"""

from __future__ import annotations

from pathlib import Path

import pytest

INVENTORY_PATH = (
    Path(__file__).resolve().parents[2] / "docs" / "plan" / "EPIC-1015" / "retirement-inventory.md"
)


class TestRetirementInventoryHappyPath:
    """spec.md "Retirement inventory / Happy path" scenario."""

    def test_every_named_path_appears_exactly_once(self) -> None:
        pytest.fail("not implemented: T-1015-1 -- parse inventory rows, assert no duplicate paths")

    def test_every_entry_has_retire_keep_or_absorb_classification(self) -> None:
        pytest.fail(
            "not implemented: T-1015-1 -- every row's classification is one of "
            "retire/keep/absorb"
        )

    def test_every_entry_has_a_one_line_reason(self) -> None:
        pytest.fail("not implemented: T-1015-1 -- every row has a non-empty reason column")

    def test_every_named_path_exists_on_the_epic_branch(self) -> None:
        pytest.fail(
            "not implemented: T-1015-1 AC6 -- every path cited in the inventory resolves to a "
            "real file relative to the repo root"
        )


class TestTransportInsideLegacyDirectory:
    """spec.md "Infrastructure inside a legacy directory" scenario."""

    def test_webmcp_bridge_classified_keep_with_transport_reason(self) -> None:
        pytest.fail(
            "not implemented: T-1015-1 AC2/AC5 -- src/lib/webmcp/bridge.ts is 'keep' and its "
            "reason names it as transport, not product, distinguishing it from directory-only "
            "classification"
        )

    def test_no_entry_is_classified_by_directory_alone(self) -> None:
        pytest.fail(
            "not implemented: T-1015-1 AC5 -- apiConfig.ts (in workspace/, but 'keep') is the "
            "concrete regression case for this rule"
        )


class TestAbsorbWithNoDestination:
    """spec.md "Absorb with no destination" scenario."""

    def test_absorb_entries_name_a_destination_or_are_downgraded_to_retire(self) -> None:
        pytest.fail(
            "not implemented: T-1015-1 AC4 -- every 'absorb' row either names a destination "
            "(or an explicit contingency) or the row is classified 'retire', never a bare "
            "'absorb' with nothing named"
        )

    def test_visualization_ts_is_retire_not_absorb(self) -> None:
        pytest.fail(
            "not implemented: T-1015-1 AC4 -- visualization.ts's chart math was independently "
            "reimplemented in chartScales.ts, so it must be recorded as retire, not absorb"
        )


class TestDeliberatelyUntouched:
    """T-1015-1 AC7."""

    def test_build_and_deploy_config_called_out_as_untouched(self) -> None:
        pytest.fail(
            "not implemented: T-1015-1 AC7 -- render.yaml, wrangler.jsonc, package.json etc. "
            "appear in a 'deliberately untouched' section rather than being omitted entirely"
        )
