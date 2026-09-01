# T-0005-2: Snapshot picker UI

**Epic**: EPIC-0005 (Workspace Snapshots)
**Design**: docs/design/workspace-snapshots/
**Status**: Done
**Depends on**: T-0005-1
**Blocks**: —
**Issue**: #5

## Description

Wire T-0005-1's save/load/delete/list functions into a UI: a way to save
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

Implements the UI side of all four `docs/design/workspace-snapshots/spec.md`
scenarios, wiring T-0005-1's `saveSnapshot`/`loadSnapshot`/`deleteSnapshot`/
`listSnapshots` into the page. Following this codebase's existing split
(`ChartToolbar.svelte`, `ActivityFeed.svelte` are thin, untested wiring;
the logic they call — `apiEngine.ts`, `store.ts` — is unit-tested), the
one piece of new *logic* this ticket adds (the unsaved-changes check,
AC3) is extracted into a plain, unit-testable function rather than living
inline in the component.

- New pure function `hasUnsavedChanges` in a new module
  `src/lib/workspace/snapshotGuard.ts`: compares the live `WorkspaceState`
  against a `baseline` (the state as of the last save-into or load-from a
  snapshot this session; `null` before either has happened, treated as
  an empty workspace per `store.ts`'s `emptyWorkspace()`) via structural
  (JSON) equality. `WorkspaceState` has no non-serializable fields, so
  this is safe and matches what `SnapshotRecord.state` already captures
  wholesale (studies/setups/instanceSets/panels/focus — AC7's exclusion
  of the activity log holds automatically, since the log lives in a
  separate store, `activity.ts`, never inside `WorkspaceState`).
- New component `SnapshotPicker.svelte` (implementation-phase work, not a
  design-phase contract): a name input + save button, a list of
  `listSnapshots()` results each with load/delete buttons, and a
  `baseline` `$state` the component updates after every successful save
  or load. Loading calls `hasUnsavedChanges(current, baseline)` first; if
  true, calls `window.confirm(...)` (matches this codebase's simplest
  native-dialog option — no existing modal component to reuse) and only
  proceeds on confirmation. `loadSnapshot`'s result is written directly
  into `workspaceStore` via `.set(...)` (already normalized by T-0005-1).
  Delete only removes the snapshot from storage/list — it never touches
  `baseline` or the live store (AC5 of the epic).
- Rendered in `src/routes/+page.svelte`, alongside `ChartToolbar`,
  passed the shared `workspaceStore`.

### Contracts to introduce

- `hasUnsavedChanges(current: WorkspaceState, baseline: WorkspaceState | null): boolean`
  → `src/lib/workspace/snapshotGuard.ts` — the AC3 dirty-check, kept out
  of the component so it's unit-testable without mounting Svelte.

### References

- `src/lib/workspace/snapshots.ts` (T-0005-1) — `saveSnapshot`,
  `loadSnapshot`, `deleteSnapshot`, `listSnapshots`, `SnapshotSummary`.
- `src/lib/workspace/store.ts` — `emptyWorkspace`, `workspaceStore`.
- `src/lib/workspace/ChartToolbar.svelte` — sibling component pattern
  (props, `$state`, busy/error handling, scoped `<style>`).
- `src/routes/+page.svelte` — where the picker is wired in.

## Out of Scope

The persistence functions themselves (T-0005-1). Any change to the live
workspace's own reload persistence behavior.
