# T-1005-1: Snapshot persistence layer

**Epic**: EPIC-1005 (Workspace Snapshots)
**Design**: docs/design/workspace-snapshots/
**Status**: Open
**Depends on**: —
**Blocks**: T-1005-2
**Issue**: #5

## Description

Add the underlying save/load/delete/list operations for named workspace
snapshots, entirely in `localStorage`, alongside (not replacing) the
existing single live-workspace persistence in `store.ts`.

## User Story

As a developer wiring up the snapshot picker (T-1005-2),
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

Left to ticket design — e.g. a new `snapshots.ts` module alongside
`store.ts`, exposing `saveSnapshot`, `loadSnapshot`, `deleteSnapshot`,
`listSnapshots`. Exact `localStorage` key scheme (per-snapshot keys vs. a
single index) is a ticket-design decision.

## Out of Scope

The picker UI and the unsaved-changes warning (T-1005-2).
