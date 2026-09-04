import { describe, expect, it } from 'vitest';
import type { ConditionNode, GroupNode } from '../definition';
import { emptyFilterTree, emptyUniverse } from '../definition';
import type { Condition } from '../conditions';
import {
	summarizeCondition,
	summarizeFilterTree,
	summarizeRanking,
	summarizeUniverse
} from './filterTreeSummary';

function scalarCondition(): Condition {
	return { type: 'scalar', fieldId: 'field.market_cap', operator: 'gt', value: 1000, unit: 'USD' };
}

function conditionNode(condition: Condition, overrides: Partial<ConditionNode> = {}): ConditionNode {
	return { nodeId: 'filter_1', kind: 'condition', condition, enabled: true, ...overrides };
}

describe('summarizeCondition', () => {
	it('renders a scalar condition with its operator symbol and unit', () => {
		expect(summarizeCondition(scalarCondition())).toBe('field.market_cap > 1000 USD');
	});

	it('renders a range condition with inclusive/exclusive bracket notation', () => {
		const condition: Condition = {
			type: 'range',
			fieldId: 'field.rsi',
			lower: 30,
			upper: 70,
			lowerInclusive: true,
			upperInclusive: false
		};
		expect(summarizeCondition(condition)).toBe('field.rsi [30, 70)');
	});

	it('renders a relative condition naming its baseline', () => {
		const condition: Condition = {
			type: 'relative',
			fieldId: 'field.volume',
			baseline: { kind: 'own_moving_average', windowBars: 20 },
			multiple: 1.5,
			operator: 'gt'
		};
		expect(summarizeCondition(condition)).toContain('20-bar average');
	});

	it('renders a temporal condition wrapping its inner condition', () => {
		const condition: Condition = {
			type: 'temporal',
			condition: scalarCondition(),
			event: 'crossed_above',
			withinBars: 5,
			intervalId: 'interval.1d'
		};
		const text = summarizeCondition(condition);
		expect(text).toContain('field.market_cap > 1000 USD');
		expect(text).toContain('crossed_above');
	});
});

describe('summarizeFilterTree', () => {
	it('renders an empty root group with an explicit "(empty)" marker', () => {
		const root = emptyFilterTree('filter_1');
		const lines = summarizeFilterTree(root);
		expect(lines).toEqual([{ depth: 0, text: 'AND (empty)' }]);
	});

	it('indents nested condition nodes one level per group depth', () => {
		const root: GroupNode = {
			nodeId: 'filter_1',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [conditionNode(scalarCondition(), { nodeId: 'filter_2' })]
		};
		const lines = summarizeFilterTree(root);
		expect(lines).toEqual([
			{ depth: 0, text: 'AND' },
			{ depth: 1, text: 'field.market_cap > 1000 USD' }
		]);
	});

	it('marks a disabled node without hiding it', () => {
		const root: GroupNode = {
			nodeId: 'filter_1',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [conditionNode(scalarCondition(), { nodeId: 'filter_2', enabled: false })]
		};
		const lines = summarizeFilterTree(root);
		expect(lines[1]?.text.startsWith('(disabled) ')).toBe(true);
	});
});

describe('summarizeUniverse', () => {
	it('reports an explicit "no constraints" line for the empty default universe', () => {
		expect(summarizeUniverse(emptyUniverse())).toEqual(['No universe constraints set.']);
	});

	it('reports each populated dimension', () => {
		const universe = {
			...emptyUniverse(),
			assetClass: 'equity',
			exchanges: ['XNAS', 'XNYS'],
			liquidity: { minPrice: 5, minAverageVolume: null, minMarketCap: null }
		};
		const lines = summarizeUniverse(universe);
		expect(lines).toContain('Asset class: equity');
		expect(lines).toContain('Exchanges: XNAS, XNYS');
		expect(lines).toContain('Liquidity: min price 5');
	});
});

describe('summarizeRanking', () => {
	it('reports the documented default when ranking is null', () => {
		expect(summarizeRanking(null)).toBe('Default order (no ranking configured).');
	});

	it('reports ranked fields and the limit', () => {
		const summary = summarizeRanking({
			fields: [{ fieldId: 'field.momentum', direction: 'desc', weight: 1 }],
			tieBreak: null,
			limit: 25,
			normalization: 'percentile_rank'
		});
		expect(summary).toBe('Ranked by field.momentum desc, limit 25.');
	});
});
