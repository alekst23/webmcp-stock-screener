import { beforeEach, describe, expect, it } from 'vitest';
import { IdempotencyConflictError, RevisionConflictError } from '../domain/errors';
import { createIdSequencer } from '../domain/ids';
import type { Clock } from '../domain/ports';
import { emptyWorkspace } from '../domain/workspace';
import { createLocalWorkspaceRepository } from '../infra/workspaceRepository';
import { memoryStorage } from '../testSupport';
import { createIdempotencyCache } from './idempotency';
import { createRevisionService } from './revisionService';
import type { MutationDraft, RevisionService } from './revisionService';

function fixedClock(iso: string): Clock {
	return { now: () => iso };
}

describe('createRevisionService', () => {
	let repository: ReturnType<typeof createLocalWorkspaceRepository>;
	let service: RevisionService;

	beforeEach(() => {
		repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z'));
		service = createRevisionService({
			repository,
			clock: fixedClock('2026-01-02T00:00:00.000Z'),
			ids: createIdSequencer(),
			idempotency: createIdempotencyCache()
		});
	});

	function applyDraft(overrides: Partial<MutationDraft> = {}) {
		return service.commit({
			workspaceId: 'workspace_1',
			context: { expectedRevision: 1, actor: 'agent' },
			operationKind: 'test.op',
			requestInput: { n: 1 },
			mutate: (doc) => ({
				document: { ...doc, activeSymbol: 'AAPL' },
				affectedIds: ['workspace_1'],
				diffSummary: 'Set active symbol to AAPL.',
				...overrides
			})
		});
	}

	it('applies a matching expected_revision and reports a revision exactly one higher', () => {
		const envelope = applyDraft();
		expect(envelope.newRevision).toBe(2);
		expect(repository.get('workspace_1')?.revision).toBe(2);
	});

	it('lands a brand-new, never-before-stored workspace at revision 1, not 2', () => {
		const envelope = service.commit({
			workspaceId: 'workspace_new',
			context: { actor: 'agent' },
			mutate: (doc) => ({
				document: emptyWorkspace('workspace_new', 'New', '2026-01-02T00:00:00.000Z'),
				affectedIds: [doc.id],
				diffSummary: 'Created workspace.'
			})
		});
		expect(envelope.newRevision).toBe(1);
		expect(repository.get('workspace_new')?.revision).toBe(1);
	});

	it('refuses a mismatched expected_revision without changing stored state', () => {
		const before = repository.get('workspace_1');
		expect(() =>
			service.commit({
				workspaceId: 'workspace_1',
				context: { expectedRevision: 99, actor: 'agent' },
				mutate: (doc) => ({ document: doc, affectedIds: [], diffSummary: 'noop' })
			})
		).toThrow(RevisionConflictError);
		expect(repository.get('workspace_1')).toEqual(before);
	});

	it('reports both the expected and actual revision in the conflict error', () => {
		try {
			service.commit({
				workspaceId: 'workspace_1',
				context: { expectedRevision: 99, actor: 'agent' },
				mutate: (doc) => ({ document: doc, affectedIds: [], diffSummary: 'noop' })
			});
			throw new Error('expected commit to throw');
		} catch (err) {
			expect(err).toBeInstanceOf(RevisionConflictError);
			expect((err as RevisionConflictError).expectedRevision).toBe(99);
			expect((err as RevisionConflictError).currentRevision).toBe(1);
		}
	});

	it('applies a mutation omitting expected_revision and warns about the missing check', () => {
		const envelope = service.commit({
			workspaceId: 'workspace_1',
			context: { actor: 'agent' },
			mutate: (doc) => ({ document: doc, affectedIds: [], diffSummary: 'noop' })
		});
		expect(envelope.warnings).toContain(
			'Applied without expected_revision: no concurrency check was performed.'
		);
	});

	it('replays the originally recorded envelope for a repeated idempotency key', () => {
		const context = { expectedRevision: 1, idempotencyKey: 'key-1', actor: 'agent' as const };
		const first = service.commit({
			workspaceId: 'workspace_1',
			context,
			operationKind: 'test.op',
			requestInput: { n: 1 },
			mutate: (doc) => ({
				document: { ...doc, activeSymbol: 'AAPL' },
				affectedIds: [],
				diffSummary: 'x'
			})
		});
		const second = service.commit({
			workspaceId: 'workspace_1',
			context,
			operationKind: 'test.op',
			requestInput: { n: 1 },
			mutate: (doc) => ({
				document: { ...doc, activeSymbol: 'MSFT' },
				affectedIds: [],
				diffSummary: 'y'
			})
		});
		expect(second).toEqual(first);
		expect(repository.get('workspace_1')?.revision).toBe(2); // did not advance again
	});

	it('refuses a reused idempotency key for a materially different request', () => {
		const key = 'key-2';
		service.commit({
			workspaceId: 'workspace_1',
			context: { expectedRevision: 1, idempotencyKey: key, actor: 'agent' },
			operationKind: 'test.op',
			requestInput: { n: 1 },
			mutate: (doc) => ({ document: doc, affectedIds: [], diffSummary: 'x' })
		});
		expect(() =>
			service.commit({
				workspaceId: 'workspace_1',
				context: { expectedRevision: 2, idempotencyKey: key, actor: 'agent' },
				operationKind: 'test.op',
				requestInput: { n: 2 },
				mutate: (doc) => ({ document: doc, affectedIds: [], diffSummary: 'y' })
			})
		).toThrow(IdempotencyConflictError);
	});

	it('leaves stored state unchanged and records nothing in the idempotency cache when mutate throws', () => {
		const before = repository.get('workspace_1');
		expect(() =>
			service.commit({
				workspaceId: 'workspace_1',
				context: { expectedRevision: 1, idempotencyKey: 'key-3', actor: 'agent' },
				mutate: () => {
					throw new Error('boom');
				}
			})
		).toThrow('boom');
		expect(repository.get('workspace_1')).toEqual(before);

		// A retry with the same key must be treated as a fresh request, not a
		// crash and not a replay of a change that never happened.
		const retry = service.commit({
			workspaceId: 'workspace_1',
			context: { expectedRevision: 1, idempotencyKey: 'key-3', actor: 'agent' },
			mutate: (doc) => ({ document: doc, affectedIds: [], diffSummary: 'ok now' })
		});
		expect(retry.diffSummary).toBe('ok now');
	});

	it('stores a revision snapshot and updates updatedAt on every successful mutation', () => {
		applyDraft();
		expect(repository.getRevision('workspace_1', 2)).not.toBeNull();
		expect(repository.get('workspace_1')?.updatedAt).toBe('2026-01-02T00:00:00.000Z');
	});

	it('mints a change id and an undo token when an inverse is supplied', () => {
		const envelope = applyDraft({
			inverse: {
				document: emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z'),
				affectedIds: [],
				diffSummary: 'revert'
			}
		});
		expect(envelope.changeId).toMatch(/^change_/);
		expect(envelope.undoToken).toMatch(/^undo_/);
	});

	it('reports a change as not undoable when no inverse is supplied', () => {
		const envelope = applyDraft();
		expect(envelope.undoToken).toBeNull();
	});
});
