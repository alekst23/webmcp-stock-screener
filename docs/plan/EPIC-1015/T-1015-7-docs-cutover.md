# T-1015-7: Docs cutover

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Status**: Done
**Depends on**: T-1015-4, T-1015-6
**Blocks**: T-1015-8

## Description

After the code cutover, the project's documentation still describes the
retired surface: the readme frames the product as an event-atom
hypothesis workbench, the tool reference lists nine of the eleven
retired tools with a code layout that no longer exists, and the design
docs specify behavior that has been replaced. Documentation that
describes deleted code is worse than no documentation, because it reads
as authoritative.

This ticket brings every doc in line with what actually ships, and
records the cutover itself — including the capability drops T-1015-2
surfaced — so the decision is discoverable later.

## User Story

As someone arriving at this repository after the cutover,
I want the docs to describe the surface that exists,
so that I do not spend an afternoon looking for tools and files that
were deleted.

## Acceptance Criteria

1. The readme describes the shipped product, its tool surface, and its
   local-development steps accurately, and every path, route, endpoint,
   and command it names exists.
2. The tool reference documents the shipped tools, their availability
   rules, and their result contract, with no retired tool listed and no
   stale code-layout section.
3. The design-doc index and the feature specs describe current behavior;
   specs for retired behavior are removed or clearly marked as
   superseded, and the index has no dangling entries.
4. The deployment and reference docs name the endpoints and health check
   that exist after T-1015-4.
5. The capability drops and partial matches recorded in T-1015-2 are
   documented where a future reader would look for them, not only inside
   the epic's plan folder.
6. No doc references a deleted file, tool, route, endpoint, or
   environment variable.
7. Every command and URL a reader is instructed to run is verified to
   work against the post-cutover code.

## Design References

- `README.md` — currently frames the product around the event atom and
  points at the legacy tool reference and the legacy dev harness route.
- `docs/tools.md` — the legacy tool surface, its nouns, its design
  rules, and its code layout.
- `docs/design/README.md` — the design index; both feature entries it
  lists are affected by the cutover.
- `docs/design/pattern-research-workbench/`,
  `docs/design/workspace-snapshots/` — the specs being superseded.
- `docs/reference/deployment.md`, `docs/reference/data-provider.md`,
  `docs/reference/webmcp-guide.md`, `docs/reference/webmcp-challenge.md`
  — deployment and background reference; the first two contain
  endpoint-specific claims that T-1015-4 may invalidate.
- `docs/plan/EPIC-1015/` — the inventory, parity matrix, and drop list
  that this ticket surfaces into user-facing docs.

## Technical Considerations

The design docs are organized by concept rather than by epic, and a
single spec is touched by several epics over its life. Prefer amending
a spec to describe current behavior over deleting it outright, unless
the concept itself is gone; a spec that documented a whole retired
feature should be removed and de-indexed rather than left orphaned.

The readme's local-development section is load-bearing for anyone
picking the project up: it names both dev ports, the default backend
URL fallback, the default allowed origin, and a health-check command.
All four are affected by the cutover and each should be run, not
assumed.

Documentation is not a place to preserve retired behavior "for
reference" — that is the Dead Code Policy applied to prose. Git history
holds it.

## Solution Approach

**Implements**: the "Documentation cutover" scenarios in spec.md (happy
path, superseded spec, recorded drop).

**Approach**: docs-only, gated on T-1015-4 and T-1015-6 (code cutover
complete). Rewrite `README.md` to describe the shipped surface and its
local-dev steps, running (not assuming) each named port, backend-URL
fallback, allowed origin, and health-check command against the
post-cutover code — the health-check command now targets `/health`, since
T-1015-1's audit found the epic doc's original spike-endpoint hazard was
already resolved by T-0016-2 before this epic started. Rewrite
`docs/tools.md` to list only the shipped tools with their availability
rules and result contract, dropping the "Code layout" section that would
otherwise name deleted files. In `docs/design/README.md`, mark
`docs/design/pattern-research-workbench/spec.md` and `docs/design/
workspace-snapshots/spec.md` as superseded rather than deleting outright
(the project convention: amend over delete when the concept partially
survives — most of the legacy capability list did, in reduced or absorbed
form, per the parity matrix). Update `docs/reference/deployment.md` and
`docs/reference/data-provider.md` to name the post-T-1015-4 endpoints and
health check. Add a "Capability changes" section, in `docs/tools.md` or
the design index, that transcribes the **10 structural-gap items** from
`capability-parity-matrix.md`'s sign-off section: the 6 the user accepted
as deliberate drops (temporal sequencing, `measure`/`splitInstances`,
instance focus, progressive availability, the manual harness route) get
documented as accepted drops; the items that became T-1015-9/10/11/12
scope get documented as shipped features once those tickets land, not as
drops — this ticket must check their actual landed state rather than
copy the matrix's wording verbatim, since it predates them. A final grep
pass over the docs confirms no reference to a deleted file, tool, route,
endpoint, or env var remains (AC6).

**Contracts to introduce**: none.

**Config vars introduced**: none.

