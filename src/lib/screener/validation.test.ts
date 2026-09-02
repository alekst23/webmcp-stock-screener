import { describe, expect, it } from 'vitest';
import type { Condition } from './conditions';
import type { ConditionNode, FilterNode, GroupNode } from './definition';
import { PROBLEM_CODES, parseScreenerForExecution } from './validation';

function baseScreener(filterTree: FilterNode): Record<string, unknown> {
	return {
		screenerId: 'screener_1',
		workspaceId: 'workspace_1',
		name: 'Test screener',
		revision: 1,
		universe: { assetClass: 'equity' },
		filterTree,
		ranking: null
	};
}

function conditionNode(nodeId: string, condition: unknown, enabled = true): ConditionNode {
	return { nodeId, kind: 'condition', condition: condition as Condition, enabled };
}

function rootGroup(children: FilterNode[]): GroupNode {
	return { nodeId: 'filter_1', kind: 'group', op: 'and', children, enabled: true };
}

const EIGHT_CONDITION_SAMPLES: Record<string, unknown> = {
	scalar: { type: 'scalar', fieldId: 'field.price', operator: 'op.gt', value: 10, unit: 'usd' },
	range: {
		type: 'range',
		fieldId: 'field.rsi',
		lower: 40,
		upper: 70,
		lowerInclusive: true,
		upperInclusive: true
	},
	series_comparison: {
		type: 'series_comparison',
		left: { catalogId: 'indicator.ma', params: { window: 50 } },
		right: { catalogId: 'indicator.ma', params: { window: 200 } },
		operator: 'op.gt'
	},
	temporal: {
		type: 'temporal',
		condition: { type: 'scalar', fieldId: 'field.price', operator: 'op.gt', value: 10, unit: null },
		event: 'crossed_above',
		withinBars: 5,
		intervalId: 'interval.1d'
	},
	event_relative: {
		type: 'event_relative',
		eventTypeId: 'event.earnings',
		direction: 'future',
		windowDays: 30
	},
	pattern: {
		type: 'pattern',
		patternId: 'pattern.bull_flag',
		minConfidence: 0.75,
		intervalId: 'interval.1d'
	},
	relative: {
		type: 'relative',
		fieldId: 'field.volume',
		baseline: { kind: 'own_moving_average', windowBars: 20 },
		multiple: 1.5,
		operator: 'op.gt'
	},
	study_output: {
		type: 'study_output',
		studyId: 'study.macd',
		params: {},
		outputName: 'histogram',
		predicate: 'positive_and_rising'
	}
};

