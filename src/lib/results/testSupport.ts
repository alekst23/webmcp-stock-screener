// AC10's fixtures: a run/match builder pair so the Wave 2 use-case tickets
// (T-1010-4, T-1010-5) can build a ResultsReader over real ScreenerRun
// shapes without depending on EPIC-1009's engine being finished, plus a
// PinnedRunStore spy that makes the "no silent rerun" guarantee testable
// rather than merely structural.

import { keepAllRuns, type PinnedRunStore, type RunNotAvailable } from '../screener/ports';
import type { ScreenerMatch, ScreenerRun } from '../screener/run';
import { createPinnedRunStore } from '../screener/runStore';
import { makeProvenance, type MarketDataProvenance } from '../workbench/domain/provenance';

// Narrowed to `asOf` only -- the one field callers actually vary -- rather
// than a generic Partial<MarketDataProvenance>: makeProvenance's input is a
// discriminated union keyed on `liveness`, and spreading an arbitrary
// override object into one arm defeats that union's own type-checking.
export function testProvenance(overrides: { asOf?: string } = {}): MarketDataProvenance {
	return makeProvenance({
		asOf: overrides.asOf ?? '2026-09-02T14:30:00.000Z',
		sourceId: 'src.screener.engine',
		sourceLabel: 'Screener engine',
		liveness: 'end_of_day',
		timezone: 'America/New_York',
		currency: 'USD',
		priceAdjustment: 'adjusted'
	});
}

export function testMatch(rank: number, overrides: Partial<ScreenerMatch> = {}): ScreenerMatch {
	return {
		instrumentId: `inst_${rank}`,
		rank,
		compositeScore: 1 / rank,
		rankingValues: { 'field.price': 100 },
		nodeEvaluations: {},
		...overrides
	};
}

// Builds a plausible, already-complete run with `matchCount` matches ranked
// 1..matchCount. Every field a ResultsReader test needs is populated with a
// sane default so a test only overrides what it's actually exercising.
export function testRun(
	runId: string,
	matchCount: number,
	overrides: Partial<Omit<ScreenerRun, 'matches'>> = {}
): ScreenerRun {
	const matches = Array.from({ length: matchCount }, (_, index) => testMatch(index + 1));
	return {
		runId,
		screenerId: 'screener_1',
		screenerRevision: 1,
		status: 'complete',
		universeCount: 1000,
		matchedCount: matchCount,
		returnedCount: matchCount,
		truncated: false,
		rankingApplied: true,
		normalization: 'percentile_rank',
		warnings: [],
		provenance: testProvenance(),
		createdAt: '2026-09-02T14:30:05.000Z',
		...overrides,
		matches
	};
}

// A PinnedRunStore ready to hand to createResultsReader, seeded with one
// run. Wave 2 tickets that just need "a store with a run in it" can use
// this directly instead of hand-rolling one.
export function testPinnedRunStore(...runs: ScreenerRun[]): PinnedRunStore {
	const store = createPinnedRunStore({ policy: keepAllRuns });
	runs.forEach((run) => store.putRun(run));
	return store;
}

// The discriminating half of the "no silent rerun" test (AC5, AC6):
// decorates a PinnedRunStore with call counters so a test can assert that
// reading pages -- including reading past the last page, or reading an
// unknown/evicted run_id -- never calls putRun. A ResultsReader built over
// this store that ever wrote back to it (a "refresh on read" regression)
// would fail that assertion immediately.
export interface SpyPinnedRunStore extends PinnedRunStore {
	putRunCalls: number;
	getRunCalls: number;
	getMatchesCalls: number;
}

export function createSpyPinnedRunStore(base: PinnedRunStore): SpyPinnedRunStore {
	const spy: SpyPinnedRunStore = {
		putRunCalls: 0,
		getRunCalls: 0,
		getMatchesCalls: 0,
		putRun(run: ScreenerRun): void {
			spy.putRunCalls += 1;
			base.putRun(run);
		},
		getRun(runId: string): ScreenerRun | RunNotAvailable {
			spy.getRunCalls += 1;
			return base.getRun(runId);
		},
		getMatches(runId: string, offset: number, limit: number): ScreenerMatch[] | RunNotAvailable {
			spy.getMatchesCalls += 1;
			return base.getMatches(runId, offset, limit);
		}
	};
	return spy;
}
