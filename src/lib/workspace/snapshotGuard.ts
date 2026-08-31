// AC3 of docs/design/workspace-snapshots/spec.md's "Recall a snapshot"
// scenario: switching to a different snapshot must warn when the live
// workspace has changed since the last save-into or load-from a snapshot.
// Kept as a plain function (not inline in SnapshotPicker.svelte) so the
// dirty-check is unit-testable without mounting a component, matching how
// this codebase tests logic (store.ts, apiEngine.ts) separately from thin
// Svelte wiring (ChartToolbar.svelte, ActivityFeed.svelte have no tests).
import type { WorkspaceState } from '../webmcp/types';

// STUB: contract only, filled in during the ticket's implementation phase.
// baseline is null before any save/load has happened this session.
export function hasUnsavedChanges(
	_current: WorkspaceState,
	_baseline: WorkspaceState | null
): boolean {
	throw new Error('not implemented');
}
