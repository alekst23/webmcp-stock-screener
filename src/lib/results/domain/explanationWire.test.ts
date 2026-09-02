import { describe, expect, it } from 'vitest';
import { toWireResultExplanation } from './explanationWire';
import { SCALAR_CONDITION, baseExplanation, group, leaf } from './explanationTestFixtures';
import { indeterminateOutcome } from './explanation';

const INDETERMINATE = indeterminateOutcome('missing input datum');

describe('toWireResultExplanation', () => {
	it('serializes to snake_case and omits genuinely-absent optionals rather than nulling them', () => {
		const explanation = baseExplanation();
		const wire = toWireResultExplanation(explanation);

		expect(wire.instrument_id).toBe('AAPL');
		expect(wire.run_id).toBe('run_1');
		expect(wire.screener_id).toBe('screener_1');
		expect(wire.screener_revision).toBe(3);
		expect(wire.ranking).toBe(null);
		expect(wire.standing).toEqual({ status: 'result', rank: 1 });

		const filterTree = wire.filter_tree as Record<string, unknown>;
		expect(filterTree.node_id).toBe('filter_1');
		expect(filterTree.outcome).toEqual({ status: 'pass' });
		// occurredBarsAgo was never set on this leaf -- the key should be
		// absent entirely, not present with value undefined/null.
		expect(Object.prototype.hasOwnProperty.call(filterTree, 'occurred_bars_ago')).toBe(false);
	});

	it('serializes a disabled leaf with explicit nulls, not omission', () => {
		const disabledLeaf = leaf(SCALAR_CONDITION, {
			enabled: false,
			outcome: null,
			actualValue: null
		});
		const wire = toWireResultExplanation(baseExplanation({ filterTree: disabledLeaf }));
		const filterTree = wire.filter_tree as Record<string, unknown>;

		expect(filterTree.enabled).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(filterTree, 'outcome')).toBe(true);
		expect(filterTree.outcome).toBe(null);
		expect(Object.prototype.hasOwnProperty.call(filterTree, 'actual_value')).toBe(true);
		expect(filterTree.actual_value).toBe(null);
	});

	it('serializes an indeterminate outcome with its reason', () => {
		const indeterminateLeaf = leaf(SCALAR_CONDITION, { outcome: INDETERMINATE });
		const wire = toWireResultExplanation(baseExplanation({ filterTree: indeterminateLeaf }));
		const filterTree = wire.filter_tree as Record<string, unknown>;
		expect(filterTree.outcome).toEqual({ status: 'indeterminate', reason: 'missing input datum' });
	});

	it('serializes nested groups recursively', () => {
		const nested = group('and', [leaf(SCALAR_CONDITION)]);
		const wire = toWireResultExplanation(baseExplanation({ filterTree: nested }));
		const filterTree = wire.filter_tree as Record<string, unknown>;
		expect(filterTree.kind).toBe('group');
		expect(filterTree.op).toBe('and');
		expect(Array.isArray(filterTree.children)).toBe(true);
		expect((filterTree.children as unknown[]).length).toBe(1);
	});
});
