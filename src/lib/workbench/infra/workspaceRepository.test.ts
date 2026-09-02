import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type WorkspaceDocument } from '../domain/workspace';
import { memoryStorage } from '../testSupport';
import { createLocalWorkspaceRepository } from './workspaceRepository';

function doc(id: string, revision = 1): WorkspaceDocument {
	return { ...emptyWorkspace(id, `Workspace ${id}`, '2026-01-01T00:00:00.000Z'), revision };
}

describe('createLocalWorkspaceRepository', () => {
	it('stores and fetches a workspace by id', () => {
		const repo = createLocalWorkspaceRepository(memoryStorage());
		repo.put(doc('workspace_1'));
		expect(repo.get('workspace_1')).toEqual(doc('workspace_1'));
	});

	it('reports a missing workspace as absent rather than raising', () => {
		const repo = createLocalWorkspaceRepository(memoryStorage());
		expect(repo.get('workspace_404')).toBeNull();
	});

	it('replaces an existing document with the same id rather than merging', () => {
		const repo = createLocalWorkspaceRepository(memoryStorage());
		repo.put(doc('workspace_1', 1));
		repo.put(doc('workspace_1', 2));
		expect(repo.get('workspace_1')?.revision).toBe(2);
		expect(repo.list()).toHaveLength(1);
	});

	it('lists workspace summaries', () => {
		const repo = createLocalWorkspaceRepository(memoryStorage());
		repo.put(doc('workspace_1'));
		repo.put(doc('workspace_2'));
		const summaries = repo
			.list()
			.map((s) => s.id)
			.sort();
		expect(summaries).toEqual(['workspace_1', 'workspace_2']);
	});

	it('tracks exactly one active workspace, absent when none is set', () => {
		const repo = createLocalWorkspaceRepository(memoryStorage());
		expect(repo.getActiveId()).toBeNull();
		repo.setActiveId('workspace_1');
		expect(repo.getActiveId()).toBe('workspace_1');
		repo.setActiveId('workspace_2');
		expect(repo.getActiveId()).toBe('workspace_2');
	});

	it('stores and lists revision snapshots in revision order', () => {
		const repo = createLocalWorkspaceRepository(memoryStorage());
		repo.putRevision({
			workspaceId: 'workspace_1',
			revision: 2,
			name: null,
			savedAt: '2026-01-02T00:00:00.000Z',
			document: doc('workspace_1', 2)
		});
		repo.putRevision({
			workspaceId: 'workspace_1',
			revision: 1,
			name: null,
			savedAt: '2026-01-01T00:00:00.000Z',
			document: doc('workspace_1', 1)
		});
		const revisions = repo.listRevisions('workspace_1');
		expect(revisions.map((r) => r.revision)).toEqual([1, 2]);
	});

	it('fetches an individual revision by number', () => {
		const repo = createLocalWorkspaceRepository(memoryStorage());
		repo.putRevision({
			workspaceId: 'workspace_1',
			revision: 5,
			name: null,
			savedAt: '2026-01-01T00:00:00.000Z',
			document: doc('workspace_1', 5)
		});
		expect(repo.getRevision('workspace_1', 5)?.revision).toBe(5);
		expect(repo.getRevision('workspace_1', 6)).toBeNull();
	});

	it('replaces a snapshot stored for a revision that already has one', () => {
		const repo = createLocalWorkspaceRepository(memoryStorage());
		repo.putRevision({
			workspaceId: 'workspace_1',
			revision: 1,
			name: null,
			savedAt: '2026-01-01T00:00:00.000Z',
			document: doc('workspace_1', 1)
		});
		repo.putRevision({
			workspaceId: 'workspace_1',
			revision: 1,
			name: 'renamed',
			savedAt: '2026-01-02T00:00:00.000Z',
			document: doc('workspace_1', 1)
		});
		const revisions = repo.listRevisions('workspace_1');
		expect(revisions).toHaveLength(1);
		expect(revisions[0]?.name).toBe('renamed');
	});

	it('prunes unnamed revisions to the 100 most recent, never pruning a named one', () => {
		const repo = createLocalWorkspaceRepository(memoryStorage());
		repo.putRevision({
			workspaceId: 'workspace_1',
			revision: 0,
			name: 'keep-me-forever',
			savedAt: '2026-01-01T00:00:00.000Z',
			document: doc('workspace_1', 0)
		});
		for (let revision = 1; revision <= 105; revision++) {
			repo.putRevision({
				workspaceId: 'workspace_1',
				revision,
				name: null,
				savedAt: '2026-01-01T00:00:00.000Z',
				document: doc('workspace_1', revision)
			});
		}
		const revisions = repo.listRevisions('workspace_1');
		expect(revisions.some((r) => r.name === 'keep-me-forever')).toBe(true);
		expect(revisions.filter((r) => r.name === null)).toHaveLength(100);
		expect(revisions.some((r) => r.revision === 1)).toBe(false);
		expect(revisions.some((r) => r.revision === 105)).toBe(true);
	});

	it('does not throw and yields empty/normalized results on corrupt storage', () => {
		const storage = memoryStorage();
		storage.setItem('workbench-workspaces', 'not json{{{');
		storage.setItem('workbench-revisions', 'also not json');
		const repo = createLocalWorkspaceRepository(storage);
		expect(() => repo.list()).not.toThrow();
		expect(repo.list()).toEqual([]);
		expect(repo.listRevisions('workspace_1')).toEqual([]);
	});

	it('does not corrupt previously stored data when a write fails', () => {
		const storage = memoryStorage();
		const repo = createLocalWorkspaceRepository(storage);
		repo.put(doc('workspace_1', 1));
		const failingStorage: Storage = {
			...storage,
			setItem: () => {
				throw new Error('quota exceeded');
			}
		};
		const failingRepo = createLocalWorkspaceRepository(failingStorage);
		expect(() => failingRepo.put(doc('workspace_1', 2))).not.toThrow();
		expect(repo.get('workspace_1')?.revision).toBe(1);
	});

	it('uses storage keys that do not overlap the shipping workspace/snapshot keys', () => {
		const storage = memoryStorage();
		const repo = createLocalWorkspaceRepository(storage);
		repo.put(doc('workspace_1'));
		repo.setActiveId('workspace_1');
		expect(storage.getItem('webmcp-workspace-state')).toBeNull();
		expect(storage.getItem('webmcp-workspace-snapshots')).toBeNull();
	});

	it('runs a hand-edited document through T-1006-1 normalization on read', () => {
		const storage = memoryStorage();
		storage.setItem(
			'workbench-workspaces',
			JSON.stringify({ workspace_1: { id: 'workspace_1', panels: 'not-an-array' } })
		);
		const repo = createLocalWorkspaceRepository(storage);
		expect(repo.get('workspace_1')?.panels).toEqual([]);
	});
});
