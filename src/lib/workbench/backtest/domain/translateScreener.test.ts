import { describe, expect, it } from 'vitest';
import type { Condition } from '../../../screener/conditions';
import { emptyUniverse, type FilterNode, type UniverseSpec } from '../../../screener/definition';
import type { GroupNode as TsGroupNode } from '../../../screener/definition';
import { translateCondition, translateFilterNode, translateUniverse } from './translateScreener';

describe('translateCondition', () => {
	it('translates a scalar condition field-for-field, camelCase to snake_case', () => {
		const condition: Condition = {
			type: 'scalar',
			fieldId: 'rsi_14',
			operator: 'gt',
			value: 70,
			unit: 'percent'
		};

		expect(translateCondition(condition)).toEqual({
			type: 'scalar',
			field_id: 'rsi_14',
			operator: 'gt',
			value: 70,
			unit: 'percent'
		});
	});

	it('translates a range condition', () => {
		const condition: Condition = {
			type: 'range',
			fieldId: 'pe_ratio',
			lower: 5,
			upper: 20,
			lowerInclusive: true,
			upperInclusive: false
		};

		expect(translateCondition(condition)).toEqual({
			type: 'range',
			field_id: 'pe_ratio',
			lower: 5,
			upper: 20,
			lower_inclusive: true,
			upper_inclusive: false
		});
	});

	it('translates a series_comparison condition, including both SeriesRefs', () => {
		const condition: Condition = {
			type: 'series_comparison',
			left: { catalogId: 'close', params: {} },
			right: { catalogId: 'sma', params: { window: 20 } },
			operator: 'gt'
		};

		expect(translateCondition(condition)).toEqual({
			type: 'series_comparison',
			left: { catalog_id: 'close', params: {} },
			right: { catalog_id: 'sma', params: { window: 20 } },
			operator: 'gt'
		});
	});

	it('translates a temporal condition, recursing into its inner condition', () => {
		const condition: Condition = {
			type: 'temporal',
			condition: { type: 'scalar', fieldId: 'close', operator: 'gt', value: 10, unit: null },
			event: 'crossed_above',
			withinBars: 5,
			intervalId: 'daily'
		};

		expect(translateCondition(condition)).toEqual({
			type: 'temporal',
			condition: { type: 'scalar', field_id: 'close', operator: 'gt', value: 10, unit: null },
			event: 'crossed_above',
			within_bars: 5,
			interval_id: 'daily'
		});
	});

	it('translates an event_relative condition', () => {
		const condition: Condition = {
			type: 'event_relative',
			eventTypeId: 'earnings',
			direction: 'future',
			windowDays: 5
		};

		expect(translateCondition(condition)).toEqual({
			type: 'event_relative',
			event_type_id: 'earnings',
			direction: 'future',
			window_days: 5
		});
	});

	it('translates a pattern condition', () => {
		const condition: Condition = {
			type: 'pattern',
			patternId: 'flag',
			minConfidence: 0.8,
			intervalId: 'daily'
		};

		expect(translateCondition(condition)).toEqual({
			type: 'pattern',
			pattern_id: 'flag',
			min_confidence: 0.8,
			interval_id: 'daily'
		});
	});

	it('translates a relative condition with an own_moving_average baseline', () => {
		const condition: Condition = {
			type: 'relative',
			fieldId: 'volume',
			baseline: { kind: 'own_moving_average', windowBars: 20 },
			multiple: 1.5,
			operator: 'gt'
		};

		expect(translateCondition(condition)).toEqual({
			type: 'relative',
			field_id: 'volume',
			baseline: { kind: 'own_moving_average', window_bars: 20 },
			multiple: 1.5,
			operator: 'gt'
		});
	});

	it('translates a relative condition with a peer_group baseline', () => {
		const condition: Condition = {
			type: 'relative',
			fieldId: 'volume',
			baseline: { kind: 'peer_group', groupId: 'tech' },
			multiple: 1.5,
			operator: 'gt'
		};

		expect(translateCondition(condition)).toEqual(
			expect.objectContaining({ baseline: { kind: 'peer_group', group_id: 'tech' } })
		);
	});

	it('translates a relative condition with an index baseline', () => {
		const condition: Condition = {
			type: 'relative',
			fieldId: 'volume',
			baseline: { kind: 'index', indexId: 'spx' },
			multiple: 1.5,
			operator: 'gt'
		};

		expect(translateCondition(condition)).toEqual(
			expect.objectContaining({ baseline: { kind: 'index', index_id: 'spx' } })
		);
	});

	it('translates a study_output condition', () => {
		const condition: Condition = {
			type: 'study_output',
			studyId: 'custom_1',
			params: { length: 10 },
			outputName: 'signal',
			predicate: 'gt_zero'
		};

		expect(translateCondition(condition)).toEqual({
			type: 'study_output',
			study_id: 'custom_1',
			params: { length: 10 },
			output_name: 'signal',
			predicate: 'gt_zero'
		});
	});
});

