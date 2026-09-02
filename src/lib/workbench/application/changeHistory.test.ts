import { beforeEach, describe, expect, it } from 'vitest';
import { UndoTokenError, OperationValidationError } from '../domain/errors';
import { createIdSequencer } from '../domain/ids';
import type { Clock } from '../domain/ports';
import { emptyWorkspace } from '../domain/workspace';
import { createLocalWorkspaceRepository } from '../infra/workspaceRepository';
import { memoryStorage } from '../testSupport';
import {
	createChangeHistory,
	recordCommit,
	restoreRevision,
	undoChange,
	type ChangeHistory
} from './changeHistory';
import { createIdempotencyCache } from './idempotency';
import { createRevisionService } from './revisionService';
import type { RevisionService } from './revisionService';

function fixedClock(iso: string): Clock {
	return { now: () => iso };
}

describe('createChangeHistory', () => {
	let history: ChangeHistory;

	beforeEach(() => {
		history = createChangeHistory();
	});

	it('lists changes newest-first and never mixes workspaces', () => {
		history.append({
			changeId: 'change_1',
			workspaceId: 'workspace_1',
			revision: 2,
			at: 't1',
			actor: 'agent',
			diffSummary: 'a',
			affectedIds: [],
			undoToken: null,
			undoState: 'none'
		});
		history.append({
			changeId: 'change_2',
			workspaceId: 'workspace_1',
			revision: 3,
			at: 't2',
			actor: 'agent',
			diffSummary: 'b',
			affectedIds: [],
			undoToken: null,
			undoState: 'none'
		});
		history.append({
			changeId: 'change_3',
			workspaceId: 'workspace_2',
			revision: 1,
			at: 't3',
			actor: 'agent',
			diffSummary: 'c',
			affectedIds: [],
			undoToken: null,
			undoState: 'none'
		});
		const list = history.list('workspace_1');
		expect(list.map((r) => r.changeId)).toEqual(['change_2', 'change_1']);
	});

	it('honors an optional limit and a starting point', () => {
		for (let revision = 1; revision <= 5; revision++) {
			history.append({
				changeId: `change_${revision}`,
				workspaceId: 'workspace_1',
				revision,
				at: 't',
				actor: 'agent',
				diffSummary: 'x',
				affectedIds: [],
				undoToken: null,
				undoState: 'none'
			});
		}
		expect(history.list('workspace_1', { limit: 2 }).map((r) => r.revision)).toEqual([5, 4]);
		expect(history.list('workspace_1', { before: 4 }).map((r) => r.revision)).toEqual([3, 2, 1]);
	});

	it('enforces the per-workspace cap even when every record has an undo token', () => {
		// Regression: prune() only evicts records whose undoState isn't
		// 'available', but nothing used to transition an older record away
		// from 'available' once a newer one landed, so a workspace where every
		// change is undoable (the common case) grew without bound.
		for (let revision = 1; revision <= 205; revision++) {
			history.append({
				changeId: `change_${revision}`,
				workspaceId: 'workspace_1',
				revision,
				at: 't',
				actor: 'agent',
				diffSummary: 'x',
				affectedIds: [],
				undoToken: `undo_${revision}`,
				undoState: 'available'
			});
		}
		const records = history.list('workspace_1');
		expect(records.length).toBeLessThanOrEqual(200);
		// The newest record stays genuinely undoable; only it should read 'available'.
		expect(records[0]?.undoState).toBe('available');
		expect(records.slice(1).every((r) => r.undoState === 'superseded')).toBe(true);
	});

	it('finds a record by its undo token and marks it redeemed', () => {
		history.append({
			changeId: 'change_1',
			workspaceId: 'workspace_1',
			revision: 1,
			at: 't',
			actor: 'agent',
			diffSummary: 'x',
			affectedIds: [],
			undoToken: 'undo_1',
			undoState: 'available'
		});
		expect(history.findByUndoToken('undo_1')?.changeId).toBe('change_1');
		history.markRedeemed('undo_1');
		expect(history.findByUndoToken('undo_1')?.undoState).toBe('redeemed');
	});
});

