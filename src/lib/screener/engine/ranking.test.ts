import { describe, expect, it } from 'vitest';
import type { RankingSpec } from '../definition';
import type { ScreenerMarketData } from '../ports';
import { applyRanking } from './ranking';

function makeMarketData(
	fieldsByInstrument: Record<string, Record<string, number | null>>
): ScreenerMarketData {
	return {
		async resolveUniverse() {
			return [];
		},
		async getFieldValue(instrumentId, fieldId) {
			return fieldsByInstrument[instrumentId]?.[fieldId] ?? null;
		},
		async getSeries() {
			return [];
		},
		async detectPattern() {
			return null;
		},
		async getStudyOutput() {
			return null;
		},
		async getProvenance() {
			throw new Error('getProvenance is not exercised by ranking tests');
		}
	};
}

describe('applyRanking with no ranking set (AC6)', () => {
	it('test_noRanking_ordersByInstrumentIdAscending_andReportsNotApplied', async () => {
		const marketData = makeMarketData({});
		const outcome = await applyRanking(['MSFT', 'AAPL', 'GOOG'], null, marketData);
		expect(outcome.rankingApplied, 'Expected rankingApplied: false with no ranking set').toBe(
			false
		);
		expect(outcome.normalization, 'Expected no normalization to be reported').toBeNull();
		expect(
			outcome.ranked.map((r) => r.instrumentId),
			'Expected the documented default order: instrument ID ascending'
		).toEqual(['AAPL', 'GOOG', 'MSFT']);
		expect(outcome.ranked[0]?.compositeScore, 'No ranking means no composite score').toBeNull();
	});
});

describe('applyRanking single field (AC5)', () => {
	it('test_singleField_descending_ordersHighestFirst', async () => {
		const marketData = makeMarketData({
			AAPL: { 'field.price': 150 },
			MSFT: { 'field.price': 300 },
			GOOG: { 'field.price': 100 }
		});
		const ranking: RankingSpec = {
			fields: [{ fieldId: 'field.price', direction: 'desc', weight: 1 }],
			tieBreak: null,
			limit: 100,
			normalization: 'percentile_rank'
		};
		const outcome = await applyRanking(['AAPL', 'MSFT', 'GOOG'], ranking, marketData);
		expect(
			outcome.ranked.map((r) => r.instrumentId),
			'Expected descending order by price'
		).toEqual(['MSFT', 'AAPL', 'GOOG']);
		expect(outcome.rankingApplied, 'A single-field ranking is still an applied ranking').toBe(true);
	});

	it('test_singleField_ascending_ordersLowestFirst', async () => {
		const marketData = makeMarketData({
			AAPL: { 'field.price': 150 },
			MSFT: { 'field.price': 300 },
			GOOG: { 'field.price': 100 }
		});
		const ranking: RankingSpec = {
			fields: [{ fieldId: 'field.price', direction: 'asc', weight: 1 }],
			tieBreak: null,
			limit: 100,
			normalization: 'percentile_rank'
		};
		const outcome = await applyRanking(['AAPL', 'MSFT', 'GOOG'], ranking, marketData);
		expect(
			outcome.ranked.map((r) => r.instrumentId),
			'Expected ascending order by price'
		).toEqual(['GOOG', 'AAPL', 'MSFT']);
	});
});

describe('applyRanking weighted composite across normalization modes', () => {
	const instruments = ['AAPL', 'MSFT', 'GOOG'];
	const marketData = makeMarketData({
		AAPL: { 'field.momentum': 10, 'field.volume': 5 },
		MSFT: { 'field.momentum': 20, 'field.volume': 1 },
		GOOG: { 'field.momentum': 5, 'field.volume': 9 }
	});

	for (const normalization of ['percentile_rank', 'z_score', 'min_max'] as const) {
		it(`test_weightedFields_${normalization}_favorsHigherMomentumOverHigherWeight`, async () => {
			const ranking: RankingSpec = {
				fields: [
					{ fieldId: 'field.momentum', direction: 'desc', weight: 0.8 },
					{ fieldId: 'field.volume', direction: 'asc', weight: 0.2 }
				],
				tieBreak: null,
				limit: 100,
				normalization
			};
			const outcome = await applyRanking(instruments, ranking, marketData);
			expect(
				outcome.ranked[0]?.instrumentId,
				`Expected the heavily-weighted momentum leader to rank first under ${normalization}: ${JSON.stringify(outcome.ranked)}`
			).toBe('MSFT');
			expect(outcome.normalization, 'Expected the applied normalization to be reported').toBe(
				normalization
			);
		});
	}
});

describe('applyRanking tie-break (AC5)', () => {
	it('test_tieBreak_resolvesEqualCompositeScores', async () => {
		const marketData = makeMarketData({
			AAPL: { 'field.momentum': 10, 'field.marketCap': 500 },
			MSFT: { 'field.momentum': 10, 'field.marketCap': 900 }
		});
		const ranking: RankingSpec = {
			fields: [{ fieldId: 'field.momentum', direction: 'desc', weight: 1 }],
			tieBreak: { fieldId: 'field.marketCap', direction: 'desc' },
			limit: 100,
			normalization: 'percentile_rank'
		};
		const outcome = await applyRanking(['AAPL', 'MSFT'], ranking, marketData);
		expect(
			outcome.ranked.map((r) => r.instrumentId),
			'Expected the tie-break field to decide the equal-score tie'
		).toEqual(['MSFT', 'AAPL']);
	});
});

describe('applyRanking unavailable field values', () => {
	it('test_nullRawValue_isExcludedFromCompositeAndReportedUnavailable', async () => {
		const marketData = makeMarketData({
			AAPL: { 'field.momentum': 10 },
			MSFT: { 'field.momentum': null }
		});
		const ranking: RankingSpec = {
			fields: [{ fieldId: 'field.momentum', direction: 'desc', weight: 1 }],
			tieBreak: null,
			limit: 100,
			normalization: 'percentile_rank'
		};
		const outcome = await applyRanking(['AAPL', 'MSFT'], ranking, marketData);
		expect(
			outcome.unavailableFieldIds,
			'Expected the field with a null value reported unavailable'
		).toContain('field.momentum');
		const msft = outcome.ranked.find((r) => r.instrumentId === 'MSFT');
		expect(
			msft?.rankingValues['field.momentum'],
			'A null raw value must round-trip as null, not a guess'
		).toBeNull();
	});
});

describe('applyRanking determinism (AC7)', () => {
	it('test_repeatedApplyRanking_sameData_producesIdenticalOrder', async () => {
		const marketData = makeMarketData({
			AAPL: { 'field.momentum': 10 },
			MSFT: { 'field.momentum': 20 },
			GOOG: { 'field.momentum': 10 }
		});
		const ranking: RankingSpec = {
			fields: [{ fieldId: 'field.momentum', direction: 'desc', weight: 1 }],
			tieBreak: null,
			limit: 100,
			normalization: 'percentile_rank'
		};
		const first = await applyRanking(['AAPL', 'MSFT', 'GOOG'], ranking, marketData);
		const second = await applyRanking(['AAPL', 'MSFT', 'GOOG'], ranking, marketData);
		expect(
			second.ranked.map((r) => r.instrumentId),
			'Expected identical order across repeated evaluations of the same data'
		).toEqual(first.ranked.map((r) => r.instrumentId));
	});
});
