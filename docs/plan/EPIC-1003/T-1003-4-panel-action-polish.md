# T-1003-4: Panel action polish — stuck-panel close, focus-state sync

**Epic:** EPIC-1003
**Status:** Open

## Goal

Epic review of EPIC-1003 surfaced two small, non-blocking gaps (a third,
about the histogram toggle's `aria-expanded`, no longer applies — that
feature was removed entirely on 2026-08-31):

1. `GridPanel.svelte`'s `missingData` guard hides the entire panel section —
   including the close button — when `resolveBackendInstanceSet` returns
   null, so a panel stuck in a missing-data state can't be dismissed by the
   user.
2. `+page.svelte`'s local `focusedView` state and `workspaceStore`'s `focus`
   field are two sources of truth for the same concept, kept in sync only
   because every current code path that sets one also sets the other.
   Closing the focused panel nulls `workspaceStore.focus` but not
   `focusedView` directly (currently harmless because of how the render
   guard is written, but a latent coupling worth removing).

## Acceptance criteria

- A panel in the `missingData` state can still be closed (the close control
  is not hidden by the same guard that hides the data-dependent content).
- `+page.svelte` derives or resets `focusedView` from `$workspaceStore.focus`
  directly (e.g. via an effect) rather than relying on every mutation path
  to keep both in sync manually.
