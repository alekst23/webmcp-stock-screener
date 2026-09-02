// T-1012-1: contract.ts -- the shared feature/scoring contract, tested in
// isolation before any engine reads real price data.
import { describe, expect, it } from 'vitest';
import {
	explanationReconciles,
	FEATURE_FAMILIES,
	makeFeatureWeightSet,
	perFamilySimilarity,
	reconciles,
	scoreCandidate,
	SimilarityWeightError,
	toExplanation,
	type FeatureVector
} from './contract';

function vectors(): { reference: FeatureVector; candidate: FeatureVector } {
	return {
		reference: {
			price_shape: [1, 0, 0],
			volume: [0, 1, 0],
			volatility: [0, 0, 1]
		},
		candidate: {
			price_shape: [1, 0, 0],
			volume: [0, 1, 0],
			volatility: [1, 0, 0]
		}
	};
}

describe('makeFeatureWeightSet', () => {
	it('defaults to equal weight across all six families', () => {
		const weights = makeFeatureWeightSet();

		expect(Object.keys(weights)).toHaveLength(6);
		for (const family of FEATURE_FAMILIES) {
			expect(weights[family]).toBeCloseTo(1 / 6);
		}
	});

	it('fills unspecified families with the default while keeping supplied ones', () => {
		const weights = makeFeatureWeightSet({ price_shape: 0.5 });

		expect(weights.price_shape).toBe(0.5);
		expect(weights.volume).toBeCloseTo(1 / 6);
	});

	it('round-trips through reconstruction', () => {
		const original = makeFeatureWeightSet({ price_shape: 0.9, volume: 0.1 });
		const rebuilt = makeFeatureWeightSet(original);

		expect(rebuilt).toEqual(original);
	});

	it('rejects an unknown family name, naming the entry', () => {
		expect(() => makeFeatureWeightSet({ not_a_real_family: 0.5 })).toThrow(SimilarityWeightError);
		expect(() => makeFeatureWeightSet({ not_a_real_family: 0.5 })).toThrow(/not_a_real_family/);
	});

	it('rejects a negative weight, naming the entry', () => {
		expect(() => makeFeatureWeightSet({ volume: -0.1 })).toThrow(/volume/);
	});

	it('rejects an all-zero weight set as unnormalizable', () => {
		const allZero = Object.fromEntries(FEATURE_FAMILIES.map((f) => [f, 0]));
		expect(() => makeFeatureWeightSet(allZero)).toThrow(/normalized/);
	});
});

describe('perFamilySimilarity', () => {
	it('scores identical vectors as maximally similar', () => {
		expect(perFamilySimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
	});

	it('scores opposite vectors as minimally similar', () => {
		expect(perFamilySimilarity([1, 0], [-1, 0])).toBeCloseTo(0);
	});

	it('rejects mismatched lengths', () => {
		expect(() => perFamilySimilarity([1, 2], [1])).toThrow(/length/);
	});

	it('rejects empty vectors', () => {
		expect(() => perFamilySimilarity([], [])).toThrow(/empty/);
	});
});

describe('scoreCandidate', () => {
	it('reconciles contributions to the overall score with uniform weights', () => {
		const { reference, candidate } = vectors();
		const weights = makeFeatureWeightSet({ price_shape: 1 / 3, volume: 1 / 3, volatility: 1 / 3 });

		const score = scoreCandidate(reference, candidate, weights);

		expect(reconciles(score)).toBe(true);
	});

	it('reconciles contributions to the overall score with non-uniform weights', () => {
		// A non-uniform weight set is the case a uniform-weight fixture could
		// pass by coincidence -- this exercises the per-family renormalization.
		const { reference, candidate } = vectors();
		const weights = makeFeatureWeightSet({ price_shape: 0.7, volume: 0.2, volatility: 0.1 });

		const score = scoreCandidate(reference, candidate, weights);

		expect(reconciles(score)).toBe(true);
		const uniformScore = scoreCandidate(reference, candidate, makeFeatureWeightSet());
		expect(score.overall).not.toBeCloseTo(uniformScore.overall, 9);
	});

	it('excludes an unavailable family rather than scoring it as zero', () => {
		const reference: FeatureVector = { price_shape: [1, 0], volume: [0, 1] };
		const candidate: FeatureVector = { price_shape: [1, 0] };
		const weights = makeFeatureWeightSet({ price_shape: 0.5, volume: 0.5 });

		const score = scoreCandidate(reference, candidate, weights);

		expect(score.unavailableFamilies).toContain('volume');
		expect(score.unavailableFamilies).not.toContain('price_shape');
		expect(score.contributions.volume).toBeUndefined();
		expect(reconciles(score)).toBe(true);
		expect(score.overall).toBeCloseTo(1);
	});

	it('throws when no family is available in both vectors', () => {
		const reference: FeatureVector = { price_shape: [1] };
		const candidate: FeatureVector = { volume: [1] };

		expect(() => scoreCandidate(reference, candidate, makeFeatureWeightSet())).toThrow(/available/);
	});
});

describe('toExplanation', () => {
	it('reconciles and never disagrees with the score it was built from', () => {
		const { reference, candidate } = vectors();
		const weights = makeFeatureWeightSet({ price_shape: 0.6, volume: 0.3, volatility: 0.1 });
		const score = scoreCandidate(reference, candidate, weights);

		const explanation = toExplanation('run_similarity_1_candidate_1', score);

		expect(explanationReconciles(explanation)).toBe(true);
		expect(explanation.overallScore).toBe(score.overall);
		expect(explanation.candidateId).toBe('run_similarity_1_candidate_1');
	});
});
