// Shared workspace store: the single source of truth for the research
// session, per docs/design/pattern-research-workbench/spec.md's "Shared
// workspace & collaboration" scenarios. Both the human-facing view
// (src/routes/+page.svelte) and the dev control surface (src/routes/dev)
// read and write through this same store, so a manual tool invocation is
// visible in the same place an agent-driven one would be.
import { writable, type Writable } from 'svelte/store';
import type { InstanceEvent, WorkspaceState } from '../webmcp/types';

const STORAGE_KEY = 'webmcp-workspace-state';

function emptyWorkspace(): WorkspaceState {
	return { studies: [], setups: [], instanceSets: [], panels: [], focus: null };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
	const byId = new Map<string, T>();
	for (const item of items) {
		byId.set(item.id, item);
	}
	return [...byId.values()];
}

function normalizeWorkspace(state: WorkspaceState): WorkspaceState {
	return {
		studies: uniqueById(state.studies ?? []),
		setups: uniqueById(state.setups ?? []),
		instanceSets: uniqueById(state.instanceSets ?? []),
		panels: uniqueById(state.panels ?? []),
		focus: state.focus ?? null
	};
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
		return normalizeWorkspace(JSON.parse(raw) as WorkspaceState);
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

// The human-driven half of instance focus (AC2/AC5): clicking an instance
// in the grid calls this directly against the store, with no WebMCP tool
// call involved -- there's no tool for a human clicking their own UI.
// Mirrors apiEngine.ts's focusInstance, which only ever moves
// `focusedInstance`; this only ever moves `selected`, so an agent zooming
// in (focusInstance) and a human picking a grid instance never clobber each
// other's half of FocusState.
export function selectInstance(
	store: Writable<WorkspaceState>,
	panelId: string,
	instance: InstanceEvent
): void {
	store.update((ws) => ({
		...ws,
		focus: {
			panelId,
			selected: [instance],
			focusedInstance: ws.focus?.focusedInstance ?? null
		}
	}));
}

// T-1003-2 contract stub -- see docs/plan/EPIC-1003/T-1003-2-individual-panel-close.md's
// Solution Approach. Not yet implemented; ticket-tests stubs in store.test.ts
// assert against this signature.
export function removePanel(_store: Writable<WorkspaceState>, _panelId: string): void {
	throw new Error('removePanel: not implemented');
}
