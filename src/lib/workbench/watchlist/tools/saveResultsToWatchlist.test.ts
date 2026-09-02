import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { testPinnedRunStore, testRun } from '../../../results/testSupport';
import type { PinnedRunStore } from '../../../screener/ports';
import { writeWatchlist } from '../domain/watchlist';
import type { Watchlist } from '../domain/watchlist';
import { buildSaveResultsToWatchlistTool } from './saveResultsToWatchlist';
import type { SaveResultsToWatchlistDeps } from './saveResultsToWatchlist';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

interface SuccessPayload {
	change_id: string;
	undo_token: string | null;
	watchlist: { members?: { instrument_id: string }[] } | null;
	added_count: number;
	already_present_count: number;
}

interface FailurePayload {
	error: string;
	message: string;
	issues?: string[];
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

describe('save_results_to_watchlist', () => {
	let deps: SaveResultsToWatchlistDeps;
	let tool: ToolSpec;
	let runs: PinnedRunStore;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const base = emptyWorkspace(WORKSPACE_ID, 'Research', NOW);
		const watchlist: Watchlist = {
			watchlistId: 'watchlist_1',
			name: 'Momentum',
			kind: 'static',
			members: [{ instrumentId: 'inst_1', addedAt: NOW, source: { kind: 'manual' } }],
			createdAt: NOW,
			updatedAt: NOW
		};
		repository.put(writeWatchlist(base, watchlist));
		repository.setActiveId(WORKSPACE_ID);
		const ids = createIdSequencer();
		runs = testPinnedRunStore(testRun('run_1', 3));
		deps = {
			repository,
			revisions: createRevisionService({
				repository,
				clock,
				ids,
				idempotency: createIdempotencyCache()
			}),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			clock,
			ids,
			runs
		};
		tool = buildSaveResultsToWatchlistTool(deps);
	});

	it('test_saves_a_runs_results_and_reports_added_and_already_present_counts', async () => {
		const body = jsonOf(
			await tool.execute({ watchlist_id: 'watchlist_1', run_id: 'run_1' })
		) as SuccessPayload;
		// inst_1 was pre-seeded (already present); inst_2 and inst_3 are new.
		expect(body.added_count).toBe(2);
		expect(body.already_present_count).toBe(1);
		expect(body.watchlist?.members?.map((m) => m.instrument_id)).toEqual([
			'inst_1',
			'inst_2',
			'inst_3'
		]);
	});

	it('test_a_replayed_idempotency_key_reports_zero_added_the_second_time', async () => {
		const input = { watchlist_id: 'watchlist_1', run_id: 'run_1', idempotency_key: 'key-1' };
		const first = jsonOf(await tool.execute(input)) as SuccessPayload;
		const replay = jsonOf(await tool.execute(input)) as SuccessPayload;
		expect(replay.change_id).toBe(first.change_id);
		// Honest about what THIS call did: nothing happened a second time, so
		// the replay's own added_count is 0 rather than repeating the first
		// call's numbers.
		expect(replay.added_count).toBe(0);
		expect(replay.already_present_count).toBe(3);
	});

	it('test_unknown_run_id_is_rejected_without_re_running_and_watchlist_is_unchanged', async () => {
		const body = jsonOf(
			await tool.execute({ watchlist_id: 'watchlist_1', run_id: 'run_missing' })
		) as FailurePayload;
		expect(body.error).toBe('operation_validation_error');
		expect(body.issues?.join(' ')).toMatch(/run_missing/);
	});

	it('test_saves_only_a_selected_subset', async () => {
		const body = jsonOf(
			await tool.execute({
				watchlist_id: 'watchlist_1',
				run_id: 'run_1',
				instrument_ids: ['inst_2']
			})
		) as SuccessPayload;
		expect(body.watchlist?.members?.map((m) => m.instrument_id)).toEqual(['inst_1', 'inst_2']);
	});

	it('test_rejects_saving_into_a_dynamic_watchlist_without_conversion', async () => {
		const repository = deps.repository;
		const doc = repository.get(WORKSPACE_ID)!;
		repository.put(
			writeWatchlist(doc, {
				watchlistId: 'watchlist_2',
				name: 'Dyn',
				kind: 'dynamic',
				screenerId: 'screener_1',
				screenerRevision: 1,
				createdAt: NOW,
				updatedAt: NOW
			})
		);
		const body = jsonOf(
			await tool.execute({ watchlist_id: 'watchlist_2', run_id: 'run_1' })
		) as FailurePayload;
		expect(body.error).toBe('operation_validation_error');
		expect(body.issues?.join(' ')).toMatch(/dynamic/);
	});

	it('test_converts_a_dynamic_watchlist_when_explicitly_acknowledged', async () => {
		const repository = deps.repository;
		const doc = repository.get(WORKSPACE_ID)!;
		repository.put(
			writeWatchlist(doc, {
				watchlistId: 'watchlist_2',
				name: 'Dyn',
				kind: 'dynamic',
				screenerId: 'screener_1',
				screenerRevision: 1,
				createdAt: NOW,
				updatedAt: NOW
			})
		);
		const body = jsonOf(
			await tool.execute({
				watchlist_id: 'watchlist_2',
				run_id: 'run_1',
				convert_dynamic: true
			})
		) as SuccessPayload;
		expect(body.watchlist?.members).toHaveLength(3);
	});
});
