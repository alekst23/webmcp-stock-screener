// Tests for T-1010-1: the results-table configuration domain model and
// validation. Uses the real seeded catalog (src/lib/catalog/items.ts) for
// realism -- 'field.price.close' and 'field.volume' are numeric fields,
// 'field.symbol' is a non-numeric field, per conditionValidation.test.ts's
// established fixture convention.
import { describe, expect, it } from 'vitest';
import { builtinCatalogRegistry, type CatalogRegistry } from '../../catalog/registry';
import {
	DEFAULT_PAGE_SIZE,
	MAX_PAGE_SIZE,
	parseExpression,
	PERMITTED_FUNCTIONS,
	validateResultsTableConfig,
	type ComputedColumn,
	type DisplayColumn,
	type FormattingRule,
	type ResultsTableConfig
} from './tableConfig';

function emptyConfig(overrides: Partial<ResultsTableConfig> = {}): ResultsTableConfig {
	return {
		columns: [],
		computedColumns: [],
		sort: null,
		grouping: null,
		formattingRules: [],
		pageSize: null,
		chartPanelId: null,
		...overrides
	};
}

function closeColumn(id = 'column_1'): DisplayColumn {
	return {
		id,
		identity: { source: 'catalog_field', fieldId: 'field.price.close' },
		label: 'Close',
		unit: 'USD',
		valueType: 'number'
	};
}

describe('parseExpression', () => {
	it('parses a simple arithmetic expression', () => {
		const result = parseExpression('field.volume / 2');
		expect(result.ok, 'a well-formed expression parses').toBe(true);
	});

	it('parses a dotted field identifier as a single field reference', () => {
		const result = parseExpression('field.price.close');
		expect(result.ok, 'dotted identifiers tokenize as one field reference').toBe(true);
		if (result.ok) {
			expect(result.ast).toEqual({ type: 'field', fieldId: 'field.price.close' });
		}
	});

	it('parses a function call with multiple arguments', () => {
		const result = parseExpression('max(field.volume, 100)');
		expect(result.ok, 'a call with args parses').toBe(true);
		if (result.ok) {
			expect(result.ast.type).toBe('call');
		}
	});

	it('rejects an empty expression', () => {
		const result = parseExpression('   ');
		expect(result.ok, 'an empty expression is a parse error').toBe(false);
	});

	it('rejects an unbalanced parenthesis', () => {
		const result = parseExpression('(field.volume + 1');
		expect(result.ok, 'a missing closing paren is a parse error').toBe(false);
	});

	it('rejects trailing garbage after a complete expression', () => {
		const result = parseExpression('field.volume + 1 )');
		expect(result.ok, 'unmatched trailing input is a parse error').toBe(false);
	});

	it('rejects a dangling operator', () => {
		const result = parseExpression('field.volume +');
		expect(result.ok, 'an operator with no right operand is a parse error').toBe(false);
	});
});

describe('validateResultsTableConfig: page size (AC5)', () => {
	it('resolves an unset page size to the documented default', () => {
		const result = validateResultsTableConfig(emptyConfig(), builtinCatalogRegistry);
		expect(result.ok, 'an otherwise-empty config is valid').toBe(true);
		if (result.ok) {
			expect(result.config.pageSize, 'unset page size resolves to the default').toBe(
				DEFAULT_PAGE_SIZE
			);
		}
	});

	it('accepts a page size exactly at the hard maximum', () => {
		const result = validateResultsTableConfig(
			emptyConfig({ pageSize: MAX_PAGE_SIZE }),
			builtinCatalogRegistry
		);
		expect(result.ok, 'the maximum itself is accepted, not just values below it').toBe(true);
	});

	it('rejects a page size above the hard maximum, naming the maximum', () => {
		const result = validateResultsTableConfig(
			emptyConfig({ pageSize: MAX_PAGE_SIZE + 1 }),
			builtinCatalogRegistry
		);
		expect(result.ok, 'an over-maximum page size is rejected rather than clamped').toBe(false);
		if (!result.ok) {
			expect(result.rejections[0]?.code).toBe('page_size_over_maximum');
			expect(result.rejections[0]?.message, 'the rejection names the maximum').toContain(
				String(MAX_PAGE_SIZE)
			);
		}
	});

	it('rejects a non-positive page size', () => {
		const result = validateResultsTableConfig(emptyConfig({ pageSize: 0 }), builtinCatalogRegistry);
		expect(result.ok, 'a zero page size is meaningless and rejected').toBe(false);
	});
});

