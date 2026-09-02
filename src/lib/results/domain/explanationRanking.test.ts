import { describe, expect, it } from 'vitest';
import type { RankingNormalization } from '../../screener/definition';
import {
	buildRankingExplanation,
	computeRankingFieldContribution,
	type RankingFieldContribution
} from './explanationRanking';

describe('computeRankingFieldContribution and buildRankingExplanation', () => {
	const field = { fieldId: 'market_cap', weight: 2, direction: 'desc' as const };

	it('reports null across the board when the raw value is unavailable', () => {
		const result = computeRankingFieldContribution(null, [1, 2, 3], field, 'percentile_rank');
		expect(result.rawValue).toBe(null);
		expect(result.normalizedValue).toBe(null);
		expect(result.contribution).toBe(null);
		expect(result.weight).toBe(2);
	});

	// percentile_rank = (count strictly below + half the ties) / n -- the top
	// of a 3-element set [1, 5, 10] lands at (2 + 0.5) / 3, not 1, since a tie
	// with itself counts as half.
	it.each<[RankingFieldContribution['direction'], number]>([
		['desc', 2.5 / 3],
		['asc', 1 - 2.5 / 3]
	])(
		'percentile_rank: top-of-set value with direction %s contributes as expected',
		(direction, expectedContribution) => {
			const result = computeRankingFieldContribution(
				10,
				[1, 5, 10],
				{ fieldId: 'f', weight: 1, direction },
				'percentile_rank'
			);
			expect(
				result.normalizedValue,
				`expected top value's percentile rank to be 2.5/3`
			).toBeCloseTo(2.5 / 3, 10);
			expect(result.contribution).toBeCloseTo(expectedContribution, 10);
		}
	);

	it('min_max normalizes the top value to 1 and the bottom to 0', () => {
		const top = computeRankingFieldContribution(10, [0, 5, 10], field, 'min_max');
		const bottom = computeRankingFieldContribution(0, [0, 5, 10], field, 'min_max');
		expect(top.normalizedValue).toBe(1);
		expect(bottom.normalizedValue).toBe(0);
	});

	it('z_score normalizes the mean to 0', () => {
		const result = computeRankingFieldContribution(5, [0, 5, 10], field, 'z_score');
		expect(result.normalizedValue).toBeCloseTo(0, 10);
	});

	// AC7's property test: for a synthetic matched set with mixed weights,
	// directions and every normalization method, the composite score built
	// from per-field contributions always equals their sum -- not just for
	// one hand-picked example.
	it.each<RankingNormalization>(['percentile_rank', 'z_score', 'min_max'])(
		'composite score equals the sum of contributions under %s for every instrument',
		(method) => {
			const fields = [
				{ fieldId: 'momentum', weight: 3, direction: 'desc' as const },
				{ fieldId: 'volatility', weight: 1.5, direction: 'asc' as const },
				{ fieldId: 'value_score', weight: 2, direction: 'desc' as const }
			];
			const rawByInstrument: Record<string, Record<string, number | null>> = {
				AAA: { momentum: 12, volatility: 0.4, value_score: 7 },
				BBB: { momentum: 3, volatility: 0.9, value_score: 2 },
				CCC: { momentum: 8, volatility: 0.1, value_score: 5 },
				DDD: { momentum: 20, volatility: null, value_score: 9 },
				EEE: { momentum: 1, volatility: 0.3, value_score: 1 }
			};
			const peerValuesByField: Record<string, number[]> = {};
			for (const rankingField of fields) {
				peerValuesByField[rankingField.fieldId] = Object.values(rawByInstrument)
					.map((raw) => raw[rankingField.fieldId])
					.filter((v): v is number => v !== null);
			}

			for (const [instrumentId, raw] of Object.entries(rawByInstrument)) {
				const explanation = buildRankingExplanation(fields, raw, peerValuesByField, method);
				const summed = explanation.fields.reduce((sum, f) => sum + (f.contribution ?? 0), 0);
				expect(
					explanation.compositeScore,
					`instrument ${instrumentId}: compositeScore ${explanation.compositeScore} should equal ` +
						`the sum of its contributions ${summed}`
				).toBeCloseTo(summed, 10);
			}
		}
	);
});
