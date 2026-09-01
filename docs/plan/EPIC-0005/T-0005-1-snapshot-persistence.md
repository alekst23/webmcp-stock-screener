# T-0005-1: Snapshot persistence layer

**Epic**: EPIC-0005 (Workspace Snapshots)
**Design**: docs/design/workspace-snapshots/
**Status**: Done
**Depends on**: —
**Blocks**: T-0005-2
**Issue**: #5

## Description

Add the underlying save/load/delete/list operations for named workspace
snapshots, entirely in `localStorage`, alongside (not replacing) the
existing single live-workspace persistence in `store.ts`.

## User Story

As a developer wiring up the snapshot picker (T-0005-2),
I want a small set of functions to save, load, delete, and list named
snapshots,
so that the UI ticket only has to call them, not reimplement storage
logic.

## Acceptance Criteria

1. A function saves the current `WorkspaceState` under a given name,
   overwriting any existing snapshot with that name, and recording a
   `savedAt` timestamp.
2. A function returns a saved snapshot's `WorkspaceState` by name, or
   indicates it doesn't exist.
3. A function deletes a saved snapshot by name.
4. A function lists every saved snapshot's `name` and `savedAt`.
5. None of the above touch the live workspace's own persisted state
   (`webmcp-workspace-state`) — snapshots are a separate, additional
   store.
6. Loading a snapshot's state into the live workspace goes through the
   existing `WorkspaceState` normalization (`store.ts`'s
   `normalizeWorkspace`) so malformed/foreign data can't crash the app,
   matching the live workspace's existing resilience.

## Design References

- `docs/design/workspace-snapshots/spec.md` — "Save a named snapshot,"
  "Recall a snapshot," "Delete a snapshot," "Browse snapshots" scenarios
- `docs/design/workspace-snapshots/technical.md` — snapshot record shape
- `src/lib/workspace/store.ts` — existing persistence pattern
  (`readPersisted`/`normalizeWorkspace`) to follow

## Solution Approach

Implements the "Save a named snapshot," "Recall a snapshot," "Delete a
snapshot," and "Browse snapshots" scenarios from
`docs/design/workspace-snapshots/spec.md`, as a pure data-layer module —
no UI (T-0005-2's scope).

- New module `src/lib/workspace/snapshots.ts`, sibling to `store.ts`,
  following the same explicit-`Storage`-parameter pattern (default: real
  `localStorage`, tests pass an in-memory `Storage`) so tests don't
  depend on jsdom's shared global.
- Single-index key scheme: one `localStorage` key
  (`webmcp-workspace-snapshots`) holding a JSON object keyed by snapshot
  `name` → `SnapshotRecord`. Simpler than per-snapshot keys — no need to
  enumerate `localStorage` keys to list/prune, and overwrite-by-name
  (AC2) is a single object-key assignment.
- Four functions: `saveSnapshot`, `loadSnapshot`, `deleteSnapshot`,
  `listSnapshots`. `loadSnapshot` runs the returned state through
  `store.ts`'s `normalizeWorkspace` before handing it back (AC6), so a
  corrupted/foreign snapshot entry can't crash the app any more than a
  corrupted live-workspace entry can today.
- `store.ts`'s `normalizeWorkspace` is exported (currently module-private)
  so `snapshots.ts` can call it — no other change to `store.ts` or to the
  live workspace's own persistence/reload behavior.
- Read of the index follows `readPersisted`'s existing resilience
  pattern: missing key → empty map, parse failure → empty map (never
  throws).

### Contracts to introduce

- `SnapshotSummary` (`{ name, savedAt }`) — what `listSnapshots` returns;
  the shape the picker UI (T-0005-2) renders.
- `SnapshotRecord` (`SnapshotSummary & { state: WorkspaceState }`) — what
  is actually stored per snapshot.

### References

- `src/lib/workspace/store.ts` — `readPersisted`/`normalizeWorkspace`
  pattern this follows; `normalizeWorkspace` becomes exported.
- `src/lib/workspace/store.test.ts` — in-memory `Storage` test pattern
  (`memoryStorage()`) to reuse in `snapshots.test.ts`.
- `docs/design/workspace-snapshots/technical.md` — snapshot record shape.

## Out of Scope

The picker UI and the unsaved-changes warning (T-0005-2).
