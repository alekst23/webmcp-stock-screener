# T-0005-4: Add SnapshotPicker test coverage and fix remount-fragile baseline

**Epic:** EPIC-0005
**Status:** Open

## Goal

Epic review of EPIC-0005 found two related gaps in `SnapshotPicker.svelte`:

1. **No test coverage.** Unlike `snapshots.ts`/`snapshotGuard.ts`, there's no
   `SnapshotPicker.test.ts`. The component owns real logic beyond thin
   wiring — the unsaved-changes `confirm()` gate, error-state surfacing, and
   the "delete doesn't affect a live workspace loaded from that snapshot"
   guarantee (currently only asserted in a code comment).
2. **Remount-fragile baseline.** `baseline` is component-local `$state`,
   reset to `null` whenever `SnapshotPicker` unmounts (e.g. navigating to
   `/dev` and back). The next load then compares against an empty workspace
   instead of the real last-save/load point, producing a spurious
   discard-confirmation even when nothing changed. Low data-loss risk
   (defaults to warning, not silent loss) but a real correctness gap in the
   "changes since last save/load" model.

## Acceptance criteria

- `SnapshotPicker.svelte` has test coverage (to whatever extent the
  project's tooling supports component-level testing) for: the
  unsaved-changes confirm gate, an error path (e.g. save failure), and that
  deleting a snapshot the live workspace was loaded from leaves the live
  workspace untouched.
- The unsaved-changes baseline survives a component remount (e.g. persisted
  alongside the workspace state, or derived from the store rather than
  component-local memory), so navigating away and back doesn't produce a
  false discard warning.
