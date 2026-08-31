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
		const storage = memoryStorage();

		saveSnapshot('alpha', emptyWorkspace(), storage);

		expect(
			storage.getItem('webmcp-workspace-state'),
			'saving a snapshot must not create the live workspace key'
		).toBeNull();
		const names = listSnapshots(storage).map((s) => s.name);
		expect(names, `snapshot list: ${JSON.stringify(names)}`).toContain('alpha');
	});

	it('overwrites the existing snapshot when saved again under the same name', () => {
		const storage = memoryStorage();
		saveSnapshot(
			'alpha',
			{ ...emptyWorkspace(), studies: [{ id: 's1', name: 'a', expression: 'x' }] },
			storage
		);

		saveSnapshot(
			'alpha',
			{ ...emptyWorkspace(), studies: [{ id: 's2', name: 'b', expression: 'y' }] },
			storage
		);

		const loaded = loadSnapshot('alpha', storage);
		expect(
			loaded?.studies.map((s) => s.id),
			`loaded studies: ${JSON.stringify(loaded?.studies)}`
		).toEqual(['s2']);
		expect(listSnapshots(storage), 'snapshot count after overwrite').toHaveLength(1);
	});
});

describe('recall a snapshot', () => {
	it('returns the saved WorkspaceState for a known name', () => {
		const storage = memoryStorage();
		const state: WorkspaceState = {
			...emptyWorkspace(),
			setups: [{ id: 'setup_1', steps: [{ condition: 'gap_pct > 4' }] }]
		};
		saveSnapshot('alpha', state, storage);

		const loaded = loadSnapshot('alpha', storage);
		expect(loaded?.setups, `loaded: ${JSON.stringify(loaded)}`).toEqual(state.setups);
	});

	it('returns null for a name with no saved snapshot', () => {
		const storage = memoryStorage();

		expect(loadSnapshot('missing', storage)).toBeNull();
	});

	it('normalizes a recalled snapshot the same way a reloaded live workspace is normalized', () => {
		// AC6: malformed/foreign snapshot data must not crash the app -- covers
		// the same duplicate-id case as store.test.ts's normalizeWorkspace test.
		const storage = memoryStorage();
		storage.setItem(
			'webmcp-workspace-snapshots',
			JSON.stringify({
				alpha: {
					name: 'alpha',
					savedAt: '2026-01-01T00:00:00.000Z',
					state: {
						studies: [],
						setups: [],
						instanceSets: [],
						panels: [
							{ id: 'panel_1', kind: 'grid', instanceSetId: 'set_1' },
							{ id: 'panel_1', kind: 'grid', instanceSetId: 'set_2' }
						],
						focus: null
					}
				}
			})
		);

		const loaded = loadSnapshot('alpha', storage);

		expect(loaded?.panels, `loaded panels: ${JSON.stringify(loaded?.panels)}`).toEqual([
			{ id: 'panel_1', kind: 'grid', instanceSetId: 'set_2' }
		]);
	});
});

describe('delete a snapshot', () => {
	it('removes the snapshot so it no longer appears in the list', () => {
		const storage = memoryStorage();
		saveSnapshot('alpha', emptyWorkspace(), storage);

		deleteSnapshot('alpha', storage);

		expect(listSnapshots(storage).map((s) => s.name)).not.toContain('alpha');
	});

	it('is a no-op when the name has no saved snapshot', () => {
		const storage = memoryStorage();

		expect(() => deleteSnapshot('missing', storage)).not.toThrow();
		expect(listSnapshots(storage)).toEqual([]);
	});
});

describe('browse snapshots', () => {
	it('returns an empty list when nothing has been saved', () => {
		const storage = memoryStorage();

		expect(listSnapshots(storage)).toEqual([]);
	});

	it('lists every saved snapshot name and savedAt', () => {
		const storage = memoryStorage();
		saveSnapshot('alpha', emptyWorkspace(), storage);
		saveSnapshot('beta', emptyWorkspace(), storage);

		const summaries = listSnapshots(storage);
		const names = summaries.map((s) => s.name).sort();
		expect(names, `snapshot names: ${JSON.stringify(names)}`).toEqual(['alpha', 'beta']);
		for (const summary of summaries) {
			expect(typeof summary.savedAt, `savedAt for ${summary.name}`).toBe('string');
		}
	});
});

describe('isolation from the live workspace', () => {
	it('never reads or writes the live workspace persistence key', () => {
		// AC5: save/load/delete must not touch webmcp-workspace-state.
		const storage = memoryStorage();
		const liveState = JSON.stringify(emptyWorkspace());
		storage.setItem('webmcp-workspace-state', liveState);

		saveSnapshot('alpha', emptyWorkspace(), storage);
		loadSnapshot('alpha', storage);
		deleteSnapshot('alpha', storage);

		expect(
			storage.getItem('webmcp-workspace-state'),
			'live workspace key must be unchanged by snapshot operations'
		).toBe(liveState);
	});
});
