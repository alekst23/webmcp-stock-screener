"""T-1015-2: real assertions for the capability-parity check deliverable.

Validates the structure of
``docs/plan/EPIC-1015/capability-parity-matrix.md`` against T-1015-2's
acceptance criteria and the "Capability-parity check" behavioral scenarios
in ``docs/design/legacy-surface-cutover/spec.md``. Documentation artifact,
not application code -- these tests parse the committed matrix rather than
import any contract, since T-1015-2 introduces none. Written by T-1015-7 as
part of the "backend test stubs" cleanup scope.

**On the NO-GO verdict** (design judgment call the ticket asked this file
to make explicitly, rather than silently picking one): the matrix's
Go/No-Go section is left completely unmodified by T-1015-7 -- rewriting
another ticket's already-committed deliverable is out of this ticket's
scope, and the audit findings underneath the verdict (the two structural
capability losses, the unwired tool groups, the ``get_canvas_state`` bug)
did not change; only the *epic's response* to them did, via the user's
2026-09-03 decision recorded in ``docs/plan/EPIC-1015/_epic.md``'s
"Superseded note" and ``docs/plan/project.md``'s Decisions Log -- not
inside the matrix document itself. So ``TestNoGoVerdict`` keeps testing
the matrix's own literal, still-true content (it does say NO-GO, and it
does state what would change that), and gains one additional test that
checks the supersession is recorded where it actually lives (``_epic.md``)
rather than fabricating a "this matrix is superseded" sentence inside the
matrix that was never written there.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
MATRIX_PATH = REPO_ROOT / "docs" / "plan" / "EPIC-1015" / "capability-parity-matrix.md"
EPIC_DOC_PATH = REPO_ROOT / "docs" / "plan" / "EPIC-1015" / "_epic.md"

_SEPARATOR_CELL = re.compile(r":?-{2,}:?")
# Splits a markdown table row on "|", but not on a backslash-escaped "\|"
# (one row in the matrix has a literal `'crossed_above'\|'crossed_below'`
# inside a cell) -- a naive str.split("|") would wrongly treat that escaped
# pipe as a cell boundary.
_UNESCAPED_PIPE = re.compile(r"(?<!\\)\|")

# Generic English words that would make the sign-off cross-reference check
# (see `_capability_keywords`) match almost anything if left in.
_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "not",
    "human",
    "side",
    "new",
    "tool",
    "tools",
}


@dataclass(frozen=True)
class MatrixRow:
    capability: str
    legacy_tools: str
    new_surface_equivalent: str
    verdict: str

    @property
    def full_text(self) -> str:
        return " ".join([self.legacy_tools, self.new_surface_equivalent, self.verdict])


def _parse_parity_matrix(text: str) -> list[MatrixRow]:
    """Parses the "## Parity matrix" section's own table -- deliberately
    scoped to that one section so the "Drops and partial matches" section's
    own numbered lists (not a table) can't be mis-parsed as matrix rows."""
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("## Parity matrix"))
    rows: list[MatrixRow] = []
    for line in lines[start + 1 :]:
        if line.startswith("## "):
            break
        stripped = line.strip()
        if not stripped.startswith("|") or not stripped.endswith("|"):
            continue
        inner = stripped[1:-1]
        cells = [c.strip().replace("\\|", "|") for c in _UNESCAPED_PIPE.split(inner)]
        if all(_SEPARATOR_CELL.fullmatch(c) for c in cells):
            continue
        if cells[0] == "Capability":
            continue
        if len(cells) < 4:
            continue
        rows.append(MatrixRow(*cells[:4]))
    return rows


def _signoff_section(text: str) -> str:
    start = text.index("## Drops and partial matches")
    end = text.index("## Go/No-Go Verdict")
    return text[start:end]


