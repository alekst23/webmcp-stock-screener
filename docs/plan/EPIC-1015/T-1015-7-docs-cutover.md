# T-1015-7: Docs cutover

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Status**: Open
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
