import { describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../../../catalog/registry';
import type { CatalogRegistry } from '../../../catalog/registry';
import type { CatalogItem, StudyItem } from '../../../catalog/types';
import { validateExpression } from './expressionValidator';
import type { ExpressionValidationResult } from './expressionValidator';

// A study whose only parameter is required, with no default -- the built-in
// catalog currently declares no such parameter, so AC4's "missing required
// argument" case needs a small fixture registry to exercise it.
const REQUIRED_ARG_STUDY: StudyItem = {
	id: 'study.fake_required',
	kind: 'study',
	label: 'Fixture: required argument',
	description: 'Test fixture only -- not part of the real catalog.',
	aliases: [],
	tags: [],
	parameters: [
		{
			name: 'window',
			valueType: 'number',
			unit: 'bars',
			defaultValue: null,
			range: { min: 1, max: 500 },
			required: true
		}
	],
	outputs: [{ name: 'value', valueType: 'number' }],
	defaultIntervalId: 'interval.1d',
	availability: { status: 'available', requiresReferenceData: false, intervalIds: ['interval.1d'] }
};

function fixtureRegistry(items: CatalogItem[]): CatalogRegistry {
	return {
		getCatalogItem: (id) => items.find((item) => item.id === id),
		listCatalogItems: (kind) => (kind ? items.filter((item) => item.kind === kind) : items),
		searchCatalogItems: () => [],
		isOperatorValidForField: () => ({ valid: false, reason: 'not implemented in test fixture' }),
		resolveStudy: (id) => {
			const item = items.find((i) => i.id === id);
			return item?.kind === 'study' ? item : undefined;
		},
		suggestCatalogIds: () => []
	};
}

const FIXTURE_REGISTRY = fixtureRegistry([REQUIRED_ARG_STUDY]);

function expectValid(result: ExpressionValidationResult) {
	if (!result.valid) {
		throw new Error(`expected a valid expression, got error: ${result.error.message}`);
	}
	return result.expression;
}

function expectInvalid(result: ExpressionValidationResult) {
	if (result.valid) {
		throw new Error('expected an invalid expression, got a valid one');
	}
	return result.error;
}

describe('validateExpression: happy path (AC1, AC7)', () => {
	it('test_a_field_ref_validates_as_a_numeric_column', () => {
		const expression = expectValid(
			validateExpression({ kind: 'field_ref', fieldId: 'field.price.close' }, builtinCatalogRegistry)
		);
		expect(expression.resultType, 'field.price.close is a number field').toBe('number');
		expect(expression.resultUnit, 'field.price.close is priced in currency').toBe('currency');
		expect(expression.usage, 'a numeric result should be usable as a column').toBe('numeric_column');
	});

	it('test_a_comparison_validates_as_a_boolean_filter_operand', () => {
		const expression = expectValid(
			validateExpression(
				{
					kind: 'comparison',
					op: '>',
					left: { kind: 'field_ref', fieldId: 'field.price.close' },
					right: { kind: 'literal', valueType: 'number', value: 100 }
				},
				builtinCatalogRegistry
			)
		);
		expect(expression.resultType, 'a comparison result is always boolean').toBe('boolean');
		expect(expression.usage, 'a boolean result should be usable as a filter operand').toBe(
			'boolean_filter'
		);
	});

	it('test_a_string_field_validates_but_is_usable_as_neither_column_nor_filter', () => {
		const expression = expectValid(
			validateExpression({ kind: 'field_ref', fieldId: 'field.symbol' }, builtinCatalogRegistry)
		);
		expect(expression.resultType, 'field.symbol is a string field').toBe('string');
		expect(expression.usage, 'a string result is usable as neither').toBe('none');
	});

	it('test_a_tree_mixing_all_five_node_kinds_validates', () => {
		// (sma(field.close, 20) - field.close) / field.close > 0
		const expression = expectValid(
			validateExpression(
				{
					kind: 'comparison',
					op: '>',
					left: {
						kind: 'arithmetic',
						op: '/',
						left: {
							kind: 'arithmetic',
							op: '-',
							left: {
								kind: 'function_call',
								functionId: 'study.sma',
								args: { length: 20 },
								outputName: 'sma'
							},
							right: { kind: 'field_ref', fieldId: 'field.price.close' }
						},
						right: { kind: 'field_ref', fieldId: 'field.price.close' }
					},
					right: { kind: 'literal', valueType: 'number', value: 0 }
				},
				builtinCatalogRegistry
			)
		);
		expect(expression.resultType, 'the whole tree is a comparison').toBe('boolean');
	});
});

describe('validateExpression: unresolved references (AC2)', () => {
	it('test_unknown_field_id_is_rejected_naming_the_field_and_offering_alternatives', () => {
		const error = expectInvalid(
			validateExpression({ kind: 'field_ref', fieldId: 'field.totally_unknown' }, builtinCatalogRegistry)
		);
		expect(error.reason, 'wrong reason for an unresolvable field').toBe('unresolved_field');
		expect(error.message, 'the offending field id should be named').toContain('field.totally_unknown');
		expect(
			error.permittedVocabulary.length > 0,
			'a rejected field reference should carry permitted alternatives'
		).toBe(true);
		expect(
			error.permittedVocabulary.includes('field.totally_unknown'),
			'the bogus id itself should never appear as a permitted alternative'
		).toBe(false);
	});

	it('test_unknown_function_id_is_rejected_naming_the_function_and_offering_alternatives', () => {
		const error = expectInvalid(
			validateExpression(
				{ kind: 'function_call', functionId: 'study.totally_unknown', args: {} },
				builtinCatalogRegistry
			)
		);
		expect(error.reason, 'wrong reason for an unresolvable function').toBe('unresolved_function');
		expect(error.message).toContain('study.totally_unknown');
		expect(
			error.permittedVocabulary.length > 0,
			'a rejected function call should carry permitted alternatives'
		).toBe(true);
	});

	it('test_a_field_id_referencing_a_non_field_catalog_item_is_rejected', () => {
		// study.sma exists in the catalog, but is not kind: 'field'.
		const error = expectInvalid(
			validateExpression({ kind: 'field_ref', fieldId: 'study.sma' }, builtinCatalogRegistry)
		);
		expect(error.reason, 'a study id used as a field ref should be unresolved').toBe(
			'unresolved_field'
		);
	});
});

describe('validateExpression: type and unit mismatches (AC3)', () => {
	it('test_subtracting_a_currency_amount_from_a_date_is_rejected_as_a_type_mismatch', () => {
		const error = expectInvalid(
			validateExpression(
				{
					kind: 'arithmetic',
					op: '-',
					left: { kind: 'field_ref', fieldId: 'field.date' },
					right: { kind: 'field_ref', fieldId: 'field.price.close' }
				},
				builtinCatalogRegistry
			)
		);
		expect(error.reason, 'a date is not numeric, so this is a type mismatch').toBe('type_mismatch');
		expect(error.message).toContain('date');
	});

	it('test_arithmetic_between_incompatible_units_is_rejected', () => {
		const error = expectInvalid(
			validateExpression(
				{
					kind: 'arithmetic',
					op: '-',
					left: { kind: 'field_ref', fieldId: 'field.price.close' },
					right: { kind: 'field_ref', fieldId: 'field.volume' }
				},
				builtinCatalogRegistry
			)
		);
		expect(error.reason, 'currency minus shares should be a unit mismatch').toBe('unit_mismatch');
		expect(error.message).toContain('currency');
		expect(error.message).toContain('shares');
	});

	it('test_comparing_a_number_to_a_string_is_rejected_as_a_type_mismatch', () => {
		const error = expectInvalid(
			validateExpression(
				{
					kind: 'comparison',
					op: '>',
					left: { kind: 'field_ref', fieldId: 'field.price.close' },
					right: { kind: 'field_ref', fieldId: 'field.symbol' }
				},
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('type_mismatch');
	});

	it('test_comparing_numbers_with_different_units_is_rejected_as_a_unit_mismatch', () => {
		const error = expectInvalid(
			validateExpression(
				{
					kind: 'comparison',
					op: '>',
					left: { kind: 'field_ref', fieldId: 'field.price.close' },
					right: { kind: 'field_ref', fieldId: 'field.volume' }
				},
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('unit_mismatch');
	});

	it('test_multiplying_a_priced_field_by_a_unitless_literal_preserves_the_price_unit', () => {
		const expression = expectValid(
			validateExpression(
				{
					kind: 'arithmetic',
					op: '*',
					left: { kind: 'field_ref', fieldId: 'field.price.close' },
					right: { kind: 'literal', valueType: 'number', value: 2 }
				},
				builtinCatalogRegistry
			)
		);
		expect(expression.resultUnit, 'currency * unitless should stay currency').toBe('currency');
	});

	it('test_subtracting_a_unitless_literal_from_a_unitted_field_is_allowed', () => {
		const expression = expectValid(
			validateExpression(
				{
					kind: 'arithmetic',
					op: '-',
					left: { kind: 'field_ref', fieldId: 'field.price.close' },
					right: { kind: 'literal', valueType: 'number', value: 5 }
				},
				builtinCatalogRegistry
			)
		);
		expect(expression.resultUnit, 'a unitless literal should not conflict with currency').toBe(
			'currency'
		);
	});

	it('test_comparing_a_unitted_field_to_a_unitless_literal_threshold_is_allowed', () => {
		const expression = expectValid(
			validateExpression(
				{
					kind: 'comparison',
					op: '>',
					left: { kind: 'field_ref', fieldId: 'field.price.close' },
					right: { kind: 'literal', valueType: 'number', value: 100 }
				},
				builtinCatalogRegistry
			)
		);
		expect(expression.resultType).toBe('boolean');
	});

	it('test_dividing_two_differently_unitted_numbers_produces_an_unlabeled_ratio', () => {
		const expression = expectValid(
			validateExpression(
				{
					kind: 'arithmetic',
					op: '/',
					left: { kind: 'field_ref', fieldId: 'field.price.close' },
					right: { kind: 'field_ref', fieldId: 'field.volume' }
				},
				builtinCatalogRegistry
			)
		);
		expect(
			expression.resultUnit,
			'currency / shares is a derived ratio, not itself currency or shares'
		).toBeUndefined();
	});
});

describe('validateExpression: function call arguments (AC4)', () => {
	it('test_missing_required_argument_is_rejected_naming_it', () => {
		const error = expectInvalid(
			validateExpression(
				{ kind: 'function_call', functionId: 'study.fake_required', args: {} },
				FIXTURE_REGISTRY
			)
		);
		expect(error.reason).toBe('missing_argument');
		expect(error.permittedVocabulary).toContain('window');
	});

	it('test_undeclared_argument_is_rejected_naming_the_declared_parameters', () => {
		const error = expectInvalid(
			validateExpression(
				{
					kind: 'function_call',
					functionId: 'study.sma',
					args: { length: 20, bogus_param: 1 }
				},
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('unexpected_argument');
		expect(error.message).toContain('bogus_param');
		expect(error.permittedVocabulary).toContain('length');
	});

	it('test_wrong_typed_argument_value_is_rejected', () => {
		const error = expectInvalid(
			validateExpression(
				{ kind: 'function_call', functionId: 'study.sma', args: { length: 'twenty' } },
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('argument_type_mismatch');
	});

	it('test_out_of_range_argument_value_is_rejected', () => {
		const error = expectInvalid(
			validateExpression(
				{ kind: 'function_call', functionId: 'study.sma', args: { length: 5000 } },
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('argument_out_of_range');
	});

	it('test_invalid_enum_argument_value_is_rejected', () => {
		const error = expectInvalid(
			validateExpression(
				{ kind: 'function_call', functionId: 'study.vwap', args: { anchor: 'decade' } },
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('argument_type_mismatch');
	});

	it('test_omitted_optional_arguments_are_filled_from_the_catalog_default', () => {
		const expression = expectValid(
			validateExpression({ kind: 'function_call', functionId: 'study.sma', args: {} }, builtinCatalogRegistry)
		);
		const node = expression.node as { kind: 'function_call'; args: Record<string, unknown> };
		expect(node.args.length, 'the default length should be normalized onto the tree').toBe(20);
	});

	it('test_omitting_output_name_on_a_multi_output_function_is_rejected_as_ambiguous', () => {
		const error = expectInvalid(
			validateExpression(
				{ kind: 'function_call', functionId: 'study.macd', args: {} },
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('ambiguous_output');
		expect(error.permittedVocabulary).toEqual(['macd', 'signal', 'histogram']);
	});

	it('test_unknown_output_name_is_rejected_naming_the_declared_outputs', () => {
		const error = expectInvalid(
			validateExpression(
				{ kind: 'function_call', functionId: 'study.macd', args: {}, outputName: 'bogus' },
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('unknown_output');
		expect(error.permittedVocabulary).toEqual(['macd', 'signal', 'histogram']);
	});

	it('test_explicit_output_name_on_a_multi_output_function_resolves_that_outputs_type', () => {
		const expression = expectValid(
			validateExpression(
				{ kind: 'function_call', functionId: 'study.macd', args: {}, outputName: 'signal' },
				builtinCatalogRegistry
			)
		);
		expect(expression.resultType).toBe('number');
	});

	it('test_single_output_function_defaults_its_output_name', () => {
		const expression = expectValid(
			validateExpression({ kind: 'function_call', functionId: 'study.sma', args: {} }, builtinCatalogRegistry)
		);
		const node = expression.node as { kind: 'function_call'; outputName: string };
		expect(node.outputName, 'a single-output function should not require an explicit outputName').toBe(
			'sma'
		);
	});
});

describe('validateExpression: cost limits (AC5)', () => {
	it('test_expression_exceeding_max_depth_is_rejected_naming_the_limit', () => {
		const deep = {
			kind: 'arithmetic' as const,
			op: '+' as const,
			left: {
				kind: 'arithmetic' as const,
				op: '+' as const,
				left: { kind: 'literal' as const, valueType: 'number' as const, value: 1 },
				right: { kind: 'literal' as const, valueType: 'number' as const, value: 1 }
			},
			right: { kind: 'literal' as const, valueType: 'number' as const, value: 1 }
		};
		const error = expectInvalid(
			validateExpression(deep, builtinCatalogRegistry, {
				maxDepth: 2,
				maxNodes: 100,
				maxLookbackBars: 500
			})
		);
		expect(error.reason).toBe('depth_exceeded');
		expect(error.permittedVocabulary).toEqual(['maxDepth=2']);
	});

	it('test_expression_exceeding_max_node_count_is_rejected_naming_the_limit', () => {
		const wide = {
			kind: 'arithmetic' as const,
			op: '+' as const,
			left: {
				kind: 'arithmetic' as const,
				op: '+' as const,
				left: { kind: 'literal' as const, valueType: 'number' as const, value: 1 },
				right: { kind: 'literal' as const, valueType: 'number' as const, value: 1 }
			},
			right: { kind: 'literal' as const, valueType: 'number' as const, value: 1 }
		};
		const error = expectInvalid(
			validateExpression(wide, builtinCatalogRegistry, {
				maxDepth: 10,
				maxNodes: 3,
				maxLookbackBars: 500
			})
		);
		expect(error.reason).toBe('node_count_exceeded');
		expect(error.permittedVocabulary).toEqual(['maxNodes=3']);
	});

	it('test_lookback_beyond_the_configured_limit_is_rejected_naming_the_limit', () => {
		const error = expectInvalid(
			validateExpression(
				{ kind: 'function_call', functionId: 'study.sma', args: { length: 20 } },
				builtinCatalogRegistry,
				{ maxDepth: 8, maxNodes: 64, maxLookbackBars: 5 }
			)
		);
		expect(error.reason).toBe('lookback_exceeded');
		expect(error.permittedVocabulary).toEqual(['maxLookbackBars=5']);
	});
});

describe('validateExpression: no arbitrary code execution (AC9)', () => {
	it('test_a_sql_string_smuggled_as_a_field_id_is_rejected_not_evaluated', () => {
		const error = expectInvalid(
			validateExpression(
				{ kind: 'field_ref', fieldId: "'; DROP TABLE users; --" },
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('unresolved_field');
	});

	it('test_a_javascript_expression_smuggled_as_a_function_id_is_rejected', () => {
		const error = expectInvalid(
			validateExpression(
				{ kind: 'function_call', functionId: '(() => fetch("/evil"))()', args: {} },
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('unresolved_function');
	});

	it('test_a_string_literal_value_is_accepted_as_inert_data_never_executed', () => {
		// A string literal is permitted -- it is data (e.g. an enum argument
		// value elsewhere), never parsed or executed. Confirms the model does
		// not overreach and reject legitimate string data.
		const expression = expectValid(
			validateExpression(
				{ kind: 'literal', valueType: 'string', value: "'; DROP TABLE users; --" },
				builtinCatalogRegistry
			)
		);
		expect(expression.resultType).toBe('string');
	});

	it('test_executable_text_smuggled_as_a_numeric_argument_is_rejected_by_type', () => {
		const error = expectInvalid(
			validateExpression(
				{
					kind: 'function_call',
					functionId: 'study.sma',
					args: { length: "'; DROP TABLE users; --" }
				},
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('argument_type_mismatch');
	});

	it('test_executable_text_smuggled_as_an_output_name_is_rejected', () => {
		const error = expectInvalid(
			validateExpression(
				{
					kind: 'function_call',
					functionId: 'study.macd',
					args: {},
					outputName: "'; DROP TABLE users; --"
				},
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('unknown_output');
	});

	it('test_executable_text_smuggled_as_an_arithmetic_operator_is_rejected', () => {
		const error = expectInvalid(
			validateExpression(
				{
					kind: 'arithmetic',
					op: 'fetch("/evil")',
					left: { kind: 'literal', valueType: 'number', value: 1 },
					right: { kind: 'literal', valueType: 'number', value: 1 }
				},
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('unknown_node_kind');
	});

	it('test_executable_text_smuggled_as_a_comparison_operator_is_rejected', () => {
		const error = expectInvalid(
			validateExpression(
				{
					kind: 'comparison',
					op: 'eval(x)',
					left: { kind: 'literal', valueType: 'number', value: 1 },
					right: { kind: 'literal', valueType: 'number', value: 1 }
				},
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('unknown_node_kind');
	});

	it('test_a_raw_sql_node_kind_is_rejected_regardless_of_its_payload', () => {
		const error = expectInvalid(
			validateExpression(
				{ kind: 'raw_sql', sql: 'DROP TABLE users' } as unknown,
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('unknown_node_kind');
	});

	it('test_a_javascript_node_kind_is_rejected_regardless_of_its_payload', () => {
		const error = expectInvalid(
			validateExpression(
				{ kind: 'javascript', code: 'fetch("/evil")' } as unknown,
				builtinCatalogRegistry
			)
		);
		expect(error.reason).toBe('unknown_node_kind');
	});

	it('test_a_bare_string_expression_payload_is_rejected_not_parsed', () => {
		const error = expectInvalid(
			validateExpression('field.price.close - field.volume', builtinCatalogRegistry)
		);
		expect(error.reason).toBe('unknown_node_kind');
	});

	it('test_a_prototype_pollution_key_on_a_node_is_ignored_and_never_pollutes_the_prototype', () => {
		const payload = JSON.parse(
			'{"kind":"literal","valueType":"number","value":5,"__proto__":{"polluted":true}}'
		);
		const expression = expectValid(validateExpression(payload, builtinCatalogRegistry));
		expect(expression.resultType).toBe('number');
		expect(
			(Object.prototype as unknown as Record<string, unknown>).polluted,
			'validation must never let a node payload pollute Object.prototype'
		).toBeUndefined();
	});

	it('test_none_of_the_new_expression_modules_contain_an_eval_or_dynamic_function_constructor', () => {
		// Vite's glob import rather than a filesystem walk: it needs no node
		// typings (the project has none) -- see paletteGuard.test.ts for the
		// same pattern.
		const sources = import.meta.glob(
			[
				'./expressionModel.ts',
				'./expressionLimits.ts',
				'./expressionErrors.ts',
				'./expressionValidator.ts',
				'./expressionEvaluator.ts'
			],
			{ eager: true, query: '?raw', import: 'default' }
		) as Record<string, string>;
		const files = Object.entries(sources);
		expect(files.length, 'expected exactly the five new expression module sources').toBe(5);
		// Word-boundary regexes, not plain substrings: a plain "Function("
		// check would false-positive on identifiers like `unresolvedFunction(`.
		const forbidden = [/\beval\(/, /\bnew\s+Function\b/, /(?<![A-Za-z0-9_])Function\(/, /\bsetTimeout\(/, /\bsetInterval\(/];
		for (const [file, source] of files) {
			for (const pattern of forbidden) {
				expect(
					pattern.test(source),
					`${file} matches ${pattern} -- no expression module may hand text to an interpreter`
				).toBe(false);
			}
		}
	});
});
