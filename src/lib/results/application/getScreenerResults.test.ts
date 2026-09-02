// Tests for T-1010-4's use case: paging, cursors, and -- the epic's
// headline guarantee (AC5) -- that reading a page never executes or
// rewrites a run. Projection arithmetic itself (sort/group/computed
// columns) is covered by domain/projection.test.ts; these tests exercise
// orchestration only.
import { describe, expect, it } from 'vitest';
import { MAX_PAGE_SIZE } from '../domain/page';
import type { RunRetentionPolicy } from '../../screener/ports';
import { createPinnedRunStore } from '../../screener/runStore';
import { createSpyPinnedRunStore, testPinnedRunStore, testRun } from '../testSupport';
import { getScreenerResults } from './getScreenerResults';

function alwaysEvict(): RunRetentionPolicy {
	return { shouldEvict: () => true };
}

describe('getScreenerResults: paging (AC1, AC8)', () => {
	it('returns at most the requested page size, plus total and a next cursor', () => {
		const store = testPinnedRunStore(testRun('run_1', 5));
		const outcome = getScreenerResults(store, { runId: 'run_1', pageSize: 2 });
		if ('available' in outcome || 'rejected' in outcome) {
			throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
		}
		expect(outcome.rows.length, 'expected exactly 2 rows').toBe(2);
		expect(outcome.total, "expected the run's full total").toBe(5);
		expect(outcome.nextCursor, 'expected a cursor -- there are more rows').not.toBeNull();
	});

	it('omits the cursor on the last page', () => {
		const store = testPinnedRunStore(testRun('run_1', 2));
		const outcome = getScreenerResults(store, { runId: 'run_1', pageSize: 2 });
		if ('available' in outcome || 'rejected' in outcome) {
			throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
		}
		expect(outcome.nextCursor, 'the last page must not carry a next cursor').toBeNull();
	});

	it('uses the documented default page size when none is requested', () => {
		const store = testPinnedRunStore(testRun('run_1', 30));
		const outcome = getScreenerResults(store, { runId: 'run_1' });
		if ('available' in outcome || 'rejected' in outcome) {
			throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
		}
		expect(outcome.pageSize, 'expected the documented default of 25').toBe(25);
		expect(outcome.rows.length, 'expected 25 rows on the first page').toBe(25);
	});

	it('rejects a page size above the hard maximum, naming it, rather than clamping', () => {
		const store = testPinnedRunStore(testRun('run_1', 5));
		const outcome = getScreenerResults(store, { runId: 'run_1', pageSize: MAX_PAGE_SIZE + 1 });
		if (!('rejected' in outcome) || outcome.reason !== 'page_size_exceeded') {
			throw new Error(`expected a page_size_exceeded rejection, got ${JSON.stringify(outcome)}`);
		}
		expect(outcome.max, `expected the rejection to name ${MAX_PAGE_SIZE}`).toBe(MAX_PAGE_SIZE);
	});
});

describe('getScreenerResults: sort applied before the page is cut (AC2, AC3)', () => {
	it('a page boundary never resets the global sort order', () => {
		const run = {
			...testRun('run_1', 5),
			matches: [1, 2, 3, 4, 5].map((rank) => ({
				instrumentId: `inst_${rank}`,
				rank,
				compositeScore: null,
				rankingValues: { 'field.score': 100 - rank }, // inverse of rank
				nodeEvaluations: {}
			}))
		};
		const store = testPinnedRunStore(run);
		const tableConfig = {
			columns: [],
			computedColumns: [],
			sort: {
				key: { source: 'catalog_field' as const, fieldId: 'field.score' },
				direction: 'desc' as const
			},
			grouping: null,
			formattingRules: [],
			pageSize: null,
			chartPanelId: null
		};

		const seenRanks: number[] = [];
		let outcome = getScreenerResults(store, { runId: 'run_1', pageSize: 2, tableConfig });
		for (let guard = 0; guard < 10; guard++) {
			if ('available' in outcome || 'rejected' in outcome) {
				throw new Error('unexpected non-page outcome during traversal');
			}
			seenRanks.push(...outcome.rows.map((r) => r.rank));
			if (outcome.nextCursor === null) break;
			outcome = getScreenerResults(store, {
				runId: 'run_1',
				cursor: outcome.nextCursor,
				pageSize: 2,
				tableConfig
			});
		}
		// field.score is 100-rank, so descending score means ascending rank:
		// rank 1 has the highest score and must appear first, across every page.
		expect(
			seenRanks,
			'expected the whole traversal to be in ascending-rank order despite 2-row pages'
		).toEqual([1, 2, 3, 4, 5]);
	});
});

