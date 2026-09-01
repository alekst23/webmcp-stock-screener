# T-1007-4: Panel mutation use cases over the common contract

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Open
**Depends on**: T-1007-1, T-1007-2, T-1007-3
**Blocks**: T-1007-5

## Description

Wave 1 produced three independent pure modules — the panel entity and
kind registry, the grid geometry, and the link graph. This ticket
composes them into the five actual panel operations against a live
workspace, and makes each one a well-behaved citizen of the common
mutation contract EPIC-1006 owns: optimistic concurrency via
`expected_revision`, replay safety via `idempotency_key`, a standard
result envelope, and a registered inverse so the change can be undone.

Done looks like: five use cases that each take a workspace and a request
and return the standard envelope, unit-tested against a fake workspace,
with no WebMCP or UI involvement.

## User Story

As an agent mutating a workspace,
I want every panel operation to either apply completely or not at all,
tell me exactly what changed, refuse to act on a stale view of the
workspace, and be reversible,
so that I can compose a layout confidently and recover from a mistake in
one call.

## Acceptance Criteria

1. Adding a panel validates the kind against the registry, validates the
   configuration against that kind, resolves a footprint — the caller's
   if supplied, an auto-chosen free one otherwise — validates the
   placement, and adds the panel with a newly minted stable ID; a failure
   at any step leaves the workspace untouched.
2. Updating a panel can change its title, configuration, visibility,
   collapsed state, and bound resource, independently and in combination;
   configuration is validated by the panel's kind and a binding is
   rejected if its resource type is not one the kind accepts.
3. Setting a layout applies a batch of footprints all-or-nothing, and
   panels absent from the batch are unmoved.
4. Linking panels validates each panel's kind against the requested
   channel before any link is created, and supports both joining and
   leaving a channel's group.
5. Removing a panel deletes it, frees its cells, drops it from every
   channel's group, and dissolves groups left with fewer than two
   members.
6. Every operation returns the common mutation envelope: a change ID, the
   new revision, the affected stable IDs, a human-readable diff summary,
   warnings, and an undo token.
7. `affected_ids` names every panel the change actually touched — the
   subject panel plus, for a removal, the panels whose link groups
   changed as a result.
8. An operation whose `expected_revision` does not match the workspace's
   current revision is rejected as a conflict and changes nothing.
9. An operation repeated with an `idempotency_key` already applied
   returns the original envelope and applies no second change.
10. Each operation registers an inverse such that redeeming the returned
    undo token restores the workspace's panels, footprints, and link
    groups to their prior state — verified for all five operations,
    including that an undone removal restores the panel's original ID,
    configuration, footprint, and link memberships.
11. A failed operation never consumes a revision and never emits an undo
    token.

## Design References

- `docs/design/panel-system/spec.md` — every scenario for add, update,
  lay out, link, and remove
- `docs/design/panel-system/technical.md` — "Consumed from EPIC-1006"
  table and the use-case list
- `docs/plan/EPIC-1006/_epic.md` — the workspace/revision model, stable-ID
  minting, mutation envelope, `expected_revision`, `idempotency_key`, and
  undo token contracts this ticket consumes
- `.dev/design/tool-spec.md` — the canonical envelope shape

## Technical Considerations

- **This ticket is blocked until EPIC-1006 lands.** Do not re-implement
  revisions, ID minting, the envelope, idempotency storage, or the undo
  store — consume them. If a needed piece of EPIC-1006's surface is
  missing, raise it rather than building a local copy.
- Keep each use case at or under the project's method size limit;
  validation sequences belong in the Wave 1 domain modules, not inlined
  here.
- `diff_summary` is read by a human in the activity log — it should name
  the panel and what changed, not restate the request.
- New files only. Do not modify the existing 11-tool surface,
  `src/lib/workspace/store.ts`, or the current UI.

## Out of Scope

Tool schemas and agent-facing error shaping (T-1007-5), rendering
(T-1007-6), and any panel-kind-specific behavior beyond calling the
kind's own validator.
