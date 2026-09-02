import { describe, expect, it } from 'vitest';
import { makeProvenance } from '../../../domain/provenance';
import { makeFeatureWeightSet } from '../../domain/contract';
import type { SimilarityCandidate, SimilarityRun } from '../../domain/contract';
import {
	emptyRunMessage,
	formatNormalization,
	formatProvenance,
	formatScore,
	rankCandidates,
	topContributingFamilies
} from './presentation';

const PROVENANCE = makeProvenance({
	asOf: '2026-09-02T20:00:00.000Z',
	sourceId: 'src.panel.mock',
	sourceLabel: 'Mock Panel',
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'adjusted',
	liveness: 'end_of_day'
});

function candidate(
	id: string,
	score: number,
	similarity: Record<string, number> = {}
): SimilarityCandidate {
	return {
		candidateId: id,
		instrument: {
			instrumentId: `inst:XNAS:${id}`,
			symbol: id,
			exchange: 'XNAS',
			assetType: 'equity'
		},
		window: { start: '2026-01-01', end: '2026-01-10', timeframe: '1d' },
		score,
		perFamilySimilarity: similarity,
		unavailableFamilies: []
	};
}

function run(candidates: SimilarityCandidate[], warnings: string[] = []): SimilarityRun {
	return {
		runId: 'run_1',
		referenceSetupId: 'setup_1',
		scope: 'cross_instrument',
		weights: makeFeatureWeightSet(),
		normalization: { mode: 'percent_change', anchor: 'window_start' },
		provenance: PROVENANCE,
		candidates,
		warnings
	};
}

describe('rankCandidates', () => {
	it('sorts candidates by descending score regardless of input order', () => {
		const r = run([candidate('LOW', 0.2), candidate('HIGH', 0.9), candidate('MID', 0.5)]);
		const ids = rankCandidates(r).map((c) => c.candidateId);
		expect(ids, `expected highest score first, got ${JSON.stringify(ids)}`).toEqual([
			'HIGH',
			'MID',
			'LOW'
		]);
	});

	// Mutation check: a sort with the comparator reversed (a.score - b.score)
	// would pass a same-length-and-membership assertion but not this one.
	it('does not merely return the same candidates unsorted', () => {
		const r = run([candidate('LOW', 0.2), candidate('HIGH', 0.9)]);
		const ranked = rankCandidates(r);
		expect(ranked[0]?.candidateId, 'expected the highest-scoring candidate first').toBe('HIGH');
	});
});

describe('topContributingFamilies', () => {
	it('ranks available families by weight * similarity, highest first', () => {
		const weights = makeFeatureWeightSet({ price_shape: 0.1, volume: 0.9 });
		const c = candidate('X', 0.5, { price_shape: 0.9, volume: 0.9 });
		// price_shape: 0.1 * 0.9 = 0.09; volume: 0.9 * 0.9 = 0.81 -- volume wins
		// despite an identical measured similarity, purely on weight.
		const top = topContributingFamilies(c, weights, 1);
		expect(top, `expected volume to outrank price_shape under this weight set`).toEqual(['volume']);
	});

	it('respects the limit', () => {
		const weights = makeFeatureWeightSet();
		const c = candidate('X', 0.5, {
			price_shape: 0.9,
			volume: 0.8,
			volatility: 0.7,
			studies: 0.6
		});
		expect(topContributingFamilies(c, weights, 2)).toHaveLength(2);
	});
});

describe('emptyRunMessage', () => {
	it('returns null when the run has candidates', () => {
		const r = run([candidate('A', 0.5)]);
		expect(emptyRunMessage(r)).toBeNull();
	});

	it('returns the run warnings joined when there are no candidates', () => {
		const r = run([], ['Universe was empty.']);
		expect(emptyRunMessage(r)).toBe('Universe was empty.');
	});

	it('falls back to a generic message when no candidates and no warnings', () => {
		const r = run([], []);
		expect(emptyRunMessage(r)).toContain('No candidates matched');
	});
});

describe('formatProvenance', () => {
	it('includes every field the market-data provenance rule requires', () => {
		const lines = formatProvenance(PROVENANCE).join(' | ');
		for (const expected of [
			'As of',
			'Source:',
			'Status:',
			'Timezone:',
			'Currency:',
			'Price basis:',
			'Engine:'
		]) {
			expect(lines, `expected provenance display to include "${expected}"`).toContain(expected);
		}
	});

	it('states the delay magnitude for delayed data, not just the word "delayed"', () => {
		const delayed = makeProvenance({
			asOf: '2026-09-02T20:00:00.000Z',
			sourceId: 'src.x',
			sourceLabel: 'X',
			timezone: 'UTC',
			liveness: 'delayed',
			delaySeconds: 900
		});
		const lines = formatProvenance(delayed).join(' | ');
		expect(lines, 'expected the delay magnitude to be stated, not just "delayed"').toContain('900');
	});
});

describe('formatNormalization', () => {
	it('states both mode and anchor', () => {
		const formatted = formatNormalization({ mode: 'percent_change', anchor: 'window_start' });
		expect(formatted).toContain('percent_change');
		expect(formatted).toContain('window_start');
	});
});

describe('formatScore', () => {
	it('renders a score as a rounded percentage', () => {
		expect(formatScore(0.873)).toBe('87%');
	});
});