describe('getScreenerResults: grouping is reflected in the page (AC4)', () => {
	it('carries a resolved groupValue on each row when grouping is configured', () => {
		const run = {
			...testRun('run_1', 2),
			matches: [
				{
					instrumentId: 'inst_1',
					rank: 1,
					compositeScore: null,
					rankingValues: { 'field.sector': 1 },
					nodeEvaluations: {}
				},
				{
					instrumentId: 'inst_2',
					rank: 2,
					compositeScore: null,
					rankingValues: { 'field.sector': 2 },
					nodeEvaluations: {}
				}
			]
		};
		const store = testPinnedRunStore(run);
		const outcome = getScreenerResults(store, {
			runId: 'run_1',
			tableConfig: {
				columns: [],
				computedColumns: [],
				sort: null,
				grouping: { key: { source: 'catalog_field', fieldId: 'field.sector' } },
				formattingRules: [],
				pageSize: null,
				chartPanelId: null
			}
		});
		if ('available' in outcome || 'rejected' in outcome) {
			throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
		}
		expect(outcome.grouped, 'expected the page to report grouping is configured').toBe(true);
		expect(outcome.rows[0]?.groupValue, "expected the first row's sector").toBe(1);
		expect(outcome.rows[1]?.groupValue, "expected the second row's sector").toBe(2);
	});
});

describe("getScreenerResults: no silent rerun (AC5, the epic's headline guarantee)", () => {
	it('never calls putRun for a valid run, across a full paged traversal', () => {
		const spy = createSpyPinnedRunStore(testPinnedRunStore(testRun('run_1', 7)));
		let outcome = getScreenerResults(spy, { runId: 'run_1', pageSize: 2 });
		for (let guard = 0; guard < 10; guard++) {
			if ('available' in outcome || 'rejected' in outcome) {
				throw new Error('unexpected non-page outcome during traversal');
			}
			if (outcome.nextCursor === null) break;
			outcome = getScreenerResults(spy, {
				runId: 'run_1',
				cursor: outcome.nextCursor,
				pageSize: 2
			});
		}
		expect(spy.putRunCalls, 'a valid-run read must never write back to the store').toBe(0);
	});

	it('never calls putRun for an expired (evicted) run', () => {
		const base = createPinnedRunStore({ policy: alwaysEvict() });
		base.putRun(testRun('run_expired', 3));
		const spy = createSpyPinnedRunStore(base);

		const outcome = getScreenerResults(spy, { runId: 'run_expired' });
		if (!('available' in outcome) || outcome.available) {
			throw new Error(`expected an evicted-run outcome, got ${JSON.stringify(outcome)}`);
		}
		expect(outcome.reason, 'expected the eviction reason').toBe('evicted');
		expect(spy.putRunCalls, 'an evicted-run read must never write back to the store').toBe(0);
	});

	it('never calls putRun for repeated paging, including past the last page and for an unknown run', () => {
		const spy = createSpyPinnedRunStore(testPinnedRunStore(testRun('run_1', 2)));
		getScreenerResults(spy, { runId: 'run_1', pageSize: 10 });
		getScreenerResults(spy, { runId: 'run_1', pageSize: 10 });
		getScreenerResults(spy, { runId: 'run_1', pageSize: 10 });
		getScreenerResults(spy, { runId: 'run_missing' });
		expect(spy.putRunCalls, 'repeated reads must never write back to the store').toBe(0);
	});
});

