"""T-1015-1: real assertions for the retirement inventory deliverable.

The deliverable is a markdown artifact
(``docs/plan/EPIC-1015/retirement-inventory.md``), not application code —
these tests validate its *structure* against T-1015-1's acceptance criteria
and the "Retirement inventory" behavioral scenarios in
``docs/design/legacy-surface-cutover/spec.md``, by parsing the committed
document. Written by T-1015-7 as part of the "backend test stubs" cleanup
scope, once the doc's real, already-committed content could be checked
against real assertions instead of throw-stubs.

Parsing approach: the inventory is a sequence of markdown tables, each with
a "Path | Classification | Reason" header, grouped under numbered "## N."
section headings. A data row's Path cell holds one or more backtick-quoted
path tokens; some are full paths (``src/lib/webmcp/bridge.ts``), some are
bare filenames relying on directory context -- either the most recent
full path earlier in the *same* cell (e.g. "``register.ts``, ``register.
test.ts``") or, when a whole row has no full path at all (section 4's
workspace rows), a directory hint embedded in that section's own heading
(e.g. "## 4. Legacy workspace model (`src/lib/workspace/`)"). Tokens that
are not paths at all -- function/class names like `` `ok()` `` or
`` `buildTools` ``, or glob/brace patterns like `` `src/lib/theme/**` ``
or `` `backend/api/routes/{similarity,backtest,health}.py` `` -- are
excluded by a path-likeness filter rather than mis-resolved.

Existence (AC6) is checked against the commit the inventory itself names
as its verification point (`c3ed17c`, in its own "Summary" section) rather
than the current working tree: this audit ran *before* any deletion, and
several "retire"-classified files have since actually been deleted by
T-1015-4/5/6 -- checking today's working tree would make AC6 fail for
every entry the inventory did its job on.
"""

from __future__ import annotations

import re
import subprocess
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
INVENTORY_PATH = REPO_ROOT / "docs" / "plan" / "EPIC-1015" / "retirement-inventory.md"

# The branch point the inventory's own "Summary" section names as having
# verified every path against: "forked from main @ c3ed17c". Existence is
# checked there, not against the current tree -- see module docstring.
VERIFIED_AT_COMMIT = "c3ed17c"

_SEPARATOR_CELL = re.compile(r":?-{2,}:?")
_SECTION_HEADING_WITH_DIR_HINT = re.compile(r"^##\s+\d+\.\s+.*`([\w./-]+/)`")
_BACKTICK_TOKEN = re.compile(r"`([^`]+)`")
_FORBIDDEN_TOKEN_CHARS = set("{}*()")


@dataclass(frozen=True)
class InventoryRow:
    path_cell: str
    classification: str
    reason: str
    section: str


@dataclass(frozen=True)
class ResolvedPath:
    token: str
    resolved: str
    row: InventoryRow


def _looks_like_path(token: str) -> bool:
    """A backtick span counts as a path candidate if it has no glob/brace/
    call-syntax characters and contains either a path separator or a file
    extension. Filters out incidental backticked identifiers in the Path
    column, e.g. `` `ok()` ``, `` `buildTools` ``, `` `src/lib/theme/**` ``.
    """
    if any(c in _FORBIDDEN_TOKEN_CHARS for c in token):
        return False
    return "/" in token or "." in token


def _parse_rows(text: str) -> list[InventoryRow]:
    """Parse every "Path | Classification | Reason" data row in the
    document, skipping headers, separators, and non-inventory tables (e.g.
    the trailing Summary table, whose first column is a classification
    name, not a path -- it never contains a backtick span)."""
    rows: list[InventoryRow] = []
    section = "(preamble)"
    for line in text.splitlines():
        if line.startswith("## "):
            section = line.removeprefix("## ").strip()
            continue
        stripped = line.strip()
        if not stripped.startswith("|") or not stripped.endswith("|"):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if all(_SEPARATOR_CELL.fullmatch(c) for c in cells):
            continue
        if cells[0] == "Path":
            continue
        if "`" not in cells[0]:
            continue
        rows.append(
            InventoryRow(
                path_cell=cells[0],
                classification=cells[1] if len(cells) > 1 else "",
                reason=cells[2] if len(cells) > 2 else "",
                section=section,
            )
        )
    return rows


