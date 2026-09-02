import { describe, expect, it } from 'vitest';
import {
	ARITHMETIC_OPERATORS,
	COMPARISON_OPERATORS,
	EXPRESSION_NODE_KINDS,
	LITERAL_VALUE_TYPES,
	usageForResultType
} from './expressionModel';

describe('expressionModel', () => {
	it('test_exactly_five_node_kinds_are_permitted', () => {
		expect(
			[...EXPRESSION_NODE_KINDS].sort(),
			`expected exactly the five permitted node kinds, got ${JSON.stringify(EXPRESSION_NODE_KINDS)}`
		).toEqual(['arithmetic', 'comparison', 'field_ref', 'function_call', 'literal'].sort());
	});

	it('test_literal_value_types_exclude_anything_but_number_string_boolean', () => {
		expect(
			[...LITERAL_VALUE_TYPES].sort(),
			`literal value types drifted: ${JSON.stringify(LITERAL_VALUE_TYPES)}`
		).toEqual(['boolean', 'number', 'string'].sort());
	});

	it('test_arithmetic_operators_are_the_four_basic_operations', () => {
		expect([...ARITHMETIC_OPERATORS].sort()).toEqual(['*', '+', '-', '/'].sort());
	});

	it('test_comparison_operators_are_the_six_relational_operators', () => {
		expect([...COMPARISON_OPERATORS].sort()).toEqual(['!=', '<', '<=', '==', '>', '>='].sort());
	});

	it('test_usage_for_number_result_type_is_numeric_column', () => {
		expect(usageForResultType('number'), 'a number result should be usable as a column').toBe(
			'numeric_column'
		);
	});

	it('test_usage_for_boolean_result_type_is_boolean_filter', () => {
		expect(
			usageForResultType('boolean'),
			'a boolean result should be usable as a filter operand'
		).toBe('boolean_filter');
	});

	it('test_usage_for_string_date_enum_result_types_is_none', () => {
		for (const resultType of ['string', 'date', 'enum'] as const) {
			expect(
				usageForResultType(resultType),
				`a "${resultType}" result should be usable as neither a column nor a filter operand`
			).toBe('none');
		}
	});
});
