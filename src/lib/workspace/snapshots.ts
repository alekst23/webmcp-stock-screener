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

// Storage is an explicit parameter (default: real localStorage), matching
// store.ts's createWorkspaceStore pattern, so tests use an isolated
// in-memory Storage instead of a shared DOM global.
function backingStorage(storage?: Storage): Storage | undefined {
	return storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
}

function readIndex(storage: Storage | undefined): SnapshotIndex {
	if (!storage) {
		return {};
	}
	const raw = storage.getItem(SNAPSHOTS_KEY);
	if (!raw) {
		return {};
	}
	try {
		return JSON.parse(raw) as SnapshotIndex;
	} catch {
		// Corrupted or foreign data in the slot must not crash the app, same
		// resilience guarantee store.ts's readPersisted gives the live workspace.
		return {};
	}
}

function writeIndex(storage: Storage | undefined, index: SnapshotIndex): void {
	storage?.setItem(SNAPSHOTS_KEY, JSON.stringify(index));
}

export function saveSnapshot(name: string, state: WorkspaceState, storage?: Storage): void {
	const backing = backingStorage(storage);
	const index = readIndex(backing);
	index[name] = { name, savedAt: new Date().toISOString(), state };
	writeIndex(backing, index);
}

// Runs the recalled state through store.ts's normalizeWorkspace so a
// corrupted/foreign snapshot entry can't crash the app (AC6) -- the same
// resilience the live workspace already gets on reload.
export function loadSnapshot(name: string, storage?: Storage): WorkspaceState | null {
	const record = readIndex(backingStorage(storage))[name];
	return record ? normalizeWorkspace(record.state) : null;
}

export function deleteSnapshot(name: string, storage?: Storage): void {
	const backing = backingStorage(storage);
	const index = readIndex(backing);
	delete index[name];
	writeIndex(backing, index);
}

export function listSnapshots(storage?: Storage): SnapshotSummary[] {
	return Object.values(readIndex(backingStorage(storage))).map(({ name, savedAt }) => ({
		name,
		savedAt
	}));
}
