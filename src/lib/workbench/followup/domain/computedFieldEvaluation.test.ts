import { describe, expect, it } from 'vitest';
import type { ComputedFieldRecord } from './computedField';
import {
	computedFieldUnavailableWarning,
	evaluateComputedFieldForRows,
	type RowInput
} from './computedFieldEvaluation';
import type { ExpressionEvaluationContext } from './expressionEvaluator';
import type { LiteralValue } from './expressionModel';

const NOW = '2026-09-02T00:00:00.000Z';

// value = field.a / field.b -- division makes it easy to force "not
// available" via division by zero, alongside plain missing-field absence.
function makeDivisionField(): ComputedFieldRecord {
	return {
		id: 'field.custom.1',
		workspaceId: 'workspace_1',
		name: 'A over B',
		expression: {
			node: {
				kind: 'arithmetic',
				op: '/',
				left: { kind: 'field_ref', fieldId: 'a' },
				right: { kind: 'field_ref', fieldId: 'b' }
			},
			resultType: 'number',
			resultUnit: undefined,
			usage: 'numeric_column'
		},
		createdAt: NOW,
		updatedAt: NOW
	};
}

function contextFor(values: Record<string, LiteralValue | null>): ExpressionEvaluationContext {
	return {
		getFieldValue: (fieldId) => values[fieldId] ?? null,
		getFunctionOutput: () => null
	};
}

function row(instrumentId: string, values: Record<string, LiteralValue | null>): RowInput {
	return { instrumentId, context: contextFor(values) };
}

describe('evaluateComputedFieldForRows (AC8)', () => {
	it('computes an available value for every row that has both operands', () => {
		const result = evaluateComputedFieldForRows(makeDivisionField(), [
			row('inst:XNAS:AAPL', { a: 10, b: 2 }),
			row('inst:XNAS:MSFT', { a: 9, b: 3 })
		]);
		expect(result.values.get('inst:XNAS:AAPL')).toBe(5);
		expect(result.values.get('inst:XNAS:MSFT')).toBe(3);
		expect(result.unavailableCount).toBe(0);
	});

	it('reports null (not NaN/Infinity/a fabricated 0) for a division by zero', () => {
		const result = evaluateComputedFieldForRows(makeDivisionField(), [
			row('inst:XNAS:AAPL', { a: 10, b: 0 })
		]);
		expect(result.values.get('inst:XNAS:AAPL')).toBeNull();
		expect(result.unavailableCount).toBe(1);
	});

	it('reports null for a row missing an operand entirely', () => {
		const result = evaluateComputedFieldForRows(makeDivisionField(), [
			row('inst:XNAS:AAPL', { a: 10 })
		]);
		expect(result.values.get('inst:XNAS:AAPL')).toBeNull();
		expect(result.unavailableCount).toBe(1);
	});

	it('counts every affected row across a mixed batch', () => {
		const result = evaluateComputedFieldForRows(makeDivisionField(), [
			row('a', { a: 10, b: 2 }),
			row('b', { a: 10, b: 0 }),
			row('c', {}),
			row('d', { a: 4, b: 2 })
		]);
		expect(result.unavailableCount).toBe(2);
		expect(result.totalCount).toBe(4);
	});
});

describe('computedFieldUnavailableWarning (AC8)', () => {
	it('names the field and the affected count when at least one row was unavailable', () => {
		const field = makeDivisionField();
		const result = evaluateComputedFieldForRows(field, [
			row('a', { a: 10, b: 0 }),
			row('b', { a: 10, b: 2 })
		]);
		const warning = computedFieldUnavailableWarning(field, result);
		expect(warning).not.toBeNull();
		expect(warning?.message).toContain('A over B');
		expect(warning?.message).toContain('1 of 2');
	});

	it('returns null (no warning at all) when every row was available', () => {
		const field = makeDivisionField();
		const result = evaluateComputedFieldForRows(field, [row('a', { a: 10, b: 2 })]);
		expect(computedFieldUnavailableWarning(field, result)).toBeNull();
	});

	it('mutation check: a warning that fires unconditionally would wrongly appear on the all-available run above', () => {
		// Guards against a "always warn" regression: if computedFieldUnavailableWarning
		// stopped checking unavailableCount, the previous test would start failing
		// instead of this one passing -- this test documents the contract directly.
		const field = makeDivisionField();
		const allAvailable = evaluateComputedFieldForRows(field, [
			row('a', { a: 10, b: 2 }),
			row('b', { a: 4, b: 2 })
		]);
		expect(allAvailable.unavailableCount).toBe(0);
		expect(computedFieldUnavailableWarning(field, allAvailable)).toBeNull();
	});
});
