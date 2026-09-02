import { describe, expect, it } from 'vitest';
import type { ExpressionEvaluationContext } from './expressionEvaluator';
import { evaluateExpression } from './expressionEvaluator';
import type { ExpressionNode, LiteralValue, ValidatedExpression } from './expressionModel';

function validated(node: ExpressionNode): ValidatedExpression {
	return { node, resultType: 'number', resultUnit: undefined, usage: 'numeric_column' };
}

function fixedContext(
	fields: Record<string, LiteralValue | null>,
	functions: Record<string, LiteralValue | null> = {}
): ExpressionEvaluationContext {
	return {
		getFieldValue: (fieldId) => (fieldId in fields ? (fields[fieldId] ?? null) : null),
		getFunctionOutput: (functionId, _args, outputName) => {
			const key = `${functionId}.${outputName}`;
			return key in functions ? (functions[key] ?? null) : null;
		}
	};
}

describe('evaluateExpression: literals and field references', () => {
	it('test_a_literal_evaluates_to_its_own_value', () => {
		const result = evaluateExpression(
			validated({ kind: 'literal', valueType: 'number', value: 42 }),
			fixedContext({})
		);
		expect(result).toEqual({ available: true, value: 42 });
	});

	it('test_a_field_ref_with_a_value_evaluates_to_that_value', () => {
		const result = evaluateExpression(
			validated({ kind: 'field_ref', fieldId: 'field.price.close' }),
			fixedContext({ 'field.price.close': 123.45 })
		);
		expect(result).toEqual({ available: true, value: 123.45 });
	});

	it('test_a_field_ref_with_missing_data_is_not_available_rather_than_throwing', () => {
		const result = evaluateExpression(
			validated({ kind: 'field_ref', fieldId: 'field.price.close' }),
			fixedContext({})
		);
		expect(result, 'missing data should yield an explicit not-available result').toEqual({
			available: false
		});
	});
});

describe('evaluateExpression: function calls', () => {
	it('test_a_function_output_with_a_value_evaluates_to_that_value', () => {
		const result = evaluateExpression(
			validated({ kind: 'function_call', functionId: 'study.sma', args: { length: 20 }, outputName: 'sma' }),
			fixedContext({}, { 'study.sma.sma': 101.5 })
		);
		expect(result).toEqual({ available: true, value: 101.5 });
	});

	it('test_a_function_output_with_insufficient_history_is_not_available', () => {
		const result = evaluateExpression(
			validated({ kind: 'function_call', functionId: 'study.sma', args: { length: 20 }, outputName: 'sma' }),
			fixedContext({}, {})
		);
		expect(result).toEqual({ available: false });
	});
});

describe('evaluateExpression: arithmetic (AC6)', () => {
	function arithmetic(op: '+' | '-' | '*' | '/', a: LiteralValue | null, b: LiteralValue | null) {
		return evaluateExpression(
			validated({
				kind: 'arithmetic',
				op,
				left: { kind: 'field_ref', fieldId: 'a' },
				right: { kind: 'field_ref', fieldId: 'b' }
			}),
			fixedContext({ a, b })
		);
	}

	it('test_addition_subtraction_multiplication_compute_the_expected_value', () => {
		expect(arithmetic('+', 2, 3)).toEqual({ available: true, value: 5 });
		expect(arithmetic('-', 5, 3)).toEqual({ available: true, value: 2 });
		expect(arithmetic('*', 4, 3)).toEqual({ available: true, value: 12 });
	});

	it('test_division_computes_the_expected_value_when_the_divisor_is_nonzero', () => {
		expect(arithmetic('/', 10, 4)).toEqual({ available: true, value: 2.5 });
	});

	it('test_division_by_zero_yields_not_available_rather_than_infinity_or_nan', () => {
		const result = arithmetic('/', 10, 0);
		expect(result, 'a division by zero must never surface as Infinity/NaN').toEqual({
			available: false
		});
	});

	it('test_a_missing_operand_propagates_as_not_available_rather_than_producing_nan', () => {
		expect(arithmetic('+', null, 3)).toEqual({ available: false });
		expect(arithmetic('+', 3, null)).toEqual({ available: false });
	});
});

describe('evaluateExpression: comparisons', () => {
	function compare(op: '>' | '<' | '>=' | '<=' | '==' | '!=', a: LiteralValue | null, b: LiteralValue | null) {
		return evaluateExpression(
			validated({
				kind: 'comparison',
				op,
				left: { kind: 'field_ref', fieldId: 'a' },
				right: { kind: 'field_ref', fieldId: 'b' }
			}),
			fixedContext({ a, b })
		);
	}

	it('test_numeric_ordering_operators_compute_the_expected_boolean', () => {
		expect(compare('>', 5, 3)).toEqual({ available: true, value: true });
		expect(compare('<', 5, 3)).toEqual({ available: true, value: false });
		expect(compare('>=', 5, 5)).toEqual({ available: true, value: true });
		expect(compare('<=', 4, 5)).toEqual({ available: true, value: true });
	});

	it('test_equality_operators_compute_the_expected_boolean', () => {
		expect(compare('==', 5, 5)).toEqual({ available: true, value: true });
		expect(compare('!=', 5, 5)).toEqual({ available: true, value: false });
	});

	it('test_string_ordering_compares_lexicographically', () => {
		expect(compare('<', 'AAPL', 'MSFT')).toEqual({ available: true, value: true });
	});

	it('test_a_missing_operand_makes_the_comparison_not_available', () => {
		expect(compare('>', null, 3)).toEqual({ available: false });
	});
});
