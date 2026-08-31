import { describe, expect, it } from 'vitest';
import type { WorkspaceState } from '../webmcp/types';
import { deleteSnapshot, listSnapshots, loadSnapshot, saveSnapshot } from './snapshots';

// In-memory Storage so each test gets an isolated backing store, matching
// store.test.ts's memoryStorage() pattern rather than depending on jsdom's
// shared global localStorage.
function memoryStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key) => (data.has(key) ? (data.get(key) ?? null) : null),
		setItem: (key, value) => void data.set(key, String(value)),
		removeItem: (key) => void data.delete(key),
		clear: () => data.clear(),
		key: (index) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	};
}

function emptyWorkspace(): WorkspaceState {
	return { studies: [], setups: [], instanceSets: [], panels: [], focus: null };
}

describe('save a named snapshot', () => {
	it('stores a snapshot separately from the live workspace and it appears in the list', () => {
		expect.fail('not implemented');
	});

	it('overwrites the existing snapshot when saved again under the same name', () => {
		expect.fail('not implemented');
	});
});

describe('recall a snapshot', () => {
	it('returns the saved WorkspaceState for a known name', () => {
		expect.fail('not implemented');
	});

	it('returns null for a name with no saved snapshot', () => {
		expect.fail('not implemented');
	});

	it('normalizes a recalled snapshot the same way a reloaded live workspace is normalized', () => {
		// AC6: malformed/foreign snapshot data must not crash the app -- covers
		// the same duplicate-id case as store.test.ts's normalizeWorkspace test.
		expect.fail('not implemented');
	});
});

describe('delete a snapshot', () => {
	it('removes the snapshot so it no longer appears in the list', () => {
		expect.fail('not implemented');
	});

	it('is a no-op when the name has no saved snapshot', () => {
		expect.fail('not implemented');
	});
});

describe('browse snapshots', () => {
	it('returns an empty list when nothing has been saved', () => {
		expect.fail('not implemented');
	});

	it('lists every saved snapshot name and savedAt', () => {
		expect.fail('not implemented');
	});
});

describe('isolation from the live workspace', () => {
	it('never reads or writes the live workspace persistence key', () => {
		// AC5: save/load/delete must not touch webmcp-workspace-state.
		expect.fail('not implemented');
	});
});
