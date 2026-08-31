# EPIC-1005: Workspace Snapshots

**Depends on**: —
**Blocks**: —
**Issue**: #5
**Design**: docs/design/workspace-snapshots/

## Description

The workspace is currently a single, unnamed, ever-accumulating session
per browser — starting a new line of research means losing the last one.
This epic adds the ability to save the current workspace under a name
and recall/switch between saved snapshots, entirely within
`localStorage` in the current browser (no backend, no cross-device
sync), consistent with the existing pattern-research-workbench design's
"local to one browser" model.

## User Story

As a researcher iterating across multiple lines of investigation,
I want to save my current workspace under a name and come back to it
later,
so that starting something new doesn't mean losing the work I already
did.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1005-1 | Snapshot persistence layer | — | Done |
| 2 | T-1005-2 | Snapshot picker UI | T-1005-1 | Done |
| 3 | T-1005-3 | Handle localStorage write failures and reserved-name collisions | — | Open |
| 4 | T-1005-4 | Add SnapshotPicker test coverage and fix remount-fragile baseline | — | Open |
| 5 | T-1005-5 | Minor cleanup — dedupe empty-workspace literal, shared test fake, unused export | — | Open |

## Dependency Graph

```
T-1005-1 ──> T-1005-2
```

## Wave Plan

- **Wave 1**: T-1005-1 — no dependencies
- **Wave 2**: T-1005-2 — depends on T-1005-1's save/load/delete/list functions

## Acceptance Criteria

1. The current workspace state can be saved under a user-chosen name,
   stored separately from the live workspace.
2. Saving under an existing name overwrites that snapshot.
3. Selecting a saved snapshot replaces the live workspace with its
   contents.
4. Switching away from unsaved changes in the live workspace warns the
   user before proceeding.
5. A saved snapshot can be deleted; the live workspace is unaffected even
   if it was originally loaded from that snapshot.
6. Every saved snapshot's name is visible in a picker.
7. The action/activity log (EPIC-1002) is not part of a snapshot's
   contents.
8. Resolves #5.

## Design References

- `docs/design/workspace-snapshots/spec.md`
- `docs/design/workspace-snapshots/technical.md`
- `src/lib/workspace/store.ts` — existing single-workspace persistence
  pattern this extends

## Out of Scope

- Cross-device/cross-browser sync.
- Editing a snapshot's contents directly.
- Automatic/scheduled snapshotting.
- Renaming a snapshot in place.