describe('parseScreenerForExecution', () => {
	for (const [family, sample] of Object.entries(EIGHT_CONDITION_SAMPLES)) {
		it(`test_parseScreenerForExecution_accepts_${family}_condition_variant`, () => {
			const raw = baseScreener(rootGroup([conditionNode('filter_2', sample)]));
			const result = parseScreenerForExecution(raw);
			expect(result.ok, `expected ok:true for ${family}, got ${JSON.stringify(result)}`).toBe(true);
			if (result.ok) {
				const root = result.screener.filterTree as GroupNode;
				const child = root.children[0] as ConditionNode;
				expect(child.condition.type, `condition type must round-trip for ${family}`).toBe(family);
			}
		});
	}

	it('test_parseScreenerForExecution_rejects_unrecognized_condition_type', () => {
		const raw = baseScreener(
			rootGroup([conditionNode('filter_2', { type: 'raw_sql', query: 'DROP TABLE x' })])
		);
		const result = parseScreenerForExecution(raw);
		expect(result.ok, 'an unrecognized condition type must not parse as ok').toBe(false);
		if (!result.ok) {
			expect(result.problems.length, 'exactly one problem for one bad node').toBe(1);
			const problem = result.problems[0];
			expect(problem, 'a rejection must carry at least one problem').toBeDefined();
			expect(problem?.code, 'unrecognized condition type must use the dedicated code').toBe(
				PROBLEM_CODES.unknownConditionType
			);
			expect(problem?.severity, 'an unrecognized condition type is blocking, not advisory').toBe(
				'blocking'
			);
			expect(problem?.nodeIds, 'the problem must name the offending node').toEqual(['filter_2']);
		}
	});

	it('test_parseScreenerForExecution_rejects_missing_type_field', () => {
		const raw = baseScreener(rootGroup([conditionNode('filter_2', { fieldId: 'field.price' })]));
		const result = parseScreenerForExecution(raw);
		expect(result.ok, 'a condition object with no type field must be rejected').toBe(false);
	});

	it('test_parseScreenerForExecution_reports_every_bad_node_in_a_multi_node_tree', () => {
		const raw = baseScreener(
			rootGroup([
				conditionNode('filter_2', { type: 'not_a_type' }),
				conditionNode('filter_3', { type: 'also_bad' })
			])
		);
		const result = parseScreenerForExecution(raw);
		expect(result.ok, 'a tree with two bad nodes must not parse as ok').toBe(false);
		if (!result.ok) {
			const nodeIds = result.problems.flatMap((p) => p.nodeIds);
			expect(nodeIds, 'both offending nodes must be named').toEqual(['filter_2', 'filter_3']);
		}
	});

	it('test_parseScreenerForExecution_skips_unrecognized_type_on_a_disabled_node', () => {
		// spec.md "Disabled nodes": a disabled node produces no validation
		// problems and is reported as skipped, even if its payload is otherwise
		// unrecognizable.
		const raw = baseScreener(
			rootGroup([conditionNode('filter_2', { type: 'not_a_real_type' }, false)])
		);
		const result = parseScreenerForExecution(raw);
		expect(result.ok, 'a disabled node with a bad type must not block the parse').toBe(true);
	});

	it('test_parseScreenerForExecution_accepts_nested_groups', () => {
		const raw = baseScreener(
			rootGroup([
				{
					nodeId: 'filter_2',
					kind: 'group',
					op: 'or',
					enabled: true,
					children: [
						conditionNode('filter_3', EIGHT_CONDITION_SAMPLES.scalar),
						conditionNode('filter_4', EIGHT_CONDITION_SAMPLES.range)
					]
				}
			])
		);
		const result = parseScreenerForExecution(raw);
		expect(result.ok, 'a well-formed nested tree must parse').toBe(true);
		if (result.ok) {
			const root = result.screener.filterTree as GroupNode;
			const inner = root.children[0] as GroupNode;
			expect(inner.children.length, 'both nested conditions must survive parsing').toBe(2);
		}
	});

	it('test_parseScreenerForExecution_rejects_non_object_input', () => {
		const result = parseScreenerForExecution('not a screener');
		expect(result.ok, 'a non-object payload must not parse as ok').toBe(false);
		if (!result.ok) {
			expect(result.problems[0]?.code, 'a non-object payload is an invalid parameter').toBe(
				PROBLEM_CODES.invalidParameter
			);
		}
	});

	it('test_parseScreenerForExecution_preserves_universe_and_ranking_fields', () => {
		const raw = {
			...baseScreener(rootGroup([conditionNode('filter_2', EIGHT_CONDITION_SAMPLES.scalar)])),
			ranking: {
				fields: [{ fieldId: 'field.price', direction: 'desc', weight: 1 }],
				tieBreak: null,
				limit: 50,
				normalization: 'percentile_rank'
			}
		};
		const result = parseScreenerForExecution(raw);
		expect(result.ok, 'a well-formed screener with ranking must parse').toBe(true);
		if (result.ok) {
			expect(result.screener.universe.assetClass, 'universe must be normalized via T-1009-1').toBe(
				'equity'
			);
			expect(result.screener.ranking?.limit, 'ranking must be normalized via T-1009-1').toBe(50);
		}
	});
});