def _capability_keywords(capability: str) -> list[str]:
    """Meaningful words from a capability name, for a loose (but real)
    cross-reference check against the sign-off section's own, differently
    phrased, item descriptions -- e.g. "Instance splitting" vs. the
    sign-off section's "Instance splitting into labeled, independently-
    usable child sets". Exact-string matching would be too brittle across
    that rephrasing; matching on every generic English word would be too
    loose to mean anything. This lands in between."""
    cleaned = re.sub(r"[`*()/]", " ", capability.lower())
    words = re.findall(r"[a-z][a-z-]{3,}", cleaned)
    return [w for w in words if w not in _STOPWORDS]


@pytest.fixture(scope="module")
def matrix_text() -> str:
    return MATRIX_PATH.read_text()


@pytest.fixture(scope="module")
def matrix_rows(matrix_text: str) -> list[MatrixRow]:
    return _parse_parity_matrix(matrix_text)


def _row_for(rows: list[MatrixRow], capability: str) -> MatrixRow:
    matches = [r for r in rows if r.capability.strip().lower() == capability.lower()]
    assert matches, f"expected a parity-matrix row for capability {capability!r}"
    return matches[0]


class TestExactMatch:
    def test_backend_address_resolution_recorded_as_exact_match(
        self, matrix_rows: list[MatrixRow]
    ) -> None:
        row = _row_for(matrix_rows, "Backend address resolution")
        verdict = row.verdict.lower()
        assert "match" in verdict and "exact" in verdict, (
            f"expected an exact-match verdict for backend address resolution, got "
            f"{row.verdict!r}"
        )
        # "cleared for deletion of nothing (it's kept)": the new-surface column
        # should name the same shared function, not a distinct replacement.
        assert "resolveApiBaseUrl" in row.new_surface_equivalent, (
            f"expected the new-surface column to name the shared resolveApiBaseUrl, "
            f"got {row.new_surface_equivalent!r}"
        )


class TestPartialMatch:
    def test_temporal_setup_matching_recorded_as_partial_with_reduction_stated(
        self, matrix_rows: list[MatrixRow]
    ) -> None:
        row = _row_for(matrix_rows, "Temporal setup definition")
        assert row.verdict.lower().startswith("**partial") or row.verdict.lower().startswith(
            "partial"
        ), f"expected a partial verdict, got {row.verdict!r}"
        assert "reduction" in row.verdict.lower(), (
            f"expected the inter-step-window reduction to be explicitly stated, not just "
            f"flagged unreachable, got {row.verdict!r}"
        )

    def test_every_partial_match_appears_in_the_signoff_section(
        self, matrix_text: str, matrix_rows: list[MatrixRow]
    ) -> None:
        signoff = _signoff_section(matrix_text).lower()
        partial_rows = [r for r in matrix_rows if "partial" in r.verdict.lower()]
        assert partial_rows, "expected at least one partial-match row to check"
        missing = [
            row
            for row in partial_rows
            if not any(kw in signoff for kw in _capability_keywords(row.capability))
        ]
        assert not missing, (
            f"expected every partial-match row to be cross-referenced (by at least one "
            f"shared keyword) in the 'Drops and partial matches' sign-off section, missing: "
            f"{[r.capability for r in missing]}"
        )


class TestDeliberateDrop:
    def test_instance_splitting_recorded_as_drop_not_deleted_silently(
        self, matrix_rows: list[MatrixRow]
    ) -> None:
        row = _row_for(matrix_rows, "Instance splitting")
        assert "drop" in row.verdict.lower(), f"expected a drop verdict, got {row.verdict!r}"
        assert row.new_surface_equivalent.strip().lower() in (
            "none found",
            "none",
        ), f"expected no new-surface equivalent recorded, got {row.new_surface_equivalent!r}"
        assert len(row.verdict) > len(
            "**Drop.**"
        ), f"expected a stated reason beyond the bare verdict word, got {row.verdict!r}"

    def test_every_drop_appears_in_the_signoff_section(
        self, matrix_text: str, matrix_rows: list[MatrixRow]
    ) -> None:
        signoff = _signoff_section(matrix_text).lower()
        drop_rows = [r for r in matrix_rows if "drop" in r.verdict.lower()]
        assert drop_rows, "expected at least one drop row to check"
        missing = [
            row
            for row in drop_rows
            if not any(kw in signoff for kw in _capability_keywords(row.capability))
        ]
        assert not missing, (
            f"expected every drop row to be readable, by name, from the sign-off section "
            f"without reading the whole matrix; missing: {[r.capability for r in missing]}"
        )


