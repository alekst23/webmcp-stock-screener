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

## Out of Scope

Code changes beyond what a doc fix requires. Verifying the live deploy
(T-1015-8). Writing docs for new-surface features — those belong to the
sibling epics that built them.
