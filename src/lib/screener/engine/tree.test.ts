import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../../catalog/types';
import type { CatalogRegistry } from '../../catalog/registry';
import type { ConditionNode, GroupNode } from '../definition';
import type { ScreenerMarketData } from '../ports';
import type { ConditionEvalDeps } from './conditionEvaluation';
import { evaluateFilterTree } from './tree';

function fieldItem(id: string): CatalogItem {
	return {
		id,
		kind: 'field',
		label: id,
		description: id,
		aliases: [],
		tags: [],
		valueType: 'number',
		nullable: true,
		availability: {
			status: 'available',
			intervalIds: ['interval.1d'],
			requiresReferenceData: false
		}
	} as CatalogItem;
}

function makeDeps(fieldValues: Record<string, number>): ConditionEvalDeps {
	const registry: CatalogRegistry = {
		getCatalogItem: (id) => (id in fieldValues ? fieldItem(id) : undefined),
		listCatalogItems: () => [],
		searchCatalogItems: () => [],
		isOperatorValidForField: () => ({ valid: true }),
		resolveStudy: () => undefined,
		suggestCatalogIds: () => []
	};
	const marketData: ScreenerMarketData = {
		async resolveUniverse() {
			return [];
		},
		async getFieldValue(_id, fieldId) {
			return fieldId in fieldValues ? fieldValues[fieldId]! : null;
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
			throw new Error('getProvenance is not exercised by tree tests');
		}
	};
	return { registry, marketData, now: () => new Date('2024-06-01T00:00:00Z') };
}

function condition(
	nodeId: string,
	fieldId: string,
	threshold: number,
	enabled = true
): ConditionNode {
	return {
		nodeId,
		kind: 'condition',
		enabled,
		condition: {
			type: 'scalar',
			fieldId,
			operator: 'op.greater_than',
			value: threshold,
			unit: null
		}
	};
}

describe('evaluateFilterTree AND/OR/NOT', () => {
	it('test_and_allChildrenPass_groupPasses', async () => {
		const deps = makeDeps({ 'field.a': 10, 'field.b': 20 });
		const root: GroupNode = {
			nodeId: 'filter_1',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [condition('filter_2', 'field.a', 5), condition('filter_3', 'field.b', 5)]
		};
		const result = await evaluateFilterTree(root, 'AAPL', deps);
		expect(
			result.passed,
			`Expected AND of two passing children to pass: ${JSON.stringify(result)}`
		).toBe(true);
	});

	it('test_and_oneChildFails_groupFails', async () => {
		const deps = makeDeps({ 'field.a': 10, 'field.b': 1 });
		const root: GroupNode = {
			nodeId: 'filter_1',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [condition('filter_2', 'field.a', 5), condition('filter_3', 'field.b', 5)]
		};
		const result = await evaluateFilterTree(root, 'AAPL', deps);
		expect(
			result.passed,
			`Expected AND with one failing child to fail: ${JSON.stringify(result)}`
		).toBe(false);
	});

	it('test_or_oneChildPasses_groupPasses', async () => {
		const deps = makeDeps({ 'field.a': 1, 'field.b': 20 });
		const root: GroupNode = {
			nodeId: 'filter_1',
			kind: 'group',
			op: 'or',
			enabled: true,
			children: [condition('filter_2', 'field.a', 5), condition('filter_3', 'field.b', 5)]
		};
		const result = await evaluateFilterTree(root, 'AAPL', deps);
		expect(
			result.passed,
			`Expected OR with one passing child to pass: ${JSON.stringify(result)}`
		).toBe(true);
	});

	it('test_or_allChildrenFail_groupFails', async () => {
		const deps = makeDeps({ 'field.a': 1, 'field.b': 1 });
		const root: GroupNode = {
			nodeId: 'filter_1',
			kind: 'group',
			op: 'or',
			enabled: true,
			children: [condition('filter_2', 'field.a', 5), condition('filter_3', 'field.b', 5)]
		};
		const result = await evaluateFilterTree(root, 'AAPL', deps);
		expect(
			result.passed,
			`Expected OR with no passing children to fail: ${JSON.stringify(result)}`
		).toBe(false);
	});

	it('test_not_childPasses_groupFails', async () => {
		const deps = makeDeps({ 'field.a': 10 });
		const root: GroupNode = {
			nodeId: 'filter_1',
			kind: 'group',
			op: 'not',
			enabled: true,
			children: [condition('filter_2', 'field.a', 5)]
		};
		const result = await evaluateFilterTree(root, 'AAPL', deps);
		expect(result.passed, `Expected NOT to invert a passing child: ${JSON.stringify(result)}`).toBe(
			false
		);
	});

	it('test_not_childFails_groupPasses', async () => {
		const deps = makeDeps({ 'field.a': 1 });
		const root: GroupNode = {
			nodeId: 'filter_1',
			kind: 'group',
			op: 'not',
			enabled: true,
			children: [condition('filter_2', 'field.a', 5)]
		};
		const result = await evaluateFilterTree(root, 'AAPL', deps);
		expect(result.passed, `Expected NOT to invert a failing child: ${JSON.stringify(result)}`).toBe(
			true
		);
	});
});

