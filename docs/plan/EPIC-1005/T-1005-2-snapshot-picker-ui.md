# T-1005-2: Snapshot picker UI

**Epic**: EPIC-1005 (Workspace Snapshots)
**Design**: docs/design/workspace-snapshots/
**Status**: Open
**Depends on**: T-1005-1
**Blocks**: —
**Issue**: #5

## Description

Wire T-1005-1's save/load/delete/list functions into a UI: a way to save
the current workspace under a name, browse and switch to saved
snapshots, and delete ones no longer needed — including warning the user
before discarding unsaved live changes on switch.

## User Story

As a researcher,
I want to save, browse, switch between, and delete named workspace
snapshots from the page,
so that I can manage multiple research threads without losing work.

## Acceptance Criteria

1. The user can save the current workspace under a name they enter.
2. The user can see a list of saved snapshot names and select one to
   load, replacing the live workspace with its contents.
3. If the live workspace has changes since the last save/load, switching
   to a different snapshot warns the user before proceeding; confirming
   proceeds, canceling leaves the live workspace untouched.
4. The user can delete a saved snapshot from the list.
5. Resolves #5.

## Design References

- `docs/design/workspace-snapshots/spec.md` — full behavioral
  specification
- `src/routes/+page.svelte` — where the picker is wired in

## Solution Approach

Left to ticket design — likely a new Svelte component (e.g.
`SnapshotPicker.svelte`) using T-1005-1's functions, rendered in
`+page.svelte`'s header/toolbar area.

## Out of Scope

The persistence functions themselves (T-1005-1). Any change to the live
workspace's own reload persistence behavior.
