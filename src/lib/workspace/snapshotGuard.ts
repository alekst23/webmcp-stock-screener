// AC3 of docs/design/workspace-snapshots/spec.md's "Recall a snapshot"
// scenario: switching to a different snapshot must warn when the live
// workspace has changed since the last save-into or load-from a snapshot.
// Kept as a plain function (not inline in SnapshotPicker.svelte) so the
// dirty-check is unit-testable without mounting a component, matching how
// this codebase tests logic (store.ts, apiEngine.ts) separately from thin
// Svelte wiring (ChartToolbar.svelte, ActivityFeed.svelte have no tests).
import type { WorkspaceState } from '../webmcp/types';

const EMPTY_WORKSPACE: WorkspaceState = {
	studies: [],
	setups: [],
	instanceSets: [],
	panels: [],
	focus: null
};

// baseline is null before any save/load has happened this session, treated
// as an empty workspace -- WorkspaceState has no non-serializable fields,
// so structural (JSON) equality is a safe/complete comparison.
export function hasUnsavedChanges(
	current: WorkspaceState,
	baseline: WorkspaceState | null
): boolean {
	return JSON.stringify(current) !== JSON.stringify(baseline ?? EMPTY_WORKSPACE);
}