describe('validateResultsTableConfig: display columns (AC2, AC4)', () => {
	it('accepts a column backed by a real catalog field', () => {
		const result = validateResultsTableConfig(
			emptyConfig({ columns: [closeColumn()] }),
			builtinCatalogRegistry
		);
		expect(result.ok, 'a column over a real numeric field is valid').toBe(true);
	});

	it('rejects a column referencing an unknown catalog field, naming it and applying nothing partial', () => {
		const badColumn: DisplayColumn = {
			id: 'column_1',
			identity: { source: 'catalog_field', fieldId: 'field.does_not_exist' },
			label: 'Bogus',
			valueType: 'number'
		};
		const result = validateResultsTableConfig(
			emptyConfig({ columns: [badColumn, closeColumn('column_2')] }),
			builtinCatalogRegistry
		);
		expect(result.ok, 'an unknown catalog field rejects the whole configuration').toBe(false);
		if (!result.ok) {
			expect(result.rejections[0]?.code).toBe('unknown_catalog_field');
			expect(result.rejections[0]?.message, 'names the offending field').toContain(
				'field.does_not_exist'
			);
			// AC4: no partially applied result -- the failure carries only
			// rejections, never a config the caller could mistake for accepted.
			expect(
				(result as { config?: unknown }).config,
				'no config leaks on rejection'
			).toBeUndefined();
		}
	});

	it('rejects duplicate column ids', () => {
		const result = validateResultsTableConfig(
			emptyConfig({ columns: [closeColumn('column_1'), closeColumn('column_1')] }),
			builtinCatalogRegistry
		);
		expect(result.ok, 'two columns sharing an id is rejected').toBe(false);
		if (!result.ok) {
			expect(result.rejections.some((r) => r.code === 'duplicate_column_id')).toBe(true);
		}
	});

	it('accepts a column backed by a computed column defined in the same configuration', () => {
		const computed: ComputedColumn = {
			id: 'column_computed_1',
			label: 'Turnover',
			valueType: 'number',
			expression: 'field.volume * field.price.close'
		};
		const column: DisplayColumn = {
			id: 'column_1',
			identity: { source: 'computed_column', computedColumnId: 'column_computed_1' },
			label: 'Turnover',
			valueType: 'number'
		};
		const result = validateResultsTableConfig(
			emptyConfig({ computedColumns: [computed], columns: [column] }),
			builtinCatalogRegistry
		);
		expect(result.ok, 'a column backed by a locally-defined computed column is valid').toBe(true);
	});

	it('rejects a column referencing a computed column id that does not exist', () => {
		const column: DisplayColumn = {
			id: 'column_1',
			identity: { source: 'computed_column', computedColumnId: 'column_missing' },
			label: 'Ghost',
			valueType: 'number'
		};
		const result = validateResultsTableConfig(
			emptyConfig({ columns: [column] }),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejections[0]?.code).toBe('unknown_computed_column');
		}
	});
});

describe('validateResultsTableConfig: computed columns (AC3)', () => {
	it('accepts a computed column over permitted fields and functions', () => {
		const computed: ComputedColumn = {
			id: 'column_computed_1',
			label: 'Turnover',
			valueType: 'number',
			expression: 'round(field.volume * field.price.close)'
		};
		const result = validateResultsTableConfig(
			emptyConfig({ computedColumns: [computed] }),
			builtinCatalogRegistry
		);
		expect(result.ok, 'an expression over permitted fields/functions is valid').toBe(true);
	});

	it('rejects a malformed expression with the parse error and the permitted lists', () => {
		const computed: ComputedColumn = {
			id: 'column_computed_1',
			label: 'Bad',
			valueType: 'number',
			expression: 'field.volume +'
		};
		const result = validateResultsTableConfig(
			emptyConfig({ computedColumns: [computed] }),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejections[0]?.code).toBe('computed_column_parse_error');
			expect(result.rejections[0]?.message, 'carries the permitted functions list').toContain(
				PERMITTED_FUNCTIONS[0]
			);
		}
	});

	it('rejects an expression referencing a field outside the permitted set', () => {
		const computed: ComputedColumn = {
			id: 'column_computed_1',
			label: 'Bad',
			valueType: 'number',
			expression: 'field.does_not_exist + 1'
		};
		const result = validateResultsTableConfig(
			emptyConfig({ computedColumns: [computed] }),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejections[0]?.code).toBe('computed_column_disallowed_field');
			expect(result.rejections[0]?.message).toContain('field.does_not_exist');
		}
	});

	it('rejects an expression referencing a non-numeric catalog field', () => {
		// field.symbol exists but is a string field, not permitted in a formula.
		const computed: ComputedColumn = {
			id: 'column_computed_1',
			label: 'Bad',
			valueType: 'number',
			expression: 'field.symbol'
		};
		const result = validateResultsTableConfig(
			emptyConfig({ computedColumns: [computed] }),
			builtinCatalogRegistry
		);
		expect(result.ok, 'a non-numeric field is outside the permitted set for a formula').toBe(false);
	});

	it('rejects an expression calling a function outside the permitted set', () => {
		const computed: ComputedColumn = {
			id: 'column_computed_1',
			label: 'Bad',
			valueType: 'number',
			expression: 'eval(field.volume)'
		};
		const result = validateResultsTableConfig(
			emptyConfig({ computedColumns: [computed] }),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejections[0]?.code).toBe('computed_column_disallowed_function');
		}
	});

	it('rejects duplicate computed column ids', () => {
		const computed: ComputedColumn = {
			id: 'column_computed_1',
			label: 'A',
			valueType: 'number',
			expression: 'field.volume'
		};
		const result = validateResultsTableConfig(
			emptyConfig({ computedColumns: [computed, { ...computed, label: 'B' }] }),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejections.some((r) => r.code === 'duplicate_computed_column_id')).toBe(true);
		}
	});
});

