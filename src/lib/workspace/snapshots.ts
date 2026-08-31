// Named workspace snapshots: an additional, separate localStorage store
// alongside store.ts's single live-workspace persistence. Per
// docs/design/workspace-snapshots/spec.md, saving/recalling/deleting a
// snapshot never touches the live workspace's own persisted state
// (webmcp-workspace-state) -- these are explicit, user-triggered actions
// on a distinct store.
import type { WorkspaceState } from '../webmcp/types';
import { normalizeWorkspace } from './store';

const SNAPSHOTS_KEY = 'webmcp-workspace-snapshots';

export interface SnapshotSummary {
	name: string;
	savedAt: string;
}

export interface SnapshotRecord extends SnapshotSummary {
	state: WorkspaceState;
}

type SnapshotIndex = Record<string, SnapshotRecord>;

// STUB: contract only, filled in during the ticket's implementation phase.
export function saveSnapshot(_name: string, _state: WorkspaceState, _storage?: Storage): void {
	throw new Error('not implemented');
}

// STUB: contract only, filled in during the ticket's implementation phase.
// Returns null when no snapshot exists under that name.
export function loadSnapshot(_name: string, _storage?: Storage): WorkspaceState | null {
	throw new Error('not implemented');
}

// STUB: contract only, filled in during the ticket's implementation phase.
export function deleteSnapshot(_name: string, _storage?: Storage): void {
	throw new Error('not implemented');
}

// STUB: contract only, filled in during the ticket's implementation phase.
export function listSnapshots(_storage?: Storage): SnapshotSummary[] {
	throw new Error('not implemented');
}