def _section_dir_hints(text: str) -> dict[str, str]:
    """Maps each section heading's own text to a directory hint, when the
    heading itself embeds one (e.g. section 4's own title names
    `src/lib/workspace/`). Used only as a fallback for rows with no full
    path anywhere in their own cell."""
    hints: dict[str, str] = {}
    for line in text.splitlines():
        if not line.startswith("## "):
            continue
        match = _SECTION_HEADING_WITH_DIR_HINT.search(line)
        if match:
            hints[line.removeprefix("## ").strip()] = match.group(1)
    return hints


def _resolve_tokens(rows: list[InventoryRow], dir_hints: dict[str, str]) -> list[ResolvedPath]:
    resolved: list[ResolvedPath] = []
    for row in rows:
        last_dir: str | None = None
        for token in _BACKTICK_TOKEN.findall(row.path_cell):
            if not _looks_like_path(token):
                continue
            if "/" in token:
                path = token
                last_dir = token.rsplit("/", 1)[0] + "/"
            else:
                base = last_dir or dir_hints.get(row.section)
                if base is None:
                    # No full path in this cell and no section hint -- a
                    # row shaped this way would be a real gap in the
                    # parser's assumptions, not a silently-skipped token.
                    raise AssertionError(
                        f"could not resolve directory for bare token {token!r} "
                        f"in section {row.section!r}: {row.path_cell!r}"
                    )
                path = base + token
            resolved.append(ResolvedPath(token=token, resolved=path, row=row))
    return resolved


def _git_object_exists(commit: str, path: str) -> bool:
    result = subprocess.run(
        ["git", "cat-file", "-e", f"{commit}:{path.rstrip('/')}"],
        cwd=REPO_ROOT,
        capture_output=True,
    )
    return result.returncode == 0


@pytest.fixture(scope="module")
def inventory_text() -> str:
    return INVENTORY_PATH.read_text()


@pytest.fixture(scope="module")
def inventory_rows(inventory_text: str) -> list[InventoryRow]:
    return _parse_rows(inventory_text)


@pytest.fixture(scope="module")
def resolved_paths(inventory_text: str, inventory_rows: list[InventoryRow]) -> list[ResolvedPath]:
    return _resolve_tokens(inventory_rows, _section_dir_hints(inventory_text))


class TestRetirementInventoryHappyPath:
    """spec.md "Retirement inventory / Happy path" scenario."""

    def test_every_named_path_appears_exactly_once(
        self, inventory_rows: list[InventoryRow]
    ) -> None:
        counts = Counter(row.path_cell for row in inventory_rows)
        duplicates = {cell: n for cell, n in counts.items() if n > 1}
        assert not duplicates, (
            f"expected every inventory entry (Path-column cell) to appear exactly once, "
            f"found duplicates: {duplicates}"
        )

    def test_every_entry_has_retire_keep_or_absorb_classification(
        self, inventory_rows: list[InventoryRow]
    ) -> None:
        classification_re = re.compile(r"\b(retire|keep|absorb)\b", re.IGNORECASE)
        bad = [row for row in inventory_rows if not classification_re.search(row.classification)]
        assert not bad, (
            f"expected every row's classification to be one of retire/keep/absorb, "
            f"found rows without any: {[(r.path_cell, r.classification) for r in bad]}"
        )

    def test_every_entry_has_a_one_line_reason(self, inventory_rows: list[InventoryRow]) -> None:
        bad = [row for row in inventory_rows if not row.reason.strip()]
        assert not bad, (
            f"expected every row to have a non-empty reason column, "
            f"found rows without one: {[r.path_cell for r in bad]}"
        )

    def test_every_named_path_exists_on_the_epic_branch(
        self, resolved_paths: list[ResolvedPath]
    ) -> None:
        assert resolved_paths, "expected the parser to resolve at least one path token"
        missing = [
            rp for rp in resolved_paths if not _git_object_exists(VERIFIED_AT_COMMIT, rp.resolved)
        ]
        assert not missing, (
            f"expected every path cited in the inventory to resolve to a real file/directory "
            f"at commit {VERIFIED_AT_COMMIT} (the branch point the inventory's own Summary "
            f"section names as its verification point), found paths that do not: "
            f"{[(rp.token, rp.resolved) for rp in missing]}"
        )


