import { describe, expect, it } from 'vitest';
import { makeProvenance, type MarketDataProvenance } from '../workbench/domain/provenance';
import { createPinnedRunStore } from './runStore';
import { emptyFilterTree } from './definition';
import { makeScreenerRun, type ScreenerMatch, type ScreenerRun } from './run';
import type { RunRetentionPolicy } from './ports';

function provenance(): MarketDataProvenance {
	return makeProvenance({
		asOf: '2026-09-02T14:30:00.000Z',
		sourceId: 'src.screener.engine',
		sourceLabel: 'Screener engine',
		liveness: 'end_of_day',
		timezone: 'America/New_York'
	});
}

function match(instrumentId: string, rank: number): ScreenerMatch {
	return {
		instrumentId,
		symbol: instrumentId,
		exchange: 'XNAS',
		assetType: 'equity',
		name: instrumentId,
		rank,
		compositeScore: 1 / rank,
		rankingValues: { 'field.price': 100 },
		nodeEvaluations: {
			filter_1: { nodeId: 'filter_1', passed: true, value: 100, unit: 'usd' }
		}
	};
}

function run(runId: string, matches: ScreenerMatch[] = [match('inst:XNAS:AAPL', 1)]): ScreenerRun {
	return makeScreenerRun({
		runId,
		screenerId: 'screener_1',
		screenerRevision: 1,
		status: 'complete',
		universeCount: 100,
		matchedCount: matches.length,
		returnedCount: matches.length,
		truncated: false,
		rankingApplied: true,
		normalization: 'percentile_rank',
		warnings: [],
		provenance: provenance(),
		matches,
		rejectedEvaluations: {},
		filterTree: emptyFilterTree('filter_root'),
		rankingSpec: null,
		createdAt: '2026-09-02T14:30:05.000Z'
	});
}

const alwaysEvict: RunRetentionPolicy = { shouldEvict: () => true };

describe('createPinnedRunStore', () => {
	it('test_getRun_unknownId_reportsUnknown', () => {
		const store = createPinnedRunStore();
		const result = store.getRun('run_missing');
		expect('available' in result, 'an id never stored must report RunNotAvailable').toBe(true);
		if ('available' in result) {
			expect(result.reason, 'a never-minted id is "unknown", not "evicted"').toBe('unknown');
		}
	});

	it('test_getRun_afterPutRun_returnsStoredRunUnchanged', () => {
		const store = createPinnedRunStore();
		const stored = run('run_1');
		store.putRun(stored);
		const result = store.getRun('run_1');
		expect(result, 'a read-back run must be byte-identical to what was stored').toEqual(stored);
	});

	it('test_getMatches_offsetAndLimit_slicesStoredMatches', () => {
		const store = createPinnedRunStore();
		const matches = [match('inst:A', 1), match('inst:B', 2), match('inst:C', 3)];
		store.putRun(run('run_1', matches));
		const page = store.getMatches('run_1', 1, 1);
		expect(Array.isArray(page), 'a valid run_id must return an array of matches').toBe(true);
		if (Array.isArray(page)) {
			expect(page.length, 'limit 1 must return exactly one match').toBe(1);
			expect(page[0]?.instrumentId, 'offset 1 must skip the first match').toBe('inst:B');
		}
	});

	it('test_getRun_zeroMatchRun_isDistinguishableFromRunNotAvailable', () => {
		const store = createPinnedRunStore();
		store.putRun(run('run_1', []));
		const stored = store.getRun('run_1');
		const missing = store.getRun('run_missing');
		expect(
			'available' in stored,
			'a zero-match run is a real ScreenerRun, not RunNotAvailable'
		).toBe(false);
		expect('available' in missing, 'a missing run must report RunNotAvailable').toBe(true);
		if (!('available' in stored)) {
			expect(stored.matchedCount, 'zero matches is a normal, valid count').toBe(0);
		}
	});

	it('test_getRun_defaultPolicy_keepsTheOnlyStoredRun', () => {
		const store = createPinnedRunStore();
		store.putRun(run('run_1'));
		const result = store.getRun('run_1');
		expect(
			'available' in result,
			'keepMostRecentRun (the default) must not evict the one run stored so far'
		).toBe(false);
	});

	it('test_getRun_defaultPolicy_afterNRunsOnlyMostRecentIsQueryable', () => {
		// AC1: a screener run, redefined, and run again N times must not
		// accumulate a growing set of live runs -- only the most recently
		// pinned run stays queryable, and every older run_id reports
		// 'evicted', not a growing live set.
		const store = createPinnedRunStore();
		const runIds = ['run_1', 'run_2', 'run_3', 'run_4', 'run_5'];
		for (const runId of runIds) {
			store.putRun(run(runId));
		}
		const mostRecent = store.getRun('run_5');
		expect(
			'available' in mostRecent,
			'the most recently pinned run must stay queryable under the default policy'
		).toBe(false);

		for (const runId of runIds.slice(0, -1)) {
			const result = store.getRun(runId);
			expect(
				'available' in result,
				`run ${runId} must be reclaimed once a more recent run is pinned`
			).toBe(true);
			if ('available' in result) {
				expect(
					result.reason,
					`run ${runId} was pinned then superseded, so it is 'evicted', not 'unknown'`
				).toBe('evicted');
			}
		}
	});

	it('test_getRun_withAlwaysEvictPolicy_reportsEvictedReason', () => {
		const store = createPinnedRunStore({ policy: alwaysEvict });
		store.putRun(run('run_1'));
		const evicted = store.getRun('run_1');
		const neverStored = store.getRun('run_never_stored');
		expect('available' in evicted, 'an always-evict policy must reclaim the stored run').toBe(true);
		if ('available' in evicted) {
			expect(evicted.reason, 'a run this store held and reclaimed is "evicted"').toBe('evicted');
		}
		expect(
			'available' in neverStored,
			'an id this store never held must also report unavailable'
		).toBe(true);
		if ('available' in neverStored) {
			expect(
				neverStored.reason,
				'an id never stored here is "unknown" even under an always-evict policy'
			).toBe('unknown');
		}
	});

	it('test_putRun_isTheOnlyWriteOperation', () => {
		// Structural guarantee (ports.ts): no execute/refresh member exists on
		// PinnedRunStore, so code holding only this object has no call that
		// produces fresh numbers under an old handle.
		const store = createPinnedRunStore();
		const keys = Object.keys(store).sort();
		expect(keys, 'PinnedRunStore must expose exactly putRun/getRun/getMatches').toEqual(
			['getMatches', 'getRun', 'putRun'].sort()
		);
	});
});
