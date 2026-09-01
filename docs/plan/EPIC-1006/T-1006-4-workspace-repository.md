# T-1006-4: Workspace repository and named revision storage

**Epic**: EPIC-1006 (Workspace, Revisions & the Common Tool Contract)
**Design**: docs/design/workspace-revisions/
**Status**: Open
**Depends on**: T-1006-1
**Blocks**: T-1006-5

## Description

The workspace document needs somewhere to live, and every revision it
passes through needs to be recoverable so `restore_workspace_revision` and
undo have something to restore to. This ticket adds a repository port and a
browser-storage implementation that holds multiple workspaces, tracks which
one is active, and keeps a bounded history of revision snapshots — entirely
separate from the storage the shipping workspace uses, so neither disturbs
the other.

## User Story

As the revision service that will guard every write in the program,
I want a repository that loads and stores workspaces and their past
revisions,
so that concurrency checks, undo and restore all read from one place
instead of each epic persisting its own state.

## Acceptance Criteria

1. Workspaces can be listed as summaries carrying their ID, name, current
   revision and last-updated time.
2. A workspace can be fetched by ID, and a missing ID is reported as
   absent rather than raising.
3. A workspace can be stored, replacing any existing document with the
   same ID.
4. Exactly one workspace is marked active at a time; the active ID can be
   read and set, and is absent when no workspace exists yet.
5. A revision snapshot can be stored for a workspace, carrying the
   workspace ID, the revision number, an optional name, the time it was
   saved and the full document at that revision.
6. Revision snapshots for a workspace can be listed in revision order and
   fetched individually by revision number.
7. Storing a snapshot for a revision that already has one replaces it
   rather than duplicating it.
8. Revision snapshots are pruned to a bounded most-recent set per
   workspace, and a snapshot that carries a name is never pruned.
9. Corrupt, partial or foreign data in the underlying storage yields an
   empty or normalized result instead of crashing the application, and a
   failed write does not corrupt previously stored data.
10. The storage locations used do not overlap with those the shipping
    workspace and snapshot features use, and running this repository leaves
    their data untouched.
11. The backing storage is an explicit dependency so tests can supply an
    isolated in-memory store rather than relying on a browser global.

## Design References

- `docs/design/workspace-revisions/technical.md` — "T-1006-4" section
  defines the port, the record shapes, the storage keys and the retention
  rule.
- `src/lib/workspace/store.ts` — the explicit-`Storage`-parameter pattern
  and `readPersisted`'s never-throw behavior to follow.
- `src/lib/workspace/snapshots.ts` — the existing precedent for adding a
  second store under its own key without touching the live one.
- `src/lib/workspace/store.test.ts` — the in-memory `Storage` test helper
  pattern to reuse.

## Technical Considerations

- Port in `src/lib/workbench/domain/ports.ts`; implementation in
  `src/lib/workbench/infra/workspaceRepository.ts`. The port must not
  mention `localStorage` — a server-backed store should be able to
  implement it unchanged.
- Exported contract surface other epics depend on: `WorkspaceRepository`,
  `SavedRevision`, `WorkspaceSummary`,
  `createLocalWorkspaceRepository(storage?)`.
- Storage keys: `workbench-workspaces`, `workbench-revisions`,
  `workbench-active`. Distinct from `webmcp-workspace-state` and
  `webmcp-workspace-snapshots` — overlapping them would break the shipping
  app.
- Snapshotting every revision is deliberate: it is what makes restore and
  undo cheap. Cap at the 100 most recent per workspace, exempting named
  ones. Note the quota risk in the implementation and fail a write
  gracefully rather than corrupting the index.
- Documents read back must be run through T-1006-1's normalization, so a
  hand-edited or older stored document cannot crash a load.

## Out of Scope

Deciding when to write (T-1006-5), the change log (T-1006-6), and any tool
surface (T-1006-8).