describe('validateResultsTableConfig: sort (AC1, AC6)', () => {
	it('accepts a sort key backed by a real field and defaults a deterministic tie-break', () => {
		const result = validateResultsTableConfig(
			emptyConfig({
				columns: [closeColumn()],
				sort: { key: { source: 'catalog_field', fieldId: 'field.price.close' }, direction: 'desc' }
			}),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.config.sort?.tieBreak, 'a deterministic tie-break is always present').toEqual({
				source: 'result_id'
			});
		}
	});

	it('accepts a sort key not among the displayed columns but warns it is not visible', () => {
		const result = validateResultsTableConfig(
			emptyConfig({
				columns: [],
				sort: { key: { source: 'catalog_field', fieldId: 'field.price.close' }, direction: 'asc' }
			}),
			builtinCatalogRegistry
		);
		expect(result.ok, 'a hidden but valid sort key does not block the configuration').toBe(true);
		if (result.ok) {
			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.warnings[0]?.code).toBe('sort_key_not_visible');
			expect(result.warnings[0]?.message).toContain('field.price.close');
		}
	});

	it('rejects a sort key that is not a known field or computed column', () => {
		const result = validateResultsTableConfig(
			emptyConfig({
				sort: { key: { source: 'catalog_field', fieldId: 'field.nope' }, direction: 'asc' }
			}),
			builtinCatalogRegistry
		);
		expect(result.ok, 'an unknown sort key is rejected, not merely warned about').toBe(false);
	});
});

describe('validateResultsTableConfig: grouping (AC1, AC6)', () => {
	it('accepts a grouping key not among the displayed columns but warns it is not visible', () => {
		const result = validateResultsTableConfig(
			emptyConfig({
				grouping: { key: { source: 'catalog_field', fieldId: 'field.sector' } }
			}),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.warnings.some((w) => w.code === 'grouping_key_not_visible')).toBe(true);
		}
	});
});

describe('validateResultsTableConfig: formatting rules (AC1, AC7)', () => {
	it('accepts a rule whose predicate references a displayed column', () => {
		const column = closeColumn();
		const rule: FormattingRule = {
			id: 'rule_1',
			predicate: { columnId: column.id, comparator: 'gt', value: 100 },
			style: { backgroundColor: '#0f0' }
		};
		const result = validateResultsTableConfig(
			emptyConfig({ columns: [column], formattingRules: [rule] }),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(true);
	});

	it('rejects a rule referencing a column outside the configuration, naming the rule and the column', () => {
		const rule: FormattingRule = {
			id: 'rule_1',
			predicate: { columnId: 'column_missing', comparator: 'gt', value: 100 },
			style: {}
		};
		const result = validateResultsTableConfig(
			emptyConfig({ formattingRules: [rule] }),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejections[0]?.code).toBe('formatting_rule_unknown_column');
			expect(result.rejections[0]?.message).toContain('rule_1');
			expect(result.rejections[0]?.message).toContain('column_missing');
		}
	});

	it('rejects duplicate formatting rule ids', () => {
		const column = closeColumn();
		const rule: FormattingRule = {
			id: 'rule_1',
			predicate: { columnId: column.id, comparator: 'gt', value: 1 },
			style: {}
		};
		const result = validateResultsTableConfig(
			emptyConfig({ columns: [column], formattingRules: [rule, { ...rule }] }),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejections.some((r) => r.code === 'duplicate_rule_id')).toBe(true);
		}
	});
});

