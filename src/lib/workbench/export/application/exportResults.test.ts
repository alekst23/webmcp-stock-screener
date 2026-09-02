// Tests for T-1014-10's use case: reading a pinned run into a bounded
// export, cursor paging, column-subset rejection, and -- the ticket's
// headline guarantee (AC4, AC5) -- that exporting never executes or
// refreshes a screener, including for an unknown or expired run_id.
import { describe, expect, it } from 'vitest';
import type { RunRetentionPolicy } from '../../../screener/ports';
import { createPinnedRunStore } from '../../../screener/runStore';
import { createSpyPinnedRunStore, testPinnedRunStore, testRun } from '../../../results/testSupport';
import { EXPORT_MAX_LIMIT } from '../domain/exportRun';
import { exportResults } from './exportResults';

function alwaysEvict(): RunRetentionPolicy {
	return { shouldEvict: () => true };
}

function isOk<T>(value: T): value is Exclude<T, { available: false } | { rejected: true }> {
	return !(
		typeof value === 'object' &&
		value !== null &&
		('available' in value || 'rejected' in value)
	);
}

describe('exportResults: happy path (AC1)', () => {
	it('returns the run rows, filter tree, ranking, run id and timestamp, and provenance', () => {
		const run = testRun('run_1', 3);
		const store = testPinnedRunStore(run);
		const outcome = exportResults(store, { runId: 'run_1' });
		if (!isOk(outcome)) throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
		expect(outcome.runId).toBe('run_1');
		expect(outcome.runCreatedAt).toBe(run.createdAt);
		expect(outcome.filterTree).toBe(run.filterTree);
		expect(outcome.rankingSpec).toBe(run.rankingSpec);
		expect(outcome.rows).toHaveLength(3);
		expect(outcome.provenance).toEqual(run.provenance);
		expect(outcome.exportId, 'expected a stable export id').toMatch(/^export_\d+$/);
	});

	it('mints a different export id on each call', () => {
		const store = testPinnedRunStore(testRun('run_1', 1));
		const first = exportResults(store, { runId: 'run_1' });
		const second = exportResults(store, { runId: 'run_1' });
		if (!isOk(first) || !isOk(second)) throw new Error('unexpected outcome');
		expect(first.exportId).not.toBe(second.exportId);
	});
});

describe('exportResults: bounded/paginated (AC7)', () => {
	it('bounds rows to the requested limit and reports a next cursor', () => {
		const store = testPinnedRunStore(testRun('run_1', 10));
		const outcome = exportResults(store, { runId: 'run_1', limit: 4 });
		if (!isOk(outcome)) throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
		expect(outcome.rows).toHaveLength(4);
		expect(outcome.selection.bounded).toBe(true);
		expect(outcome.selection.totalAvailable).toBe(10);
		expect(outcome.selection.nextCursor).not.toBeNull();
	});

	it('a cursor from a previous export continues the traversal without gaps or overlap', () => {
		const store = testPinnedRunStore(testRun('run_1', 6));
		const first = exportResults(store, { runId: 'run_1', limit: 4 });
		if (!isOk(first)) throw new Error('unexpected outcome');
		const second = exportResults(store, {
			runId: 'run_1',
			limit: 4,
			cursor: first.selection.nextCursor ?? undefined
		});
		if (!isOk(second)) throw new Error('unexpected outcome');
		const seenRanks = [...first.rows, ...second.rows].map((row) => row.rank);
		expect(seenRanks).toEqual([1, 2, 3, 4, 5, 6]);
		expect(second.selection.nextCursor).toBeNull();
	});

	it('rejects a limit above the maximum, naming it, rather than clamping', () => {
		const store = testPinnedRunStore(testRun('run_1', 1));
		const outcome = exportResults(store, { runId: 'run_1', limit: EXPORT_MAX_LIMIT + 1 });
		if (!('rejected' in outcome) || outcome.reason !== 'limit_exceeded') {
			throw new Error(`expected a limit_exceeded rejection, got ${JSON.stringify(outcome)}`);
		}
		expect(outcome.max).toBe(EXPORT_MAX_LIMIT);
	});

	it('rejects a cursor minted for a different run', () => {
		const store = testPinnedRunStore(testRun('run_1', 5), testRun('run_2', 5));
		const foreign = exportResults(store, { runId: 'run_2', limit: 1 });
		if (!isOk(foreign)) throw new Error('unexpected outcome');
		const outcome = exportResults(store, {
			runId: 'run_1',
			cursor: foreign.selection.nextCursor ?? undefined
		});
		if (!('rejected' in outcome) || outcome.reason !== 'invalid_cursor') {
			throw new Error(`expected an invalid_cursor rejection, got ${JSON.stringify(outcome)}`);
		}
	});
});

