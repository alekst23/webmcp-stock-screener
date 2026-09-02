import { describe, expect, it } from 'vitest';
import type { RangeCondition, ScalarCondition } from '../../../screener/conditions';
import { emptyFilterTree, emptyUniverse } from '../../../screener/definition';
import { toEvaluableDefinition } from './alertConditions';

const RANGE_CONDITION: RangeCondition = {
	type: 'range',
	fieldId: 'field.volume',
	lower: 1,
	upper: 2,
	lowerInclusive: true,
	upperInclusive: true
};

const SCALAR_CONDITION: ScalarCondition = {
	type: 'scalar',
	fieldId: 'field.volume',
	operator: 'op.greater_than',
	value: 1000,
	unit: null
};

describe('toEvaluableDefinition', () => {
	it('wraps typed conditions in a single enabled AND group', () => {
		const definition = toEvaluableDefinition(
			{ kind: 'conditions', conditions: [RANGE_CONDITION, SCALAR_CONDITION] },
			'workspace_1'
		);
		expect(definition.filterTree.kind).toBe('group');
		if (definition.filterTree.kind !== 'group') {
			throw new Error('expected a group');
		}
		expect(definition.filterTree.op).toBe('and');
		expect(definition.filterTree.enabled).toBe(true);
		expect(definition.filterTree.children).toHaveLength(2);
		expect(definition.filterTree.children[0]).toMatchObject({
			kind: 'condition',
			condition: RANGE_CONDITION,
			enabled: true
		});
	});

	it('uses an empty universe for a typed-conditions source', () => {
		const definition = toEvaluableDefinition({ kind: 'conditions', conditions: [] }, 'workspace_1');
		expect(definition.universe).toEqual(emptyUniverse());
	});

	it('mints distinct node ids per condition so contradiction detection can name them', () => {
		const definition = toEvaluableDefinition(
			{ kind: 'conditions', conditions: [RANGE_CONDITION, SCALAR_CONDITION] },
			'workspace_1'
		);
		if (definition.filterTree.kind !== 'group') {
			throw new Error('expected a group');
		}
		const nodeIds = definition.filterTree.children.map((c) => c.nodeId);
		expect(new Set(nodeIds).size).toBe(2);
	});

	it('passes a screener_revision source through as its own frozen filter tree and universe', () => {
		const filterTree = emptyFilterTree('filter_1');
		const universe = emptyUniverse();
		const definition = toEvaluableDefinition(
			{
				kind: 'screener_revision',
				screenerId: 'screener_1',
				screenerRevision: 4,
				filterTree,
				universe
			},
			'workspace_1'
		);
		expect(definition.filterTree).toBe(filterTree);
		expect(definition.universe).toBe(universe);
		expect(definition.screenerId).toBe('screener_1');
		expect(definition.revision).toBe(4);
	});
});