describe('validateResultsTableConfig: chart panel id', () => {
	it('accepts a well-formed panel id', () => {
		const result = validateResultsTableConfig(
			emptyConfig({ chartPanelId: 'panel_chart_1' }),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(true);
	});

	it('rejects a chart panel id that does not parse as a panel-kind resource id', () => {
		const result = validateResultsTableConfig(
			emptyConfig({ chartPanelId: 'not-a-panel-id' }),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejections[0]?.code).toBe('invalid_chart_panel_id');
		}
	});

	it('rejects a resource id of the wrong kind', () => {
		const result = validateResultsTableConfig(
			emptyConfig({ chartPanelId: 'run_1' }),
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(false);
	});
});

describe('validateResultsTableConfig: purity (AC8)', () => {
	it('is a deterministic pure function of its inputs', () => {
		const config = emptyConfig({
			columns: [closeColumn()],
			pageSize: 50,
			sort: { key: { source: 'catalog_field', fieldId: 'field.price.close' }, direction: 'asc' }
		});
		const first = validateResultsTableConfig(config, builtinCatalogRegistry);
		const second = validateResultsTableConfig(config, builtinCatalogRegistry);
		expect(first).toEqual(second);
	});

	it('never mutates the config object it is given', () => {
		const config = emptyConfig({ columns: [closeColumn()], pageSize: 50 });
		const snapshot = JSON.parse(JSON.stringify(config));
		validateResultsTableConfig(config, builtinCatalogRegistry);
		expect(config).toEqual(snapshot);
	});
});

describe('validateResultsTableConfig: happy path end-to-end', () => {
	it('accepts a fully-populated configuration with no warnings', () => {
		const column = closeColumn();
		const computed: ComputedColumn = {
			id: 'column_computed_1',
			label: 'Turnover',
			valueType: 'number',
			expression: 'field.volume * field.price.close'
		};
		const computedColumnDisplay: DisplayColumn = {
			id: 'column_2',
			identity: { source: 'computed_column', computedColumnId: computed.id },
			label: 'Turnover',
			unit: 'USD',
			valueType: 'number'
		};
		const config = emptyConfig({
			columns: [column, computedColumnDisplay],
			computedColumns: [computed],
			sort: { key: { source: 'catalog_field', fieldId: 'field.price.close' }, direction: 'desc' },
			grouping: { key: { source: 'catalog_field', fieldId: 'field.sector' } },
			formattingRules: [
				{
					id: 'rule_1',
					predicate: { columnId: column.id, comparator: 'gt', value: 100 },
					style: { backgroundColor: '#0f0' }
				}
			],
			pageSize: 50,
			chartPanelId: 'panel_chart_1'
		});
		const result = validateResultsTableConfig(config, builtinCatalogRegistry);
		expect(result.ok, 'a well-formed, fully-populated configuration is accepted').toBe(true);
		if (result.ok) {
			// grouping key "field.sector" is not among the displayed columns.
			expect(result.warnings.length).toBe(1);
			expect(result.warnings[0]?.code).toBe('grouping_key_not_visible');
			expect(result.config.pageSize).toBe(50);
		}
	});
});

describe('CatalogRegistry injection (AC8: no catalog client reached from the domain)', () => {
	it('works against a minimal hand-rolled registry, not just the built-in one', () => {
		const fixture: CatalogRegistry = {
			getCatalogItem: (id) =>
				id === 'field.custom'
					? {
							kind: 'field',
							id: 'field.custom',
							label: 'Custom',
							description: '',
							aliases: [],
							tags: [],
							availability: { status: 'available', intervalIds: [], requiresReferenceData: false },
							valueType: 'number',
							nullable: false
						}
					: undefined,
			listCatalogItems: (kind) =>
				kind === 'field' || kind === undefined
					? [
							{
								kind: 'field',
								id: 'field.custom',
								label: 'Custom',
								description: '',
								aliases: [],
								tags: [],
								availability: {
									status: 'available',
									intervalIds: [],
									requiresReferenceData: false
								},
								valueType: 'number',
								nullable: false
							}
						]
					: [],
			searchCatalogItems: () => [],
			isOperatorValidForField: () => ({ valid: false, reason: 'not used in this fixture' }),
			resolveStudy: () => undefined,
			suggestCatalogIds: () => []
		};
		const column: DisplayColumn = {
			id: 'column_1',
			identity: { source: 'catalog_field', fieldId: 'field.custom' },
			label: 'Custom',
			valueType: 'number'
		};
		const result = validateResultsTableConfig(emptyConfig({ columns: [column] }), fixture);
		expect(result.ok, 'validation works against any injected CatalogRegistry').toBe(true);
	});
});
