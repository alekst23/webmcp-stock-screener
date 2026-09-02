import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../../catalog/types';
import type { CatalogRegistry } from '../../catalog/registry';
import type { ScreenerMarketData, SeriesPoint } from '../ports';
import { evaluateCondition, type ConditionEvalDeps } from './conditionEvaluation';

function available(id: string, kind: CatalogItem['kind'] = 'field'): CatalogItem {
	return {
		id,
		kind,
		label: id,
		description: id,
		aliases: [],
		tags: [],
		availability: {
			status: 'available',
			intervalIds: ['interval.1d'],
			requiresReferenceData: false
		},
		...(kind === 'field'
			? { valueType: 'number', nullable: true }
			: kind === 'operator'
				? { arity: 2, operandTypes: ['number'], resultType: 'boolean', conditionFamily: 'scalar' }
				: {
						parameters: [],
						outputs: [{ name: 'value', valueType: 'number' }],
						defaultIntervalId: 'interval.1d'
					})
	} as CatalogItem;
}

function unavailable(id: string, kind: CatalogItem['kind'] = 'field'): CatalogItem {
	const item = available(id, kind);
	return {
		...item,
		availability: {
			status: 'unavailable',
			intervalIds: [],
			requiresReferenceData: false,
			reason: `${id} is not wired up.`
		}
	} as CatalogItem;
}

function makeRegistry(items: CatalogItem[]): CatalogRegistry {
	const byId = new Map(items.map((item) => [item.id, item]));
	return {
		getCatalogItem: (id) => byId.get(id),
		listCatalogItems: () => items,
		searchCatalogItems: () => [],
		isOperatorValidForField: () => ({ valid: true }),
		resolveStudy: () => undefined,
		suggestCatalogIds: () => []
	};
}

function makeMarketData(overrides: Partial<ScreenerMarketData> = {}): ScreenerMarketData {
	return {
		async resolveUniverse() {
			return [];
		},
		async getFieldValue() {
			return null;
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
			throw new Error('getProvenance is not exercised by conditionEvaluation tests');
		},
		...overrides
	};
}

function series(values: number[]): SeriesPoint[] {
	return values.map((value, index) => ({
		timestamp: `2024-01-${String(index + 1).padStart(2, '0')}`,
		value
	}));
}

function makeDeps(registry: CatalogRegistry, marketData: ScreenerMarketData): ConditionEvalDeps {
	return { registry, marketData, now: () => new Date('2024-06-01T00:00:00Z') };
}