describe('evaluateFilterTree nesting', () => {
	it('test_nestedGroups_threeLevelsDeep_combineCorrectly', async () => {
		const deps = makeDeps({ 'field.a': 10, 'field.b': 1, 'field.c': 10 });
		// (a>5 OR b>5) AND NOT(c<5) -- with c=10, c>5 is true so NOT(c>5) is false,
		// but let's build NOT(c>5) directly to keep the fixture simple.
		const innerNot: GroupNode = {
			nodeId: 'filter_not',
			kind: 'group',
			op: 'not',
			enabled: true,
			children: [condition('filter_c', 'field.c', 5)]
		};
		const innerOr: GroupNode = {
			nodeId: 'filter_or',
			kind: 'group',
			op: 'or',
			enabled: true,
			children: [condition('filter_a', 'field.a', 5), condition('filter_b', 'field.b', 5)]
		};
		const root: GroupNode = {
			nodeId: 'filter_root',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [innerOr, innerNot]
		};
		const result = await evaluateFilterTree(root, 'AAPL', deps);
		// OR is true (a>5), NOT(c>5) is false (c=10>5) -> AND is false.
		expect(
			result.passed,
			`Expected nested AND(OR, NOT) to combine to false: ${JSON.stringify(result)}`
		).toBe(false);
		expect(
			result.nodeEvaluations['filter_or']?.passed,
			'Expected the OR subgroup pass state recorded'
		).toBe(true);
		expect(
			result.nodeEvaluations['filter_not']?.passed,
			'Expected the NOT subgroup pass state recorded'
		).toBe(false);
	});
});

describe('evaluateFilterTree disabled nodes (AC4)', () => {
	it('test_disabledLeaf_insideEnabledGroup_isSkippedAndProducesNoEvaluation', async () => {
		const deps = makeDeps({ 'field.a': 10 });
		const root: GroupNode = {
			nodeId: 'filter_1',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [
				condition('filter_2', 'field.a', 5),
				condition('filter_3', 'field.missing', 5, false)
			]
		};
		const result = await evaluateFilterTree(root, 'AAPL', deps);
		expect(result.passed, 'A disabled child must never affect its parent AND').toBe(true);
		expect(
			result.nodeEvaluations['filter_3'],
			'A disabled node must produce no FilterNodeEvaluation'
		).toBeUndefined();
	});

	it('test_disabledGroup_producesNoEvaluationsForItsSubtree', async () => {
		const deps = makeDeps({ 'field.a': 10 });
		const disabledGroup: GroupNode = {
			nodeId: 'filter_disabled_group',
			kind: 'group',
			op: 'and',
			enabled: false,
			children: [condition('filter_hidden', 'field.a', 5)]
		};
		const root: GroupNode = {
			nodeId: 'filter_1',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [disabledGroup]
		};
		const result = await evaluateFilterTree(root, 'AAPL', deps);
		expect(
			result.passed,
			'A disabled group is skipped, leaving the parent AND vacuously true'
		).toBe(true);
		expect(
			result.nodeEvaluations['filter_disabled_group'],
			'A disabled group produces no FilterNodeEvaluation of its own'
		).toBeUndefined();
		expect(
			result.nodeEvaluations['filter_hidden'],
			"A disabled group's children are never recursed into"
		).toBeUndefined();
	});

	it('test_emptyOrAllDisabledGroup_isVacuouslyTrue', async () => {
		const deps = makeDeps({});
		const root: GroupNode = {
			nodeId: 'filter_1',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: []
		};
		const result = await evaluateFilterTree(root, 'AAPL', deps);
		expect(result.passed, 'An empty filter tree (the default screener) must match everything').toBe(
			true
		);
	});
});

describe('evaluateFilterTree per-node retention (AC9)', () => {
	it('test_everyEnabledNode_hasAFilterNodeEvaluation_groupsIncluded', async () => {
		const deps = makeDeps({ 'field.a': 10, 'field.b': 20 });
		const root: GroupNode = {
			nodeId: 'filter_root',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [condition('filter_a', 'field.a', 5), condition('filter_b', 'field.b', 5)]
		};
		const result = await evaluateFilterTree(root, 'AAPL', deps);
		expect(
			Object.keys(result.nodeEvaluations).sort(),
			'Expected the root group and both leaves recorded'
		).toEqual(['filter_a', 'filter_b', 'filter_root'].sort());
		expect(
			result.nodeEvaluations['filter_root']?.value,
			"A group's value has no scalar form"
		).toBeNull();
	});
});