describe('exportResults: column selection (AC6)', () => {
	const tableConfig = {
		columns: [
			{
				id: 'column_price',
				identity: { source: 'catalog_field' as const, fieldId: 'field.price' },
				label: 'Price',
				valueType: 'number' as const
			}
		],
		computedColumns: [],
		sort: null,
		grouping: null,
		formattingRules: [],
		pageSize: null,
		chartPanelId: null
	};

	it('rejects a requested column id absent from the supplied table configuration', () => {
		const store = testPinnedRunStore(testRun('run_1', 1));
		const outcome = exportResults(store, {
			runId: 'run_1',
			tableConfig,
			columnIds: ['column_missing']
		});
		if (!('rejected' in outcome) || outcome.reason !== 'unknown_columns') {
			throw new Error(`expected an unknown_columns rejection, got ${JSON.stringify(outcome)}`);
		}
		expect(outcome.columnIds).toEqual(['column_missing']);
	});

	it('leaves provenance unchanged when a column subset is requested', () => {
		const run = testRun('run_1', 1);
		const store = testPinnedRunStore(run);
		const outcome = exportResults(store, {
			runId: 'run_1',
			tableConfig,
			columnIds: ['column_price']
		});
		if (!isOk(outcome)) throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
		expect(outcome.provenance).toEqual(run.provenance);
	});
});

describe('exportResults: unknown or expired run (AC5)', () => {
	it('names the run_id and reports it was never available', () => {
		const store = testPinnedRunStore();
		const outcome = exportResults(store, { runId: 'run_missing' });
		if (!('available' in outcome) || outcome.available) {
			throw new Error(`expected a not-available outcome, got ${JSON.stringify(outcome)}`);
		}
		expect(outcome.runId).toBe('run_missing');
		expect(outcome.reason).toBe('unknown');
	});

	it('reports an evicted run as expired, not as an executable retry', () => {
		const base = createPinnedRunStore({ policy: alwaysEvict() });
		base.putRun(testRun('run_expired', 3));
		const outcome = exportResults(base, { runId: 'run_expired' });
		if (!('available' in outcome) || outcome.available) {
			throw new Error(`expected a not-available outcome, got ${JSON.stringify(outcome)}`);
		}
		expect(outcome.reason).toBe('evicted');
	});
});

describe("exportResults: no silent rerun (AC4, AC5 -- the ticket's headline guarantee)", () => {
	it('never calls putRun for a valid export, a bounded/paginated export, or an unknown/expired run_id', () => {
		const spy = createSpyPinnedRunStore(testPinnedRunStore(testRun('run_1', 7)));

		let outcome = exportResults(spy, { runId: 'run_1', limit: 2 });
		for (let guard = 0; guard < 10; guard++) {
			if (!isOk(outcome)) throw new Error('unexpected non-export outcome during traversal');
			if (outcome.selection.nextCursor === null) break;
			outcome = exportResults(spy, {
				runId: 'run_1',
				limit: 2,
				cursor: outcome.selection.nextCursor
			});
		}
		exportResults(spy, { runId: 'run_missing' });

		const evictingStore = createPinnedRunStore({ policy: alwaysEvict() });
		evictingStore.putRun(testRun('run_expired', 1));
		const evictingSpy = createSpyPinnedRunStore(evictingStore);
		exportResults(evictingSpy, { runId: 'run_expired' });

		expect(spy.putRunCalls, 'exporting a valid or unknown run must never write back').toBe(0);
		expect(evictingSpy.putRunCalls, 'exporting an expired run must never write back').toBe(0);
	});
});