class TestTransportInsideLegacyDirectory:
    """spec.md "Infrastructure inside a legacy directory" scenario."""

    def test_webmcp_bridge_classified_keep_with_transport_reason(
        self, inventory_rows: list[InventoryRow]
    ) -> None:
        matches = [row for row in inventory_rows if "src/lib/webmcp/bridge.ts" in row.path_cell]
        assert matches, "expected an inventory row naming src/lib/webmcp/bridge.ts"
        row = matches[0]
        assert (
            "keep" in row.classification.lower()
        ), f"expected bridge.ts classified keep, got {row.classification!r}"
        # The "named as transport, not product" distinction is carried by
        # this row's own section heading ("1. WebMCP transport — verified
        # keep") as much as by its reason text -- either place naming it
        # satisfies AC2/AC5's "reason names it as transport" requirement.
        assert "transport" in row.reason.lower() or "transport" in row.section.lower(), (
            f"expected bridge.ts's reason or section to name it as transport (distinguishing "
            f"it from product-surface classification), got reason={row.reason!r} "
            f"section={row.section!r}"
        )

    def test_no_entry_is_classified_by_directory_alone(
        self, inventory_rows: list[InventoryRow]
    ) -> None:
        # apiConfig.ts sits in workspace/ (a legacy product directory) but is
        # kept -- the concrete regression case for "classified by directory
        # alone" (a directory-based classifier would call it retire).
        matches = [row for row in inventory_rows if "apiConfig.ts" in row.path_cell]
        assert matches, "expected an inventory row naming apiConfig.ts"
        row = matches[0]
        assert "keep" in row.classification.lower(), (
            f"expected apiConfig.ts classified keep despite living in a legacy directory, "
            f"got {row.classification!r} -- classifying it 'retire' would mean the inventory "
            f"classified by directory alone, which AC5 forbids"
        )


class TestAbsorbWithNoDestination:
    """spec.md "Absorb with no destination" scenario."""

    def test_absorb_entries_name_a_destination_or_are_downgraded_to_retire(
        self, inventory_rows: list[InventoryRow]
    ) -> None:
        absorb_rows = [row for row in inventory_rows if "absorb" in row.classification.lower()]
        assert absorb_rows, "expected at least one 'absorb' row to check"
        bad = [
            row
            for row in absorb_rows
            if "contingent" not in row.classification.lower()
            and "contingent" not in row.reason.lower()
            and "destination" not in row.reason.lower()
        ]
        assert not bad, (
            f"expected every 'absorb' row to name a destination or an explicit contingency "
            f"(never a bare 'absorb' with nothing named), found rows without either: "
            f"{[(r.path_cell, r.classification, r.reason) for r in bad]}"
        )

    def test_visualization_ts_is_retire_not_absorb(
        self, inventory_rows: list[InventoryRow]
    ) -> None:
        matches = [
            row
            for row in inventory_rows
            if "visualization.ts" in row.path_cell and "visualization.test.ts" in row.path_cell
        ]
        assert matches, "expected an inventory row naming visualization.ts"
        row = matches[0]
        assert "retire" in row.classification.lower(), (
            f"expected visualization.ts classified retire (chartScales.ts independently "
            f"reimplemented its technique, so there is no real destination to absorb into), "
            f"got {row.classification!r}"
        )
        # The doc phrases this as "retire, not absorb" -- a bare substring
        # check for "absorb" would misfire on that phrasing, so check for
        # an actual "absorb" classification (not preceded by a negation)
        # rather than mere presence of the word.
        assert "not absorb" in row.classification.lower(), (
            f'expected the classification to explicitly rule out absorb ("retire, not '
            f'absorb"), got {row.classification!r}'
        )
        assert "chartscales" in row.reason.lower(), (
            f"expected the reason to name chartScales.ts as the independent reimplementation "
            f"that makes this retire-not-absorb, got {row.reason!r}"
        )


class TestDeliberatelyUntouched:
    """T-1015-1 AC7."""

    def test_build_and_deploy_config_called_out_as_untouched(self, inventory_text: str) -> None:
        assert "Deliberately untouched" in inventory_text, (
            "expected a 'Deliberately untouched' section (AC7) rather than build/deploy "
            "config being silently omitted from the inventory"
        )
        section = inventory_text.split("Deliberately untouched", 1)[1]
        # Bound the section to its own contents, not the rest of the doc.
        section = section.split("\n## ", 1)[0]
        for named in ("render.yaml", "wrangler.jsonc", "package.json"):
            assert (
                named in section
            ), f"expected {named!r} to be named in the 'Deliberately untouched' section"