describe('evaluateCondition scalar', () => {
	it('test_scalar_valueAboveThreshold_passes', async () => {
		const registry = makeRegistry([available('field.price')]);
		const marketData = makeMarketData({
			async getFieldValue() {
				return 120;
			}
		});
		const result = await evaluateCondition(
			{
				type: 'scalar',
				fieldId: 'field.price',
				operator: 'op.greater_than',
				value: 100,
				unit: 'usd'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(result.passed, `Expected 120 > 100 to pass: ${JSON.stringify(result)}`).toBe(true);
		expect(result.value, 'Expected the raw field value to be retained').toBe(120);
	});

	it('test_scalar_unavailableCatalogItem_reportsDataUnavailableAndDoesNotPass', async () => {
		const registry = makeRegistry([unavailable('field.price')]);
		const marketData = makeMarketData();
		const result = await evaluateCondition(
			{
				type: 'scalar',
				fieldId: 'field.price',
				operator: 'op.greater_than',
				value: 100,
				unit: null
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.dataUnavailable,
			'An unavailable catalog item must be flagged, never silently passed'
		).toBe(true);
		expect(result.passed, 'dataUnavailable must never imply passed: true').toBe(false);
	});

	it('test_scalar_nullFieldReadOnAvailableItem_reportsDataUnavailable', async () => {
		const registry = makeRegistry([available('field.price')]);
		const marketData = makeMarketData({
			async getFieldValue() {
				return null;
			}
		});
		const result = await evaluateCondition(
			{
				type: 'scalar',
				fieldId: 'field.price',
				operator: 'op.greater_than',
				value: 100,
				unit: null
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.dataUnavailable,
			'A per-instrument null read on an available field is unavailable'
		).toBe(true);
	});
});

describe('evaluateCondition range', () => {
	it('test_range_valueWithinInclusiveBounds_passes', async () => {
		const registry = makeRegistry([available('field.rsi')]);
		const marketData = makeMarketData({
			async getFieldValue() {
				return 50;
			}
		});
		const result = await evaluateCondition(
			{
				type: 'range',
				fieldId: 'field.rsi',
				lower: 40,
				upper: 70,
				lowerInclusive: true,
				upperInclusive: true
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(result.passed, `Expected 50 within [40, 70] to pass: ${JSON.stringify(result)}`).toBe(
			true
		);
	});

	it('test_range_valueOutsideBounds_fails', async () => {
		const registry = makeRegistry([available('field.rsi')]);
		const marketData = makeMarketData({
			async getFieldValue() {
				return 90;
			}
		});
		const result = await evaluateCondition(
			{
				type: 'range',
				fieldId: 'field.rsi',
				lower: 40,
				upper: 70,
				lowerInclusive: true,
				upperInclusive: true
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(result.passed, `Expected 90 outside [40, 70] to fail: ${JSON.stringify(result)}`).toBe(
			false
		);
	});
});

describe('evaluateCondition series_comparison', () => {
	it('test_seriesComparison_crossesAbove_passesOnRisingEdge', async () => {
		const registry = makeRegistry([
			available('study.sma50', 'study'),
			available('study.sma200', 'study')
		]);
		const marketData = makeMarketData({
			async getSeries(_id, catalogId) {
				return catalogId === 'study.sma50' ? series([10, 12]) : series([11, 11]);
			}
		});
		const result = await evaluateCondition(
			{
				type: 'series_comparison',
				left: { catalogId: 'study.sma50', params: {} },
				right: { catalogId: 'study.sma200', params: {} },
				operator: 'op.crosses_above'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(result.passed, `Expected sma50 crossing above sma200: ${JSON.stringify(result)}`).toBe(
			true
		);
	});

	it('test_seriesComparison_fewerThanTwoBars_reportsDataUnavailable', async () => {
		const registry = makeRegistry([
			available('study.sma50', 'study'),
			available('study.sma200', 'study')
		]);
		const marketData = makeMarketData({
			async getSeries() {
				return series([10]);
			}
		});
		const result = await evaluateCondition(
			{
				type: 'series_comparison',
				left: { catalogId: 'study.sma50', params: {} },
				right: { catalogId: 'study.sma200', params: {} },
				operator: 'op.crosses_above'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(result.dataUnavailable, 'Fewer than two bars cannot establish a crossing').toBe(true);
	});
});

describe('evaluateCondition temporal', () => {
	it('test_temporal_scalarInner_becameTrueWithinWindow_passes', async () => {
		const registry = makeRegistry([available('field.close')]);
		const marketData = makeMarketData({
			async getSeries() {
				return series([90, 95, 101, 98]);
			}
		});
		const result = await evaluateCondition(
			{
				type: 'temporal',
				condition: {
					type: 'scalar',
					fieldId: 'field.close',
					operator: 'op.greater_than',
					value: 100,
					unit: null
				},
				event: 'became_true',
				withinBars: 3,
				intervalId: 'interval.1d'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.passed,
			`Expected a bar above 100 within the trailing window: ${JSON.stringify(result)}`
		).toBe(true);
	});

	it('test_temporal_scalarInner_crossedAboveOutsideWindow_fails', async () => {
		const registry = makeRegistry([available('field.close')]);
		// The rising edge is between index 0 and 1, outside a trailing window of 1.
		const marketData = makeMarketData({
			async getSeries() {
				return series([90, 101, 102, 103]);
			}
		});
		const result = await evaluateCondition(
			{
				type: 'temporal',
				condition: {
					type: 'scalar',
					fieldId: 'field.close',
					operator: 'op.greater_than',
					value: 100,
					unit: null
				},
				event: 'crossed_above',
				withinBars: 1,
				intervalId: 'interval.1d'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.passed,
			`Expected no rising edge within a 1-bar trailing window: ${JSON.stringify(result)}`
		).toBe(false);
	});

	it('test_temporal_unsupportedInnerType_reportsDataUnavailable', async () => {
		const registry = makeRegistry([available('pattern.bull_flag', 'pattern')]);
		const marketData = makeMarketData();
		const result = await evaluateCondition(
			{
				type: 'temporal',
				condition: {
					type: 'pattern',
					patternId: 'pattern.bull_flag',
					minConfidence: 0.5,
					intervalId: 'interval.1d'
				},
				event: 'became_true',
				withinBars: 5,
				intervalId: 'interval.1d'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.dataUnavailable,
			'A nested pattern condition has no derivable per-point series'
		).toBe(true);
	});
});

describe('evaluateCondition event_relative', () => {
	it('test_eventRelative_dateWithinFutureWindow_passes', async () => {
		const registry = makeRegistry([available('field.earnings.next_report_date')]);
		const marketData = makeMarketData({
			async getFieldValue() {
				return '2024-06-15T00:00:00Z';
			}
		});
		const result = await evaluateCondition(
			{
				type: 'event_relative',
				eventTypeId: 'field.earnings.next_report_date',
				direction: 'future',
				windowDays: 30
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.passed,
			`Expected an earnings date 14 days out to fall within a 30-day window: ${JSON.stringify(result)}`
		).toBe(true);
	});

	it('test_eventRelative_unparsableValue_reportsDataUnavailable', async () => {
		const registry = makeRegistry([available('field.earnings.next_report_date')]);
		const marketData = makeMarketData({
			async getFieldValue() {
				return 'not-a-date';
			}
		});
		const result = await evaluateCondition(
			{
				type: 'event_relative',
				eventTypeId: 'field.earnings.next_report_date',
				direction: 'future',
				windowDays: 30
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.dataUnavailable,
			'An unparsable event value must be reported unavailable, not skipped'
		).toBe(true);
	});
});

describe('evaluateCondition pattern', () => {
	it('test_pattern_confidenceAboveThreshold_passes', async () => {
		const registry = makeRegistry([available('pattern.bull_flag', 'pattern')]);
		const marketData = makeMarketData({
			async detectPattern() {
				return { confidence: 0.9 };
			}
		});
		const result = await evaluateCondition(
			{
				type: 'pattern',
				patternId: 'pattern.bull_flag',
				minConfidence: 0.75,
				intervalId: 'interval.1d'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.passed,
			`Expected confidence 0.9 >= 0.75 to pass: ${JSON.stringify(result)}`
		).toBe(true);
	});

	it('test_pattern_unavailableCatalogItem_reportsDataUnavailable', async () => {
		const registry = makeRegistry([unavailable('pattern.bull_flag', 'pattern')]);
		const marketData = makeMarketData();
		const result = await evaluateCondition(
			{
				type: 'pattern',
				patternId: 'pattern.bull_flag',
				minConfidence: 0.75,
				intervalId: 'interval.1d'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.dataUnavailable,
			'A pattern with no engine wired up must be reported unavailable'
		).toBe(true);
	});

	it('test_pattern_noDetectionOnAvailableEngine_failsWithoutDataUnavailable', async () => {
		const registry = makeRegistry([available('pattern.bull_flag', 'pattern')]);
		const marketData = makeMarketData({
			async detectPattern() {
				return null;
			}
		});
		const result = await evaluateCondition(
			{
				type: 'pattern',
				patternId: 'pattern.bull_flag',
				minConfidence: 0.75,
				intervalId: 'interval.1d'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(result.passed, 'A genuine non-match must fail').toBe(false);
		expect(result.dataUnavailable, 'A genuine non-match is not a data-unavailable case').toBe(
			false
		);
	});
});

describe('evaluateCondition relative', () => {
	it('test_relative_ownMovingAverageBaseline_multipleExceeded_passes', async () => {
		const registry = makeRegistry([available('field.volume')]);
		const marketData = makeMarketData({
			async getFieldValue(_id, fieldId) {
				return fieldId === 'field.volume' ? 3_000_000 : null;
			},
			async getSeries() {
				return series([1_000_000, 1_000_000]);
			}
		});
		const result = await evaluateCondition(
			{
				type: 'relative',
				fieldId: 'field.volume',
				baseline: { kind: 'own_moving_average', windowBars: 20 },
				multiple: 1.5,
				operator: 'op.greater_than'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.passed,
			`Expected volume at 3x its average to exceed a 1.5x multiple: ${JSON.stringify(result)}`
		).toBe(true);
	});

	it('test_relative_zeroBaseline_reportsDataUnavailable', async () => {
		const registry = makeRegistry([available('field.volume')]);
		const marketData = makeMarketData({
			async getFieldValue() {
				return 3_000_000;
			},
			async getSeries() {
				return series([0, 0]);
			}
		});
		const result = await evaluateCondition(
			{
				type: 'relative',
				fieldId: 'field.volume',
				baseline: { kind: 'own_moving_average', windowBars: 20 },
				multiple: 1.5,
				operator: 'op.greater_than'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.dataUnavailable,
			'A zero baseline makes the multiple undefined, not falsely failing'
		).toBe(true);
	});
});

describe('evaluateCondition study_output', () => {
	it('test_studyOutput_positiveAndRising_passes', async () => {
		const registry = makeRegistry([available('study.macd', 'study')]);
		const marketData = makeMarketData({
			async getStudyOutput() {
				return 0.5;
			},
			async getSeries() {
				return series([0.2, 0.5]);
			}
		});
		const result = await evaluateCondition(
			{
				type: 'study_output',
				studyId: 'study.macd',
				params: {},
				outputName: 'histogram',
				predicate: 'positive_and_rising'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.passed,
			`Expected a positive, rising histogram to pass: ${JSON.stringify(result)}`
		).toBe(true);
	});

	it('test_studyOutput_nullOutput_reportsDataUnavailable', async () => {
		const registry = makeRegistry([available('study.macd', 'study')]);
		const marketData = makeMarketData({
			async getStudyOutput() {
				return null;
			}
		});
		const result = await evaluateCondition(
			{
				type: 'study_output',
				studyId: 'study.macd',
				params: {},
				outputName: 'histogram',
				predicate: 'positive'
			},
			'AAPL',
			makeDeps(registry, marketData)
		);
		expect(
			result.dataUnavailable,
			'A missing study output must be reported unavailable, not failed silently'
		).toBe(true);
	});
});
