// T-1014-4: pure refinement arithmetic and feedback validation, tested
// against the design spec's own scenario table before any application/tool
// wiring exists.
import { describe, expect, it } from 'vitest';
import { makeFeatureWeightSet } from '../../domain/contract';
import { refineWeights, SimilarityRefinementError, validateFeedback } from './refinement';

const KNOWN_IDS = new Set(['run_1_candidate_1', 'run_1_candidate_2', 'run_1_candidate_3']);

describe('validateFeedback', () => {
	it('AC4: rejects neither accepted nor rejected matches', () => {
		expect(() => validateFeedback([], [], KNOWN_IDS)).toThrow(SimilarityRefinementError);
		try {
			validateFeedback([], [], KNOWN_IDS);
		} catch (err) {
			expect(err).toBeInstanceOf(SimilarityRefinementError);
			expect((err as SimilarityRefinementError).reason).toBe('feedback_required');
		}
	});

	it('AC5: only rejections is not rejected -- one-sided feedback is still valid feedback', () => {
		expect(() => validateFeedback([], ['run_1_candidate_1'], KNOWN_IDS)).not.toThrow();
	});

	it('AC6: rejects a match marked both accepted and rejected, naming it', () => {
		expect(() => validateFeedback(['run_1_candidate_1'], ['run_1_candidate_1'], KNOWN_IDS)).toThrow(
			SimilarityRefinementError
		);
		try {
			validateFeedback(['run_1_candidate_1'], ['run_1_candidate_1'], KNOWN_IDS);
		} catch (err) {
			const refinementErr = err as SimilarityRefinementError;
			expect(refinementErr.reason).toBe('conflicting_match');
			expect(refinementErr.matchIds).toEqual(['run_1_candidate_1']);
			expect(refinementErr.message).toContain('run_1_candidate_1');
		}
	});

	it('AC7: rejects a match id that does not belong to the named search, naming it', () => {
		try {
			validateFeedback(['not_in_this_run'], [], KNOWN_IDS);
			expect.unreachable('expected validateFeedback to throw');
		} catch (err) {
			const refinementErr = err as SimilarityRefinementError;
			expect(refinementErr.reason).toBe('unknown_match');
			expect(refinementErr.matchIds).toEqual(['not_in_this_run']);
		}
	});

	it('does not accept a conflicting-match id merely because it is also unknown', () => {
		// A conflicting match is a self-contained problem with the request;
		// it is reported before the run's own candidate list is consulted.
		try {
			validateFeedback(['ghost'], ['ghost'], KNOWN_IDS);
			expect.unreachable('expected validateFeedback to throw');
		} catch (err) {
			expect((err as SimilarityRefinementError).reason).toBe('conflicting_match');
		}
	});
});

describe('refineWeights', () => {
	const EQUAL = makeFeatureWeightSet();

	it('AC1: favors the accepted matches’ features over the rejected ones', () => {
		const outcome = refineWeights(
			EQUAL,
			[{ price_shape: 0.9, volume: 0.2 }],
			[{ price_shape: 0.1, volume: 0.8 }]
		);

		expect(outcome.weights.price_shape).toBeGreaterThan(EQUAL.price_shape);
		expect(outcome.weights.volume).toBeLessThan(EQUAL.volume);
	});

	it('AC2: reports every changed weight with its feature name and before/after value', () => {
		const outcome = refineWeights(EQUAL, [{ price_shape: 1 }], [{ price_shape: 0 }]);

		const change = outcome.changes.find((c) => c.feature === 'price_shape');
		expect(change, 'expected a recorded change for price_shape').toBeTruthy();
		expect(change!.before).toBe(EQUAL.price_shape);
		expect(change!.after).toBe(outcome.weights.price_shape);
		expect(change!.after).not.toBe(change!.before);
	});

	it('leaves a family unlisted in `changes` when nothing about it was judged', () => {
		const outcome = refineWeights(EQUAL, [{ price_shape: 1 }], [{ price_shape: 0 }]);

		expect(outcome.changes.some((c) => c.feature === 'volume')).toBe(false);
	});

	it('AC5: only-rejection feedback moves weights away from the rejected matches’ features and warns one-sided', () => {
		const outcome = refineWeights(EQUAL, [], [{ price_shape: 0.9 }]);

		expect(outcome.weights.price_shape).toBeLessThan(EQUAL.price_shape);
		expect(outcome.warnings.some((w) => /one-sided/i.test(w))).toBe(true);
	});

	it('does not warn one-sided when only accepted matches are supplied', () => {
		const outcome = refineWeights(EQUAL, [{ price_shape: 0.9 }], []);

		expect(outcome.warnings.some((w) => /one-sided/i.test(w))).toBe(false);
	});

	it('AC8: clamps a weight that would go negative to its declared floor and warns', () => {
		// A small starting weight pushed hard downward by a strongly-scoring
		// rejected match, with nothing accepted to counterbalance it.
		const lowWeight = makeFeatureWeightSet({
			price_shape: 0.02,
			volume: 0.196,
			volatility: 0.196,
			relative_strength: 0.196,
			studies: 0.196,
			pattern_structure: 0.196
		});

		const outcome = refineWeights(lowWeight, [], [{ price_shape: 1 }]);

		expect(outcome.weights.price_shape).toBe(0);
		expect(outcome.warnings.some((w) => /clamp/i.test(w))).toBe(true);
	});

	it('never produces a negative weight regardless of how strongly one-sided the feedback is', () => {
		const outcome = refineWeights(
			EQUAL,
			[],
			[{ price_shape: 1 }, { price_shape: 1 }, { price_shape: 1 }]
		);

		for (const value of Object.values(outcome.weights)) {
			expect(value).toBeGreaterThanOrEqual(0);
		}
	});

	it('warns when the feedback set is small relative to the six feature families', () => {
		const outcome = refineWeights(EQUAL, [{ price_shape: 1 }], []);

		expect(outcome.warnings.some((w) => /small feedback set/i.test(w))).toBe(true);
	});

	it('does not warn about a small feedback set once judgments reach the family count', () => {
		const accepted = Array.from({ length: 6 }, () => ({ price_shape: 0.8 }));
		const outcome = refineWeights(EQUAL, accepted, []);

		expect(outcome.warnings.some((w) => /small feedback set/i.test(w))).toBe(false);
	});

	it('a family absent from every judged match is left unchanged, not treated as a measured zero', () => {
		const outcome = refineWeights(EQUAL, [{ price_shape: 0.9 }], [{ price_shape: 0.1 }]);

		expect(outcome.weights.studies).toBe(EQUAL.studies);
	});

	it('bounds how far a single refinement can move a weight even with maximal delta', () => {
		const outcome = refineWeights(EQUAL, [{ price_shape: 1 }], [{ price_shape: 0 }]);

		expect(outcome.weights.price_shape - EQUAL.price_shape).toBeLessThanOrEqual(0.15 + 1e-9);
	});
});