describe('recordCommit + undoChange + restoreRevision', () => {
	let repository: ReturnType<typeof createLocalWorkspaceRepository>;
	let revisionService: RevisionService;
	let history: ChangeHistory;
	let clock: Clock;

	beforeEach(() => {
		repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z'));
		clock = fixedClock('2026-01-02T00:00:00.000Z');
		revisionService = createRevisionService({
			repository,
			clock,
			ids: createIdSequencer(),
			idempotency: createIdempotencyCache()
		});
		history = createChangeHistory();
	});

	function deps() {
		return { history, revisionService, clock, repository };
	}

	function setActiveSymbol(symbol: string) {
		return recordCommit(deps(), {
			workspaceId: 'workspace_1',
			context: { expectedRevision: repository.get('workspace_1')!.revision, actor: 'agent' },
			operationKind: 'test.set_symbol',
			requestInput: { symbol },
			mutate: (doc) => ({
				document: { ...doc, activeSymbol: symbol },
				affectedIds: ['workspace_1'],
				diffSummary: `Set active symbol to ${symbol}.`,
				inverse: {
					document: { ...doc },
					affectedIds: ['workspace_1'],
					diffSummary: `Reverted active symbol to ${doc.activeSymbol ?? 'none'}.`
				}
			})
		});
	}

	it('records every applied change with the required fields', () => {
		const envelope = setActiveSymbol('AAPL');
		const [record] = history.list('workspace_1');
		expect(record).toMatchObject({
			changeId: envelope.changeId,
			workspaceId: 'workspace_1',
			revision: envelope.newRevision,
			actor: 'agent',
			diffSummary: 'Set active symbol to AAPL.',
			affectedIds: ['workspace_1'],
			undoToken: envelope.undoToken,
			undoState: 'available'
		});
	});

	it('does not record a new history entry for an idempotency replay', () => {
		const key = 'replay-key';
		recordCommit(deps(), {
			workspaceId: 'workspace_1',
			context: { expectedRevision: 1, idempotencyKey: key, actor: 'agent' },
			operationKind: 'test.op',
			requestInput: { n: 1 },
			mutate: (doc) => ({ document: doc, affectedIds: [], diffSummary: 'x' })
		});
		recordCommit(deps(), {
			workspaceId: 'workspace_1',
			context: { expectedRevision: 1, idempotencyKey: key, actor: 'agent' },
			operationKind: 'test.op',
			requestInput: { n: 1 },
			mutate: (doc) => ({ document: doc, affectedIds: [], diffSummary: 'x' })
		});
		expect(history.list('workspace_1')).toHaveLength(1);
	});

	it('redeems an undo token, reverses exactly that change, and produces a higher revision', () => {
		const forward = setActiveSymbol('AAPL');
		const undone = undoChange(forward.undoToken!, {
			...deps(),
			context: { actor: 'agent' }
		});
		expect(undone.newRevision).toBe(forward.newRevision + 1);
		expect(repository.get('workspace_1')?.activeSymbol).toBeNull();
	});

	it('records the reversal itself as a new, undoable change', () => {
		const forward = setActiveSymbol('AAPL');
		const undone = undoChange(forward.undoToken!, { ...deps(), context: { actor: 'agent' } });
		expect(undone.changeId).not.toBe(forward.changeId);
		expect(undone.undoToken).not.toBeNull();
		expect(undone.undoToken).not.toBe(forward.undoToken);
	});

	it('lets undoing an undo redo the original change', () => {
		const forward = setActiveSymbol('AAPL');
		const undone = undoChange(forward.undoToken!, { ...deps(), context: { actor: 'agent' } });
		const redone = undoChange(undone.undoToken!, { ...deps(), context: { actor: 'agent' } });
		expect(repository.get('workspace_1')?.activeSymbol).toBe('AAPL');
		expect(redone.newRevision).toBe(undone.newRevision + 1);
	});

	it('refuses to redeem an unknown token', () => {
		expect(() => undoChange('undo_bogus', { ...deps(), context: { actor: 'agent' } })).toThrow(
			UndoTokenError
		);
	});

	it('refuses to redeem the same token twice, leaving the workspace unchanged', () => {
		const forward = setActiveSymbol('AAPL');
		undoChange(forward.undoToken!, { ...deps(), context: { actor: 'agent' } });
		const before = repository.get('workspace_1');
		expect(() =>
			undoChange(forward.undoToken!, { ...deps(), context: { actor: 'agent' } })
		).toThrow(UndoTokenError);
		expect(repository.get('workspace_1')).toEqual(before);
	});

	it('refuses to redeem a token superseded by a later change', () => {
		const first = setActiveSymbol('AAPL');
		setActiveSymbol('MSFT');
		expect(() => undoChange(first.undoToken!, { ...deps(), context: { actor: 'agent' } })).toThrow(
			UndoTokenError
		);
	});

	it('restores a workspace to an earlier revision, moving forward to a new revision', () => {
		setActiveSymbol('AAPL'); // -> revision 2
		setActiveSymbol('MSFT'); // -> revision 3
		const envelope = restoreRevision('workspace_1', 2, { actor: 'agent' }, deps());
		expect(envelope.newRevision).toBe(4);
		expect(repository.get('workspace_1')?.activeSymbol).toBe('AAPL');
	});

	it('records a restore as an ordinary, undoable change without deleting earlier history', () => {
		setActiveSymbol('AAPL');
		setActiveSymbol('MSFT');
		const before = history.list('workspace_1').length;
		const envelope = restoreRevision('workspace_1', 2, { actor: 'agent' }, deps());
		expect(history.list('workspace_1').length).toBe(before + 1);
		expect(envelope.undoToken).not.toBeNull();
	});

	it('refuses to restore a revision with no stored snapshot, leaving the workspace unchanged', () => {
		const before = repository.get('workspace_1');
		expect(() => restoreRevision('workspace_1', 999, { actor: 'agent' }, deps())).toThrow(
			OperationValidationError
		);
		expect(repository.get('workspace_1')).toEqual(before);
	});

	it('reports a change with no inverse as not undoable', () => {
		const envelope = recordCommit(deps(), {
			workspaceId: 'workspace_1',
			context: { expectedRevision: 1, actor: 'agent' },
			mutate: (doc) => ({ document: doc, affectedIds: [], diffSummary: 'no inverse' })
		});
		expect(envelope.undoToken).toBeNull();
		expect(history.list('workspace_1')[0]?.undoState).toBe('none');
	});
});
