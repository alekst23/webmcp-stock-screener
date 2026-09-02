import { describe, expect, it } from 'vitest';
import { makeProvenance } from '../../../domain/provenance';
import { makeFeatureWeightSet } from '../../domain/contract';
import type { SimilarityCandidate, SimilarityRun } from '../../domain/contract';
import {
	buildComparisonView,
	CandidateSelectionError,
	FORM_CAPS,
	resolveComparisonCandidates
} from './comparisonView';

function candidate(id: string): SimilarityCandidate {
	return {
		candidateId: id,
		instrument: {
			instrumentId: `inst:XNAS:${id}`,
			symbol: id,
			exchange: 'XNAS',
			assetType: 'equity'
		},
		window: { start: '2026-01-01', end: '2026-01-10', timeframe: '1d' },
		score: 0.5,
		perFamilySimilarity: { price_shape: 0.5 },
		unavailableFamilies: []
	};
}

function run(candidateIds: string[], warnings: string[] = []): SimilarityRun {
	return {
		runId: 'run_1',
		referenceSetupId: 'setup_1',
		weights: makeFeatureWeightSet(),
		normalization: { mode: 'percent_change', anchor: 'window_start' },
		provenance: makeProvenance({
			asOf: '2026-09-02T20:00:00.000Z',
			sourceId: 'src.x',
			sourceLabel: 'X',
			timezone: 'UTC',
			liveness: 'historical'
		}),
		candidates: candidateIds.map(candidate),
		warnings
	};
}

describe('resolveComparisonCandidates', () => {
	it('accepts every requested id when all are part of the run and under the cap', () => {
		const r = run(['A', 'B', 'C']);
		const result = resolveComparisonCandidates(r, ['A', 'B'], 'overlay');
		expect(result.shown).toEqual(['A', 'B']);
		expect(result.warnings).toEqual([]);
	});

	it('rejects with CandidateSelectionError naming ids not part of the run (AC8), making no partial selection', () => {
		const r = run(['A', 'B']);
		expect(() => resolveComparisonCandidates(r, ['A', 'Z'], 'overlay')).toThrow(
			CandidateSelectionError
		);
		try {
			resolveComparisonCandidates(r, ['A', 'Z'], 'overlay');
		} catch (err) {
			expect(err).toBeInstanceOf(CandidateSelectionError);
			expect((err as CandidateSelectionError).unknownCandidateIds).toEqual(['Z']);
		}
	});

	it('caps to the form limit and warns which candidates were shown and dropped (AC9)', () => {
		const ids = Array.from({ length: FORM_CAPS.overlay + 2 }, (_, i) => `C${i}`);
		const r = run(ids);
		const result = resolveComparisonCandidates(r, ids, 'overlay');
		expect(result.shown).toHaveLength(FORM_CAPS.overlay);
		expect(result.shown).toEqual(ids.slice(0, FORM_CAPS.overlay));
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain(String(FORM_CAPS.overlay));
	});

	it('applies a different cap per form', () => {
		expect(FORM_CAPS.overlay).not.toBe(FORM_CAPS.small_multiples);
	});
});

describe('buildComparisonView', () => {
	it('carries the reference separately from candidateIds, never mixed in', () => {
		const r = run(['A', 'B']);
		const view = buildComparisonView(r, ['A', 'B'], 'small_multiples');
		expect(view.referenceSetupId).toBe('setup_1');
		expect(view.candidateIds).toEqual(['A', 'B']);
		expect(view.candidateIds).not.toContain('setup_1');
	});

	it('states the normalization and provenance from the run, not re-derived', () => {
		const r = run(['A']);
		const view = buildComparisonView(r, ['A'], 'overlay');
		expect(view.normalization).toEqual(r.normalization);
		expect(view.provenance).toEqual(r.provenance);
	});

	it('carries forward the run warnings alongside any capping warning', () => {
		const r = run(['A'], ['Reference window could not compute: volume.']);
		const view = buildComparisonView(r, ['A'], 'overlay');
		expect(view.warnings).toContain('Reference window could not compute: volume.');
	});
});
