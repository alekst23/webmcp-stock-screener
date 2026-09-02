import { beforeEach, describe, expect, it } from 'vitest';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { OperationValidationError, RevisionConflictError } from '../../domain/errors';
import { emptyWorkspace } from '../../domain/workspace';
import { createChangeHistory, undoChange } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { applyOperations, createOperationRegistry } from '../../application/operationRegistry';
import type { OperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import type { RevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { createScreener } from '../../../screener/definition';
import { writeScreener } from '../../../screener/state';
import { readWatchlist, writeWatchlist } from '../domain/watchlist';
import type { Watchlist } from '../domain/watchlist';
import { WATCHLIST_UPSERT_KIND } from './upsertWatchlist';
import type { UpsertWatchlistInput } from './upsertWatchlist';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

describe('watchlist.upsert operation', () => {
	let repository: ReturnType<typeof createLocalWorkspaceRepository>;
	let revisions: RevisionService;
	let history: ReturnType<typeof createChangeHistory>;
	let registry: OperationRegistry;
	let ids: ReturnType<typeof createIdSequencer>;

	beforeEach(() => {
		repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(emptyWorkspace(WORKSPACE_ID, 'Research', NOW));
		repository.setActiveId(WORKSPACE_ID);
		ids = createIdSequencer();
		const idempotency = createIdempotencyCache();
		revisions = createRevisionService({ repository, clock, ids, idempotency });
		history = createChangeHistory();
		registry = createOperationRegistry();
	});

	function upsert(input: UpsertWatchlistInput) {
		return applyOperations(
			[{ kind: WATCHLIST_UPSERT_KIND, input }],
			{ actor: 'agent' },
			{ registry, workspaceId: WORKSPACE_ID, history, revisionService: revisions, clock, ids }
		);
	}

	function doc() {
		const d = repository.get(WORKSPACE_ID);
		if (!d) throw new Error('workspace vanished');
		return d;
	}

	// The operation only exists once registered; every sibling tool test does
	// this via buildXTool's ensure* call, but this test exercises the
	// operation directly, so it registers it itself.
	beforeEach(async () => {
		const { ensureUpsertWatchlistOperation } = await import('./upsertWatchlist');
		ensureUpsertWatchlistOperation(registry, { clock });
	});

	it('test_creates_a_static_watchlist_with_a_stable_id_and_given_instruments', () => {
		const envelope = upsert({
			name: 'Momentum',
			kind: 'static',
			instrumentIds: ['inst_1', 'inst_2']
		});
		const watchlistId = envelope.affectedIds[0]!;
		const watchlist = readWatchlist(doc(), watchlistId) as Watchlist;
		expect(watchlist.kind).toBe('static');
		expect(watchlist.name).toBe('Momentum');
		expect(watchlist.kind === 'static' && watchlist.members.map((m) => m.instrumentId)).toEqual([
			'inst_1',
			'inst_2'
		]);
	});

	it('test_creates_a_dynamic_watchlist_stating_its_defining_revision', () => {
		repository.put(
			writeScreener(doc(), {
				...createScreener(createIdSequencer(), WORKSPACE_ID, 'S'),
				screenerId: 'screener_1',
				revision: 4
			})
		);
		const envelope = upsert({ name: 'Dyn', kind: 'dynamic', screenerId: 'screener_1' });
		const watchlist = readWatchlist(doc(), envelope.affectedIds[0]!) as Watchlist;
		expect(watchlist.kind).toBe('dynamic');
		expect(watchlist.kind === 'dynamic' && watchlist.screenerId).toBe('screener_1');
		expect(watchlist.kind === 'dynamic' && watchlist.screenerRevision).toBe(4);
	});

	it('test_dynamic_watchlist_uses_an_explicit_screener_revision_when_given', () => {
		repository.put(
			writeScreener(doc(), {
				...createScreener(createIdSequencer(), WORKSPACE_ID, 'S'),
				screenerId: 'screener_1',
				revision: 4
			})
		);
		const envelope = upsert({
			name: 'Dyn',
			kind: 'dynamic',
			screenerId: 'screener_1',
			screenerRevision: 1
		});
		const watchlist = readWatchlist(doc(), envelope.affectedIds[0]!) as Watchlist;
		expect(watchlist.kind === 'dynamic' && watchlist.screenerRevision).toBe(1);
	});

	it('test_rejects_a_dynamic_watchlist_referencing_an_unknown_screener', () => {
		expect(() => upsert({ name: 'Dyn', kind: 'dynamic', screenerId: 'screener_missing' })).toThrow(
			OperationValidationError
		);
	});

	it('test_rejects_creating_without_a_name', () => {
		expect(() => upsert({ kind: 'static', instrumentIds: [] } as UpsertWatchlistInput)).toThrow(
			OperationValidationError
		);
	});

	it('test_updates_an_existing_watchlist_in_place_and_keeps_its_id', () => {
		const created = upsert({ name: 'Momentum', kind: 'static', instrumentIds: ['inst_1'] });
		const watchlistId = created.affectedIds[0]!;
		const updated = upsert({
			watchlistId,
			name: 'Momentum v2',
			kind: 'static',
			instrumentIds: ['inst_1', 'inst_2']
		});
		expect(updated.affectedIds).toEqual([watchlistId]);
		const watchlist = readWatchlist(doc(), watchlistId) as Watchlist;
		expect(watchlist.name).toBe('Momentum v2');
		expect(watchlist.kind === 'static' && watchlist.members.map((m) => m.instrumentId)).toEqual([
			'inst_1',
			'inst_2'
		]);
	});

	it('test_a_repeated_identical_update_does_not_duplicate_the_watchlist', () => {
		const created = upsert({ name: 'Momentum', kind: 'static', instrumentIds: ['inst_1'] });
		const watchlistId = created.affectedIds[0]!;
		upsert({ watchlistId, name: 'Momentum', kind: 'static', instrumentIds: ['inst_1'] });
		upsert({ watchlistId, name: 'Momentum', kind: 'static', instrumentIds: ['inst_1'] });
		const all = Object.keys((doc().extensions.watchlists as Record<string, unknown>) ?? {});
		expect(all).toEqual([watchlistId]);
	});

	it('test_renaming_only_leaves_membership_untouched', () => {
		const created = upsert({
			name: 'Momentum',
			kind: 'static',
			instrumentIds: ['inst_1', 'inst_2']
		});
		const watchlistId = created.affectedIds[0]!;
		upsert({ watchlistId, name: 'Renamed', kind: 'static' });
		const watchlist = readWatchlist(doc(), watchlistId) as Watchlist;
		expect(watchlist.name).toBe('Renamed');
		expect(watchlist.kind === 'static' && watchlist.members.map((m) => m.instrumentId)).toEqual([
			'inst_1',
			'inst_2'
		]);
	});

	it('test_replacing_membership_preserves_the_original_record_for_a_persisting_instrument', () => {
		const created = upsert({ name: 'Momentum', kind: 'static', instrumentIds: ['inst_1'] });
		const watchlistId = created.affectedIds[0]!;
		const before = readWatchlist(doc(), watchlistId);
		const originalMember = before?.kind === 'static' ? before.members[0] : undefined;
		upsert({ watchlistId, kind: 'static', instrumentIds: ['inst_1', 'inst_2'] });
		const after = readWatchlist(doc(), watchlistId);
		const keptMember = after?.kind === 'static' ? after.members[0] : undefined;
		expect(keptMember).toEqual(originalMember);
	});

	it('test_converting_a_dynamic_watchlist_to_static_requires_instrument_ids', () => {
		repository.put(
			writeScreener(doc(), {
				...createScreener(createIdSequencer(), WORKSPACE_ID, 'S'),
				screenerId: 'screener_1'
			})
		);
		const created = upsert({ name: 'Dyn', kind: 'dynamic', screenerId: 'screener_1' });
		const watchlistId = created.affectedIds[0]!;
		expect(() => upsert({ watchlistId, kind: 'static' })).toThrow(OperationValidationError);
	});

	it('test_rejects_making_an_existing_watchlist_dynamic_when_it_would_create_a_cycle', () => {
		let d = doc();
		d = writeScreener(d, {
			...createScreener(createIdSequencer(), WORKSPACE_ID, 'S'),
			screenerId: 'screener_1',
			universe: {
				...createScreener(createIdSequencer(), WORKSPACE_ID, 'S').universe,
				watchlists: ['watchlist_1']
			}
		});
		d = writeWatchlist(d, {
			watchlistId: 'watchlist_1',
			name: 'Static',
			kind: 'static',
			members: [],
			createdAt: NOW,
			updatedAt: NOW
		});
		repository.put(d);
		expect(() =>
			upsert({ watchlistId: 'watchlist_1', kind: 'dynamic', screenerId: 'screener_1' })
		).toThrow(OperationValidationError);
	});

	it('test_rejects_a_stale_expected_revision', () => {
		expect(() =>
			applyOperations(
				[
					{
						kind: WATCHLIST_UPSERT_KIND,
						input: { name: 'X', kind: 'static', instrumentIds: [] } as UpsertWatchlistInput
					}
				],
				{ actor: 'agent', expectedRevision: 99 },
				{ registry, workspaceId: WORKSPACE_ID, history, revisionService: revisions, clock, ids }
			)
		).toThrow(RevisionConflictError);
	});

	it('test_replays_an_idempotency_key_instead_of_creating_a_second_watchlist', () => {
		const input: UpsertWatchlistInput = {
			name: 'Momentum',
			kind: 'static',
			instrumentIds: ['inst_1']
		};
		const call = () =>
			applyOperations(
				[{ kind: WATCHLIST_UPSERT_KIND, input }],
				{ actor: 'agent', idempotencyKey: 'key-1' },
				{ registry, workspaceId: WORKSPACE_ID, history, revisionService: revisions, clock, ids }
			);
		const first = call();
		const replay = call();
		expect(replay.changeId).toBe(first.changeId);
		const all = Object.keys((doc().extensions.watchlists as Record<string, unknown>) ?? {});
		expect(all).toHaveLength(1);
	});

	it('mutation check: idempotency replay guard actually prevents a duplicate (fails without the cache)', () => {
		// Bypasses the idempotency cache the way a broken implementation would
		// (a fresh cache on the second call), proving the "no duplicate" test
		// above is not vacuously true.
		const input: UpsertWatchlistInput = {
			name: 'Momentum',
			kind: 'static',
			instrumentIds: ['inst_1']
		};
		const brokenRevisions = createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		});
		applyOperations(
			[{ kind: WATCHLIST_UPSERT_KIND, input }],
			{ actor: 'agent', idempotencyKey: 'key-1' },
			{ registry, workspaceId: WORKSPACE_ID, history, revisionService: brokenRevisions, clock, ids }
		);
		// A second, independent RevisionService (fresh idempotency cache) has
		// no record of key-1, so it applies the mutation again -- demonstrating
		// that without the shared cache, a second watchlist would be created.
		const secondRevisions = createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		});
		applyOperations(
			[{ kind: WATCHLIST_UPSERT_KIND, input }],
			{ actor: 'agent', idempotencyKey: 'key-1' },
			{ registry, workspaceId: WORKSPACE_ID, history, revisionService: secondRevisions, clock, ids }
		);
		const all = Object.keys((doc().extensions.watchlists as Record<string, unknown>) ?? {});
		expect(all.length, 'without a shared cache, two independent calls create two watchlists').toBe(
			2
		);
	});

	it('test_undo_token_removes_a_newly_created_watchlist', () => {
		const envelope = upsert({ name: 'Momentum', kind: 'static', instrumentIds: ['inst_1'] });
		expect(envelope.undoToken).not.toBeNull();
		undoChange(envelope.undoToken!, {
			history,
			revisionService: revisions,
			clock,
			context: { actor: 'agent' }
		});
		expect(readWatchlist(doc(), envelope.affectedIds[0]!)).toBeNull();
	});

	it('test_undo_token_restores_prior_state_of_an_updated_watchlist', () => {
		const created = upsert({ name: 'Momentum', kind: 'static', instrumentIds: ['inst_1'] });
		const watchlistId = created.affectedIds[0]!;
		const before = readWatchlist(doc(), watchlistId);
		const updated = upsert({
			watchlistId,
			name: 'Renamed',
			kind: 'static',
			instrumentIds: ['inst_2']
		});
		expect(updated.undoToken).not.toBeNull();
		undoChange(updated.undoToken!, {
			history,
			revisionService: revisions,
			clock,
			context: { actor: 'agent' }
		});
		expect(readWatchlist(doc(), watchlistId)).toEqual(before);
	});
});
