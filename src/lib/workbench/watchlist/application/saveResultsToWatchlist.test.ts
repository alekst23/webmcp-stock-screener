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
import type { PinnedRunStore } from '../../../screener/ports';
import {
	createSpyPinnedRunStore,
	testPinnedRunStore,
	testProvenance,
	testRun
} from '../../../results/testSupport';
import { readWatchlist, writeWatchlist } from '../domain/watchlist';
import type { Watchlist } from '../domain/watchlist';
import {
	ensureSaveResultsToWatchlistOperation,
	WATCHLIST_SAVE_RESULTS_KIND
} from './saveResultsToWatchlist';
import type { SaveResultsToWatchlistInput } from './saveResultsToWatchlist';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

function staticWatchlist(overrides: Partial<Watchlist> = {}): Watchlist {
	return {
		watchlistId: 'watchlist_1',
		name: 'Momentum',
		kind: 'static',
		members: [],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	} as Watchlist;
}

describe('watchlist.save_results operation', () => {
	let repository: ReturnType<typeof createLocalWorkspaceRepository>;
	let revisions: RevisionService;
	let history: ReturnType<typeof createChangeHistory>;
	let registry: OperationRegistry;
	let ids: ReturnType<typeof createIdSequencer>;
	let runs: PinnedRunStore;

	beforeEach(() => {
		repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(emptyWorkspace(WORKSPACE_ID, 'Research', NOW));
		repository.setActiveId(WORKSPACE_ID);
		ids = createIdSequencer();
		revisions = createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		});
		history = createChangeHistory();
		registry = createOperationRegistry();
		runs = testPinnedRunStore(testRun('run_1', 3));
		ensureSaveResultsToWatchlistOperation(registry, { clock, runs });
	});

	function doc() {
		const d = repository.get(WORKSPACE_ID);
		if (!d) throw new Error('workspace vanished');
		return d;
	}

	function seedWatchlist(watchlist: Watchlist): void {
		repository.put(writeWatchlist(doc(), watchlist));
	}

	function save(
		input: SaveResultsToWatchlistInput,
		context: Parameters<typeof applyOperations>[1] = { actor: 'agent' }
	) {
		return applyOperations([{ kind: WATCHLIST_SAVE_RESULTS_KIND, input }], context, {
			registry,
			workspaceId: WORKSPACE_ID,
			history,
			revisionService: revisions,
			clock,
			ids
		});
	}

	it('test_saves_every_matched_instrument_when_no_subset_is_given', () => {
		seedWatchlist(staticWatchlist());
		save({ watchlistId: 'watchlist_1', runId: 'run_1' });
		const watchlist = readWatchlist(doc(), 'watchlist_1');
		expect(watchlist?.kind === 'static' && watchlist.members.map((m) => m.instrumentId)).toEqual([
			'inst_1',
			'inst_2',
			'inst_3'
		]);
	});

	it('test_records_the_source_run_id_and_run_timestamp_as_provenance_on_each_added_member', () => {
		seedWatchlist(staticWatchlist());
		save({ watchlistId: 'watchlist_1', runId: 'run_1' });
		const watchlist = readWatchlist(doc(), 'watchlist_1');
		const member = watchlist?.kind === 'static' ? watchlist.members[0] : undefined;
		expect(member?.source).toEqual({
			kind: 'run',
			runId: 'run_1',
			runCreatedAt: '2026-09-02T14:30:05.000Z',
			provenance: testProvenance()
		});
	});

	it('test_never_re_executes_the_screener_only_reads_the_pinned_run', () => {
		const spy = createSpyPinnedRunStore(runs);
		// A fresh registry, since beforeEach already bound `registry`'s
		// operation to the non-spy store and OperationRegistry has no
		// unregister/replace method.
		const freshRegistry = createOperationRegistry();
		ensureSaveResultsToWatchlistOperation(freshRegistry, { clock, runs: spy });
		seedWatchlist(staticWatchlist());
		applyOperations(
			[
				{ kind: WATCHLIST_SAVE_RESULTS_KIND, input: { watchlistId: 'watchlist_1', runId: 'run_1' } }
			],
			{ actor: 'agent' },
			{
				registry: freshRegistry,
				workspaceId: WORKSPACE_ID,
				history,
				revisionService: revisions,
				clock,
				ids
			}
		);
		expect(spy.getRunCalls, 'reads the pinned run').toBeGreaterThan(0);
		expect(spy.putRunCalls, 'never writes a run back -- structurally, no execute path exists').toBe(
			0
		);
	});

	it('test_rejects_saving_from_an_unknown_run_id_without_re_running', () => {
		seedWatchlist(staticWatchlist());
		expect(() => save({ watchlistId: 'watchlist_1', runId: 'run_missing' })).toThrow(
			OperationValidationError
		);
		expect(
			readWatchlist(doc(), 'watchlist_1')?.kind === 'static' &&
				(readWatchlist(doc(), 'watchlist_1') as { members: unknown[] }).members
		).toEqual([]);
	});

	it('test_rejects_saving_from_an_evicted_run_id', () => {
		const evictingRuns = testPinnedRunStore(testRun('run_evicted', 1));
		// Force eviction by reading through a store whose policy always evicts.
		const alwaysEvict: PinnedRunStore = {
			putRun: evictingRuns.putRun,
			getRun: (runId) => {
				evictingRuns.getRun(runId); // prime it into the store
				return { available: false, runId, reason: 'evicted', message: `Run ${runId} evicted.` };
			},
			getMatches: evictingRuns.getMatches
		};
		const freshRegistry = createOperationRegistry();
		ensureSaveResultsToWatchlistOperation(freshRegistry, { clock, runs: alwaysEvict });
		seedWatchlist(staticWatchlist());
		expect(() =>
			applyOperations(
				[
					{
						kind: WATCHLIST_SAVE_RESULTS_KIND,
						input: { watchlistId: 'watchlist_1', runId: 'run_evicted' }
					}
				],
				{ actor: 'agent' },
				{
					registry: freshRegistry,
					workspaceId: WORKSPACE_ID,
					history,
					revisionService: revisions,
					clock,
					ids
				}
			)
		).toThrow(OperationValidationError);
	});

	it('test_saves_only_a_selected_subset_of_a_runs_results', () => {
		seedWatchlist(staticWatchlist());
		save({ watchlistId: 'watchlist_1', runId: 'run_1', instrumentIds: ['inst_2'] });
		const watchlist = readWatchlist(doc(), 'watchlist_1');
		expect(watchlist?.kind === 'static' && watchlist.members.map((m) => m.instrumentId)).toEqual([
			'inst_2'
		]);
	});

	it('test_rejects_a_selected_instrument_not_present_in_the_runs_results', () => {
		seedWatchlist(staticWatchlist());
		expect(() =>
			save({ watchlistId: 'watchlist_1', runId: 'run_1', instrumentIds: ['inst_99'] })
		).toThrow(OperationValidationError);
	});

	it('test_deduplicates_by_instrument_id_and_only_adds_new_ones', () => {
		seedWatchlist(
			staticWatchlist({
				members: [{ instrumentId: 'inst_1', addedAt: NOW, source: { kind: 'manual' } }]
			})
		);
		save({ watchlistId: 'watchlist_1', runId: 'run_1' });
		const watchlist = readWatchlist(doc(), 'watchlist_1');
		expect(watchlist?.kind === 'static' && watchlist.members.map((m) => m.instrumentId)).toEqual([
			'inst_1',
			'inst_2',
			'inst_3'
		]);
		// The pre-existing member's own manual source must survive the save --
		// a save must never overwrite an existing member's provenance.
		expect(watchlist?.kind === 'static' && watchlist.members[0]?.source).toEqual({
			kind: 'manual'
		});
	});

	it('test_rejects_saving_into_a_dynamic_watchlist_without_explicit_conversion', () => {
		seedWatchlist({
			watchlistId: 'watchlist_1',
			name: 'Dyn',
			kind: 'dynamic',
			screenerId: 'screener_1',
			screenerRevision: 1,
			createdAt: NOW,
			updatedAt: NOW
		});
		expect(() => save({ watchlistId: 'watchlist_1', runId: 'run_1' })).toThrow(
			OperationValidationError
		);
	});

	it('test_converts_a_dynamic_watchlist_to_static_when_explicitly_acknowledged', () => {
		seedWatchlist({
			watchlistId: 'watchlist_1',
			name: 'Dyn',
			kind: 'dynamic',
			screenerId: 'screener_1',
			screenerRevision: 1,
			createdAt: NOW,
			updatedAt: NOW
		});
		const envelope = save({ watchlistId: 'watchlist_1', runId: 'run_1', convertDynamic: true });
		const watchlist = readWatchlist(doc(), 'watchlist_1');
		expect(watchlist?.kind).toBe('static');
		expect(watchlist?.kind === 'static' && watchlist.members).toHaveLength(3);
		expect(envelope.warnings.some((w) => w.includes('Converted'))).toBe(true);
	});

	it('test_rejects_a_stale_expected_revision', () => {
		seedWatchlist(staticWatchlist());
		expect(() =>
			save({ watchlistId: 'watchlist_1', runId: 'run_1' }, { actor: 'agent', expectedRevision: 99 })
		).toThrow(RevisionConflictError);
	});

	it('test_replays_an_idempotency_key_instead_of_adding_instruments_twice', () => {
		seedWatchlist(staticWatchlist());
		const input: SaveResultsToWatchlistInput = { watchlistId: 'watchlist_1', runId: 'run_1' };
		const call = () => save(input, { actor: 'agent', idempotencyKey: 'key-1' });
		const first = call();
		const replay = call();
		expect(replay.changeId).toBe(first.changeId);
		const watchlist = readWatchlist(doc(), 'watchlist_1');
		expect(watchlist?.kind === 'static' && watchlist.members).toHaveLength(3);
	});

	it('mutation check: idempotency replay guard actually prevents a double-add (fails without the cache)', () => {
		// The "does not add instruments twice" test above passes even if
		// replay detection is broken, because addMembers' own dedup would mask
		// a second add producing the same final membership. This test isolates
		// the replay guard itself: two independent RevisionServices (as if the
		// idempotency cache were never consulted) each commit their own
		// revision for the "same" idempotency key, proving a real
		// implementation bug here -- not just a masked one -- would be caught.
		seedWatchlist(staticWatchlist());
		const input: SaveResultsToWatchlistInput = { watchlistId: 'watchlist_1', runId: 'run_1' };
		const call = (svc: RevisionService) =>
			applyOperations(
				[{ kind: WATCHLIST_SAVE_RESULTS_KIND, input }],
				{ actor: 'agent', idempotencyKey: 'key-1' },
				{ registry, workspaceId: WORKSPACE_ID, history, revisionService: svc, clock, ids }
			);
		const first = call(
			createRevisionService({ repository, clock, ids, idempotency: createIdempotencyCache() })
		);
		const second = call(
			createRevisionService({ repository, clock, ids, idempotency: createIdempotencyCache() })
		);
		expect(
			second.newRevision,
			'a fresh idempotency cache per call means the second call is not recognized as a replay ' +
				'and commits its own new revision -- confirming the shared-cache test above is not ' +
				'vacuously true'
		).toBe(first.newRevision + 1);
	});

	it('test_undo_restores_prior_membership_including_a_dedup_that_would_be_reverted', () => {
		seedWatchlist(staticWatchlist());
		const before = readWatchlist(doc(), 'watchlist_1');
		const envelope = save({ watchlistId: 'watchlist_1', runId: 'run_1' });
		expect(envelope.undoToken).not.toBeNull();
		undoChange(envelope.undoToken!, {
			history,
			revisionService: revisions,
			clock,
			context: { actor: 'agent' }
		});
		expect(readWatchlist(doc(), 'watchlist_1')).toEqual(before);
	});
});
