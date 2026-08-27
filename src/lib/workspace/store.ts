// Shared workspace store: the single source of truth for the research
// session, per docs/design/pattern-research-workbench/spec.md's "Shared
// workspace & collaboration" scenarios. Both the human-facing view
// (src/routes/+page.svelte) and the dev control surface (src/routes/dev)
// read and write through this same store, so a manual tool invocation is
// visible in the same place an agent-driven one would be.
import { writable, type Writable } from 'svelte/store';
import type { WorkspaceState } from '../webmcp/types';

const STORAGE_KEY = 'webmcp-workspace-state';

function emptyWorkspace(): WorkspaceState {
	return { studies: [], setups: [], instanceSets: [], panels: [], focus: null };
}

function readPersisted(storage: Storage | undefined): WorkspaceState {
	if (!storage) {
		return emptyWorkspace();
	}
	const raw = storage.getItem(STORAGE_KEY);
	if (!raw) {
		return emptyWorkspace();
	}
	try {
		return JSON.parse(raw) as WorkspaceState;
	} catch {
		// Corrupted or foreign data in the slot must not crash the app on load.
		return emptyWorkspace();
	}
}

// Storage is an explicit parameter (default: the real browser localStorage)
// so tests can pass an isolated in-memory Storage instead of depending on a
// DOM environment or leaking state between test cases via one shared global.
export function createWorkspaceStore(storage?: Storage): Writable<WorkspaceState> {
	const backing = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
	const store = writable<WorkspaceState>(readPersisted(backing));
	store.subscribe((state) => {
		backing?.setItem(STORAGE_KEY, JSON.stringify(state));
	});
	return store;
}

// Singleton used by the app's routes — a real browser tab has exactly one
// workspace, backed by that browser's localStorage.
export const workspaceStore = createWorkspaceStore();