describe('getScreenerResults: unknown or expired run (AC6)', () => {
	it('names the run_id and states no run was executed as a side effect', () => {
		const store = testPinnedRunStore();
		const outcome = getScreenerResults(store, { runId: 'run_missing' });
		if (!('available' in outcome) || outcome.available) {
			throw new Error(`expected a not-available outcome, got ${JSON.stringify(outcome)}`);
		}
		expect(outcome.runId, 'the outcome must name the run_id').toBe('run_missing');
		expect(outcome.reason, "an unstored run_id must report 'unknown'").toBe('unknown');
	});
});

describe('getScreenerResults: empty run (AC7)', () => {
	it('returns an empty page with total zero and full provenance, not an error', () => {
		const store = testPinnedRunStore(testRun('run_empty', 0));
		const outcome = getScreenerResults(store, { runId: 'run_empty' });
		if ('available' in outcome || 'rejected' in outcome) {
			throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
		}
		expect(outcome.rows.length, 'expected zero rows').toBe(0);
		expect(outcome.total, 'expected total 0').toBe(0);
		expect(outcome.provenance, 'expected full provenance on an empty page').toBeDefined();
	});
});

describe('getScreenerResults: provenance (AC9)', () => {
	it("carries the run's own provenance fields verbatim", () => {
		const run = testRun('run_1', 1);
		const store = testPinnedRunStore(run);
		const outcome = getScreenerResults(store, { runId: 'run_1' });
		if ('available' in outcome || 'rejected' in outcome) {
			throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
		}
		expect(outcome.provenance, "the page must carry the run's own provenance").toEqual(
			run.provenance
		);
	});
});

describe('getScreenerResults: cursors (AC10)', () => {
	it('a cursor from a previous page returns the next contiguous rows', () => {
		const store = testPinnedRunStore(testRun('run_1', 4));
		const first = getScreenerResults(store, { runId: 'run_1', pageSize: 2 });
		if ('available' in first || 'rejected' in first) throw new Error('unexpected outcome');
		const second = getScreenerResults(store, {
			runId: 'run_1',
			pageSize: 2,
			cursor: first.nextCursor ?? undefined
		});
		if ('available' in second || 'rejected' in second) throw new Error('unexpected outcome');
		const seen = [...first.rows, ...second.rows].map((r) => r.resultId);
		expect(new Set(seen).size, 'expected 4 distinct rows across both pages').toBe(4);
		expect(second.offset, 'expected the second page to start where the first left off').toBe(2);
	});

	it('rejects a malformed cursor rather than silently returning the first page', () => {
		const store = testPinnedRunStore(testRun('run_1', 5));
		const outcome = getScreenerResults(store, { runId: 'run_1', cursor: 'not-a-cursor' });
		if (!('rejected' in outcome) || outcome.reason !== 'invalid_cursor') {
			throw new Error(`expected an invalid_cursor rejection, got ${JSON.stringify(outcome)}`);
		}
	});

	it('rejects a cursor minted for a different run', () => {
		const store = testPinnedRunStore(testRun('run_1', 5), testRun('run_2', 5));
		const foreign = getScreenerResults(store, { runId: 'run_2', pageSize: 1 });
		if ('available' in foreign || 'rejected' in foreign) throw new Error('unexpected outcome');
		const outcome = getScreenerResults(store, {
			runId: 'run_1',
			cursor: foreign.nextCursor ?? undefined
		});
		if (!('rejected' in outcome) || outcome.reason !== 'invalid_cursor') {
			throw new Error(`expected an invalid_cursor rejection, got ${JSON.stringify(outcome)}`);
		}
	});
});

describe('getScreenerResults: reads only (AC11)', () => {
	it('the outcome carries no mutation-envelope fields', () => {
		const store = testPinnedRunStore(testRun('run_1', 1));
		const outcome = getScreenerResults(store, { runId: 'run_1' });
		expect('changeId' in outcome, 'a read must not return a change_id').toBe(false);
		expect('newRevision' in outcome, 'a read must not return a new_revision').toBe(false);
		expect('undoToken' in outcome, 'a read must not return an undo_token').toBe(false);
	});
});
