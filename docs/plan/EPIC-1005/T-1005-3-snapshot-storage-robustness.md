# T-1005-3: Handle localStorage write failures and reserved-name collisions

**Epic:** EPIC-1005
**Status:** Open

## Goal

Epic review of EPIC-1005 found `snapshots.ts`'s `writeIndex` (used by both
`saveSnapshot` and `deleteSnapshot`) has no try/catch around
`storage.setItem`. A `QuotaExceededError` — plausible since this feature
accumulates multiple full-`WorkspaceState` blobs under one key — throws
uncaught out of `SnapshotPicker.svelte`'s `save()` handler, skipping the
`baseline`/`name` reset and giving the user no feedback: the button appears
to do nothing and the snapshot silently doesn't exist. Separately, a snapshot
named `"__proto__"` triggers the index object's special prototype setter
instead of creating an own property, so the save silently no-ops with no
error and no persisted data — a real, if narrow, footgun with no guard
today. `snapshots.ts` also re-serializes the *entire* index on every single
save/delete rather than a delta, which compounds the quota risk as
snapshots accumulate.

## Acceptance criteria

- A `localStorage.setItem` failure in `writeIndex` is caught and surfaced as
  a user-visible error in `SnapshotPicker.svelte` (matching the existing
  empty-name error pattern), not an uncaught exception.
- Saving under a reserved/prototype-polluting name (e.g. `__proto__`,
  `constructor`, `prototype`) either works correctly or is rejected with a
  clear error — not a silent no-op.