class TestDocOnlyToolCountsAsDrop:
    def test_unwired_but_merged_tool_group_counts_as_a_drop(
        self, matrix_rows: list[MatrixRow]
    ) -> None:
        flag_gated = [row for row in matrix_rows if "_ENABLED = false" in row.full_text]
        assert flag_gated, (
            "expected at least one row whose new-surface equivalent names a "
            "false *_TOOLS_ENABLED flag"
        )
        for row in flag_gated:
            verdict = row.verdict.lower()
            assert "match" not in verdict.split(",")[0].split(".")[0] or "partial" in verdict, (
                f"expected a flag-gated, unreachable tool group to be recorded as a drop or "
                f"partial match, not a clean match, got {row.capability!r}: {row.verdict!r}"
            )
            assert "unreachable" in verdict, (
                f"expected the verdict to say the code is unreachable despite existing, got "
                f"{row.capability!r}: {row.verdict!r}"
            )


class TestNoGoVerdict:
    def test_verdict_states_what_must_change_to_reach_go(self, matrix_text: str) -> None:
        assert "## Go/No-Go Verdict" in matrix_text
        assert "**NO-GO.**" in matrix_text
        change_heading = "What would change a no-go to a go"
        assert (
            change_heading in matrix_text
        ), f"expected a {change_heading!r} section stating concretely what must change"
        change_section = matrix_text.split(change_heading, 1)[1]
        change_section = change_section.split("\n## ", 1)[0]
        for expected in ("_ENABLED", "sign-off", "get_canvas_state"):
            assert expected in change_section, (
                f"expected the 'what would change a no-go to a go' section to mention "
                f"{expected!r} (flag flips / sign-offs / the get_canvas_state fix)"
            )

    def test_no_legacy_file_deleted_or_modified_by_this_ticket(self) -> None:
        commits = (
            subprocess.run(
                ["git", "log", "--format=%H", "--", str(MATRIX_PATH.relative_to(REPO_ROOT))],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=True,
            )
            .stdout.strip()
            .splitlines()
        )
        assert commits, "expected at least one commit touching capability-parity-matrix.md"
        offenders: list[tuple[str, str]] = []
        for commit in commits:
            changed = (
                subprocess.run(
                    ["git", "show", "--name-only", "--format=", commit],
                    cwd=REPO_ROOT,
                    capture_output=True,
                    text=True,
                    check=True,
                )
                .stdout.strip()
                .splitlines()
            )
            for path in changed:
                if path and not path.startswith("docs/plan/"):
                    offenders.append((commit, path))
        assert not offenders, (
            f"expected every commit that touched capability-parity-matrix.md to change only "
            f"docs/plan/ files (an audit deliverable, not a deletion), found changes outside "
            f"docs/plan/: {offenders}"
        )

    def test_supersession_is_recorded_in_the_epic_doc(self) -> None:
        # The matrix document itself is left as the frozen T-1015-2 audit
        # deliverable (see this module's docstring) -- the decision that
        # superseded its NO-GO verdict is recorded in the epic doc instead,
        # which is where a reader following the epic's own ticket table
        # would land.
        epic_text = EPIC_DOC_PATH.read_text()
        assert (
            "Superseded note" in epic_text
        ), "expected _epic.md to record the note superseding T-1015-2's NO-GO verdict"
        assert "NO-GO" in epic_text, "expected _epic.md to name the superseded verdict"