**References**: `docs/plan/EPIC-1015/retirement-inventory.md`,
`capability-parity-matrix.md` (the drop list this ticket surfaces),
`README.md`, `docs/tools.md`, `docs/design/README.md`,
`docs/reference/deployment.md`, `docs/reference/data-provider.md`.

## Out of Scope

Code changes beyond what a doc fix requires. Verifying the live deploy
(T-1015-8). Writing docs for new-surface features — those belong to the
sibling epics that built them.

## Implementation Notes

- **README.md**: rewritten to describe MarketPane (screener/workbench, not
  the event-atom workbench), dropped the `/dev` harness reference, changed
  the health-check command to `curl localhost:8000/health` (verified: `200`,
  `{"status":"ok"}`), and re-verified the other three load-bearing local-dev
  claims by actually running them rather than assuming: port 5173 (frontend,
  confirmed via a real `npm run dev` — a concurrent session already held
  5173, which itself confirms another instance is bound there), port 8000
  (backend, confirmed via `uv run uvicorn main:app --port 8000`), the
  `http://localhost:8000` fallback (`apiConfig.ts`'s `DEV_API_BASE_URL`,
  read from source), and the `http://localhost:5173` CORS default
  (`_allowed_origins()`, read from source). Also repointed the Docs section
  from the stale root `docs/plan.md` (a pre-hackathon planning doc that
  still describes the retired tool surface) to `docs/plan/project.md`, the
  actually-current status/decision log.
- **docs/tools.md**: rewritten around the shipped ~39-tool surface
  (verified by reading every `register*Tools`/`build*Tools` call site
  reachable from `workbenchCompositionRoot.ts`, the app's one composition
  root), grouped by area with a pointer to each area's own design spec
  rather than re-documenting each tool's full contract (that belongs to
  the sibling epics per this ticket's Out of Scope). Dropped the "Code
  layout" section. Added a "Not yet part of the live tool surface" note
  for the ~12 follow-up tools (backtest, watchlist, alerts, filter-draft
  refinement, export) that are merged and tested but not registered by the
  live composition root and whose own `*_TOOLS_ENABLED` flags are still
  false — found during this ticket's verification pass, not previously
  documented anywhere; called out so the doc doesn't overclaim reachability
  (AC2/AC6). Added the "Capability changes" section transcribing the
  capability-parity-matrix's 10 structural-gap items: 6 as accepted drops,
  4 as shipped (T-1015-9/10/11/12, each verified against the actual merged
  code — the shell, the close button + attributed log, and the
  `get_canvas_state` panel-kind fix all confirmed live by reading the
  current source, not copied from the matrix's pre-T-1015-9..12 wording).
- **docs/design/README.md**: reorganized into Core Product / Presentation /
  Superseded, with Pattern Research Workbench and Workspace Snapshots moved
  to a new Superseded section (kept, not de-indexed — both files still
  exist) and the Screener Follow-up Tools entry annotated with the same
  not-yet-wired note as docs/tools.md.
- **docs/design/pattern-research-workbench/{spec,technical}.md** and
  **docs/design/workspace-snapshots/{spec,technical}.md**: each gained a
  superseded banner at the top (what replaced it, why the body is kept
  unmodified below the banner) rather than being deleted — per this
  ticket's Technical Considerations, amend over delete when the concept
  partially survives.
- **docs/reference/deployment.md**: added a note on the dated T-0001-8
  verification table clarifying it predates EPIC-1015 and names endpoints
  since retired, plus a new "Post-cutover status" section naming the
  surviving routes (`/health`, `/api/similarity/*`, `/api/backtests*`) read
  directly from the current route files, with the backtest routes flagged
  as not yet reachable from the live app (same finding as docs/tools.md).
- **docs/reference/data-provider.md**: replaced the stale legacy tool
  names (`findInstances`, `measure`, `showGrid`) in the "What we use it
  for" paragraph with current tool names, and repointed the `docs/plan.md`
  link to `docs/plan/project.md`.
- **AC6 grep pass**: `grep -rlE` for every legacy tool name and every
  retired file path across `README.md`, `docs/tools.md`, `docs/design/`,
  `docs/reference/` turns up only the intentional, clearly-labeled
  retired/superseded mentions this ticket itself wrote (the "Capability
  changes" and "Post-cutover status" sections) — no doc presents a deleted
  file, tool, route, or endpoint as currently reachable.
- **Backend test stubs** (additional scope): gave real assertions to
  `backend/tests/unit/test_retirement_inventory.py`,
  `test_capability_parity_matrix.py`, and `test_docs_cutover.py` — see
  those files' own module docstrings for the reasoning on
  `TestNoGoVerdict` (kept testing the matrix's own stated
  what-would-change-a-no-go-to-a-go content, since that content is still
  literally true of the document; added a new assertion that the matrix
  records its own supersession, since the *verdict's standing* did
  change).
- Verification: `uv run pytest` (backend, from `backend/`) and
  `npx vitest run` (frontend) both pass; frontend is unaffected by a
  docs-only change, run to confirm rather than assumed.
