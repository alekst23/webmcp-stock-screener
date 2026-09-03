"""T-1015-7: real assertions for the documentation cutover.

Validates that README.md, docs/tools.md, docs/design/, and
docs/reference/ describe the shipped surface after T-1015-4/T-1015-6
landed -- no reference to a deleted file, tool, route, endpoint, or env
var, and every command/URL named is actually runnable. Written as part of
this same ticket, once the real doc content existed to check real
assertions against instead of throw-stubs.

Scope note (AC6's grep pass): the "no doc references a deleted file, tool,
route, endpoint, or env var" check below is scoped to the files this
ticket actually owns -- README.md, docs/tools.md, docs/design/README.md,
and the four docs/reference/*.md files named in the ticket's Design
References -- not the whole docs/design/ tree. Sibling epics' own spec
files use plain English words like "measure" (as in "measured contrast
floor") that collide with legacy tool names; scoping to this ticket's own
files avoids testing prose this ticket didn't write and has no mandate to
police. Within scope, a reference is allowed once its containing markdown
section (the nearest heading through the next heading) also carries a
retirement-signal word (retired/deleted/superseded/dropped/legacy/
historical), which is how every intentional mention in these docs was
actually written -- a bare, unsignalled mention would mean the doc
presents something deleted as still current, which is exactly what AC6
forbids. The four superseded spec/technical docs
(pattern-research-workbench, workspace-snapshots) are checked only for
having the superseded banner at the top of the file -- their bodies are
kept as an unmodified historical record below that banner (this ticket's
Technical Considerations: amend over delete), so they are not grepped
paragraph-by-paragraph the way this ticket's own rewritten docs are.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]

README = REPO_ROOT / "README.md"
TOOLS_MD = REPO_ROOT / "docs" / "tools.md"
DESIGN_INDEX = REPO_ROOT / "docs" / "design" / "README.md"
DEPLOYMENT = REPO_ROOT / "docs" / "reference" / "deployment.md"
DATA_PROVIDER = REPO_ROOT / "docs" / "reference" / "data-provider.md"
WEBMCP_GUIDE = REPO_ROOT / "docs" / "reference" / "webmcp-guide.md"
WEBMCP_CHALLENGE = REPO_ROOT / "docs" / "reference" / "webmcp-challenge.md"
PACKAGE_JSON = REPO_ROOT / "package.json"
HEALTH_ROUTE = REPO_ROOT / "backend" / "api" / "routes" / "health.py"

STRICT_SCOPE_FILES = [
    README,
    TOOLS_MD,
    DESIGN_INDEX,
    DEPLOYMENT,
    DATA_PROVIDER,
    WEBMCP_GUIDE,
    WEBMCP_CHALLENGE,
]

SUPERSEDED_FILES = [
    REPO_ROOT / "docs" / "design" / "pattern-research-workbench" / "spec.md",
    REPO_ROOT / "docs" / "design" / "pattern-research-workbench" / "technical.md",
    REPO_ROOT / "docs" / "design" / "workspace-snapshots" / "spec.md",
    REPO_ROOT / "docs" / "design" / "workspace-snapshots" / "technical.md",
]

LEGACY_TOOL_NAMES = [
    "defineStudy",
    "defineSetup",
    "findInstances",
    "sampleInstances",
    "measure",
    "splitInstances",
    "showGrid",
    "showTickerCharts",
    "clearPanels",
    "focusInstance",
    "getWorkspace",
]

# Representative retired files/routes/endpoints -- the ones plausibly
# reachable from prose in these particular docs (not an exhaustive replay
# of the whole retirement inventory; see test_retirement_inventory.py for
# that document's own completeness checks).
RETIRED_REFERENCES = [
    "src/lib/webmcp/tools.ts",
    "src/lib/webmcp/register.ts",
    "src/lib/webmcp/session.ts",
    "src/lib/workspace/store.ts",
    "src/lib/workspace/apiEngine.ts",
    "src/lib/workspace/activity.ts",
    "src/lib/workspace/snapshots.ts",
    "TickerSearch.svelte",
    "src/lib/shell/AppShell.svelte",
    "routes/dev",
    "routes/spike",
    "routes/workbench",
    "backend/api/routes/research.py",
    "backend/api/routes/spike.py",
    "/api/spike/ping",
    "/api/research/find-instances",
    "/api/research/panel",
]

_RETIREMENT_SIGNAL = re.compile(
    r"retire|delet|supersed|drop|legacy|historical|no longer", re.IGNORECASE
)
_MD_LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
_HEADING = re.compile(r"(?m)^(#{1,6}\s.*)$")


def _sections(text: str) -> list[str]:
    """Splits markdown into chunks, each running from one heading through
    (but not including) the next -- the unit AC6's proximity check uses,
    since that's the granularity these docs were actually written at
    (a note near a section's top, a table further down the same section)."""
    parts = _HEADING.split(text)
    chunks = [parts[0]] if parts[0].strip() else []
    for i in range(1, len(parts), 2):
        heading = parts[i]
        body = parts[i + 1] if i + 1 < len(parts) else ""
        chunks.append(heading + body)
    return chunks


def _word_bounded(target: str) -> re.Pattern[str]:
    return re.compile(r"(?<!\w)" + re.escape(target) + r"(?!\w)")


def _local_link_targets(text: str) -> list[str]:
    """Every markdown link target that isn't an external URL or a bare
    in-page anchor."""
    targets = []
    for target in _MD_LINK.findall(text):
        target = target.split("#", 1)[0].strip()
        if not target or target.startswith(("http://", "https://", "mailto:")):
            continue
        targets.append(target)
    return targets


class TestDocsCutoverHappyPath:
    """spec.md "Documentation cutover / Happy path" scenario."""

    def test_readme_names_only_paths_routes_and_commands_that_exist(self) -> None:
        text = README.read_text()

        local_links = _local_link_targets(text)
        assert local_links, "expected README.md to contain at least one local doc/file link"
        missing_links = [t for t in local_links if not (REPO_ROOT / t).exists()]
        assert not missing_links, f"README.md links to paths that don't exist: {missing_links}"

        # Every `npm run <script>`/`npm test` README instructs the reader to
        # run must be a real script in package.json.
        scripts = json.loads(PACKAGE_JSON.read_text())["scripts"]
        for npm_cmd in re.findall(r"npm run ([a-zA-Z:_-]+)", text):
            assert npm_cmd in scripts, (
                f"README names `npm run {npm_cmd}`, which is not in package.json's scripts: "
                f"{sorted(scripts)}"
            )
        if "npm test" in text:
            assert "test" in scripts, "README names `npm test`, missing from package.json"

        # Backtick-quoted bare relative file paths named in prose (not
        # inside a markdown link, already checked above) should also
        # resolve, for the handful this doc cites by path rather than by
        # link (e.g. `render.yaml`, `backend/.env.example`) -- except a
        # path the doc itself says is gitignored/generated-on-demand (the
        # mock panel), which is legitimately absent in a fresh checkout
        # until its own documented command is run.
        for match in re.finditer(r"`([\w./-]+\.[\w]+)`", text):
            token = match.group(1)
            if "://" in token or token.startswith("."):
                continue
            if any(token.endswith(suffix) for suffix in (".ts", ".svelte", ".env")):
                continue  # config-var-bearing prose reference, not a path claim
            nearby = text[max(0, match.start() - 200) : match.start() + 200]
            if "gitignored" in nearby:
                continue
            candidate = REPO_ROOT / token
            if "/" in token and not candidate.exists():
                pytest.fail(f"README.md names {token!r} in backticks, which does not exist")

    def test_tools_md_lists_no_retired_tool_and_has_no_stale_code_layout_section(self) -> None:
        text = TOOLS_MD.read_text()
        assert not re.search(r"(?m)^#{1,6}\s+Code layout", text), (
            "expected docs/tools.md to have no 'Code layout' section (it would name deleted "
            "files)"
        )

        # None of the 11 legacy tool names may appear outside the
        # "Capability changes" section, where they are named specifically
        # as retired.
        heading_positions = [(m.start(), m.group(1)) for m in _HEADING.finditer(text)]
        capability_heading = next(
            (pos for pos, h in heading_positions if "Capability changes" in h), None
        )
        assert (
            capability_heading is not None
        ), "expected docs/tools.md to have a 'Capability changes' section"
        later_headings = [pos for pos, _ in heading_positions if pos > capability_heading]
        capability_section_end = min(later_headings, default=len(text))
        before = text[:capability_heading]
        after = text[capability_section_end:]

        for tool in LEGACY_TOOL_NAMES:
            pattern = _word_bounded(tool)
            assert not pattern.search(before) and not pattern.search(after), (
                f"legacy tool `{tool}` appears in docs/tools.md outside the 'Capability "
                f"changes' section, which would present it as (still) part of the shipped "
                f"surface"
            )

    def test_readme_health_check_command_targets_health_not_spike_ping(self) -> None:
        text = README.read_text()
        health_path_match = re.search(r'HEALTH_PATH\s*=\s*"([^"]+)"', HEALTH_ROUTE.read_text())
        assert (
            health_path_match is not None
        ), "expected backend/api/routes/health.py to define a HEALTH_PATH constant"
        health_path = health_path_match.group(1)
        assert f"localhost:8000{health_path}" in text, (
            f"expected README's health-check command to target {health_path!r} "
            f"(backend/api/routes/health.py's HEALTH_PATH), got: "
            f"{[line for line in text.splitlines() if 'curl' in line]}"
        )
        assert (
            "/api/spike/ping" not in text
        ), "README must not instruct the reader to curl the retired /api/spike/ping endpoint"


class TestSupersededSpec:
    """spec.md "Documentation cutover / Superseded spec" scenario."""

    def test_pattern_research_workbench_spec_marked_superseded_or_removed(self) -> None:
        spec = REPO_ROOT / "docs" / "design" / "pattern-research-workbench" / "spec.md"
        assert spec.exists(), "expected the spec to exist (marked superseded) or be removed"
        assert "Superseded" in spec.read_text()[:800], (
            "expected a 'Superseded' banner near the top of " "pattern-research-workbench/spec.md"
        )

    def test_design_index_has_no_dangling_entries(self) -> None:
        text = DESIGN_INDEX.read_text()
        links = [t for t in _local_link_targets(text) if t.endswith(".md")]
        assert links, "expected docs/design/README.md to link to at least one spec"
        missing = [t for t in links if not (DESIGN_INDEX.parent / t).exists()]
        assert not missing, f"docs/design/README.md links to missing files: {missing}"

    def test_every_superseded_doc_carries_its_own_banner(self) -> None:
        for doc in SUPERSEDED_FILES:
            assert doc.exists(), f"expected {doc} to still exist (amended, not deleted)"
            assert (
                "Superseded" in doc.read_text()[:800]
            ), f"expected a 'Superseded' banner near the top of {doc}"


class TestRecordedDrop:
    """spec.md "Documentation cutover / Recorded drop" scenario."""

    def test_every_accepted_drop_is_documented_outside_the_plan_folder(self) -> None:
        text = TOOLS_MD.read_text()
        assert "Capability changes" in text
        # The 6 capabilities capability-parity-matrix.md's sign-off section
        # records as accepted, deliberate drops (not the 4 that became
        # T-1015-9/10/11/12 scope, which are documented as shipped, not as
        # drops -- see docs/tools.md's own section).
        accepted_drop_keywords = [
            "temporal sequencing",
            "measure",  # outcome measurement / measure+splitInstances drop
            "splitInstances",
            "instance focus",
            "progressive tool availability",
            "manual tool-harness route",
        ]
        missing = [kw for kw in accepted_drop_keywords if kw.lower() not in text.lower()]
        assert not missing, (
            f"expected docs/tools.md's Capability changes section to document every "
            f"accepted drop, missing keywords: {missing}"
        )
        # And they must be reachable from outside docs/plan/EPIC-1015/ -- by
        # construction, since TOOLS_MD is docs/tools.md, not under
        # docs/plan/ -- assert that explicitly rather than just assuming it.
        assert "docs/plan" not in str(TOOLS_MD.relative_to(REPO_ROOT)).replace("\\", "/")


class TestNoDanglingReferences:
    """T-1015-7 AC6."""

    def test_no_doc_references_a_deleted_file_tool_route_endpoint_or_env_var(self) -> None:
        offenders: list[tuple[str, str, str]] = []
        targets = LEGACY_TOOL_NAMES + RETIRED_REFERENCES
        for doc in STRICT_SCOPE_FILES:
            text = doc.read_text()
            for chunk in _sections(text):
                for target in targets:
                    if _word_bounded(target).search(chunk) and not _RETIREMENT_SIGNAL.search(chunk):
                        offenders.append((str(doc.relative_to(REPO_ROOT)), target, chunk[:120]))
        assert not offenders, (
            f"found references to retired tools/files/routes/endpoints with no "
            f"retirement-signal word in the same section (i.e. presented as still current): "
            f"{offenders}"
        )

    def test_superseded_docs_are_exempt_via_their_banner_not_individually_scrubbed(self) -> None:
        # The four superseded docs are expected to still name every legacy
        # tool and file in their unmodified historical bodies -- that is
        # the point of "amend over delete." Confirm at least one legacy
        # name still appears there (proving the body really was kept, not
        # silently emptied) and that the banner is what makes that OK.
        spec = REPO_ROOT / "docs" / "design" / "pattern-research-workbench" / "spec.md"
        text = spec.read_text()
        assert any(_word_bounded(tool).search(text) for tool in LEGACY_TOOL_NAMES), (
            "expected the superseded spec's historical body to still name at least one "
            "legacy tool -- if none remain, the 'kept as historical record' framing is false"
        )
        assert text.index("Superseded") < 800