describe('translateFilterNode', () => {
	it('translates a group node, preserving nodeId/op/enabled and recursing into children', () => {
		const tree: FilterNode = {
			nodeId: 'root',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [
				{
					nodeId: 'c1',
					kind: 'condition',
					enabled: true,
					condition: { type: 'scalar', fieldId: 'close', operator: 'gt', value: 10, unit: null }
				}
			]
		} satisfies TsGroupNode;

		expect(translateFilterNode(tree)).toEqual({
			node_id: 'root',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [
				{
					node_id: 'c1',
					kind: 'condition',
					enabled: true,
					condition: { type: 'scalar', field_id: 'close', operator: 'gt', value: 10, unit: null }
				}
			]
		});
	});

	it('translates a disabled node, preserving enabled: false', () => {
		const node: FilterNode = {
			nodeId: 'c1',
			kind: 'condition',
			enabled: false,
			condition: { type: 'scalar', fieldId: 'close', operator: 'gt', value: 10, unit: null }
		};

		expect(translateFilterNode(node)).toEqual(
			expect.objectContaining({ node_id: 'c1', enabled: false })
		);
	});
});

describe('translateUniverse', () => {
	function universe(overrides: Partial<UniverseSpec> = {}): UniverseSpec {
		return { ...emptyUniverse(), ...overrides };
	}

	it('maps liquidity limits and exclusions with no dropped criteria on an empty universe', () => {
		const { universe: wire, droppedCriteria } = translateUniverse(
			universe({
				liquidity: { minPrice: 5, minAverageVolume: 100000, minMarketCap: 1e9 },
				exclusions: { instrumentIds: ['AAA'], sectorIds: [], industryIds: [] }
			}),
			'scr_1_universe',
			'My screener'
		);

		expect(wire).toEqual({
			universe_id: 'scr_1_universe',
			label: 'My screener',
			tickers: null,
			min_price: 5,
			min_avg_volume: 100000,
			min_market_cap: 1e9,
			excluded_tickers: ['AAA']
		});
		expect(droppedCriteria).toEqual([]);
	});

	it('reports assetClass as a dropped criterion when set', () => {
		const { droppedCriteria } = translateUniverse(universe({ assetClass: 'equity' }), 'u1', 'l');
		expect(droppedCriteria).toContain('universe.assetClass');
	});

	it('reports exchanges as a dropped criterion when non-empty', () => {
		const { droppedCriteria } = translateUniverse(universe({ exchanges: ['NASDAQ'] }), 'u1', 'l');
		expect(droppedCriteria).toContain('universe.exchanges');
	});

	it('reports sectors, industries, indexes, countries and watchlists as dropped when set', () => {
		const { droppedCriteria } = translateUniverse(
			universe({
				sectors: ['tech'],
				industries: ['software'],
				indexes: ['spx'],
				countries: ['US'],
				watchlists: ['w1']
			}),
			'u1',
			'l'
		);

		expect(droppedCriteria).toEqual(
			expect.arrayContaining([
				'universe.sectors',
				'universe.industries',
				'universe.indexes',
				'universe.countries',
				'universe.watchlists'
			])
		);
	});

	it('reports exclusions.sectorIds/industryIds as dropped when set', () => {
		const { droppedCriteria } = translateUniverse(
			universe({ exclusions: { instrumentIds: [], sectorIds: ['tech'], industryIds: [] } }),
			'u1',
			'l'
		);

		expect(droppedCriteria).toContain('universe.exclusions.sectorIds');
	});
});
