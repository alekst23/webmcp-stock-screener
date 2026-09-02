import { describe, expect, it } from 'vitest';
import {
	defaultWireResultsTableConfig,
	parseWireResultsTableConfig,
	toWireResultsTableConfig
} from './tableConfigWire';

const FULL_WIRE_CONFIG = {
	columns: [
		{
			id: 'column_1',
			identity: { source: 'catalog_field', field_id: 'field.price.close' },
			label: 'Close',
			value_type: 'number'
		}
	],
	computed_columns: [
		{
			id: 'computed_1',
			label: 'Ratio',
			expression: 'field.volume / 2',
			value_type: 'number'
		}
	],
	sort: {
		key: { source: 'catalog_field', field_id: 'field.price.close' },
		direction: 'asc',
		tie_break: { source: 'result_id' },
		tie_break_direction: 'asc'
	},
	grouping: { key: { source: 'catalog_field', field_id: 'field.price.close' } },
	formatting_rules: [
		{
			id: 'rule_1',
			predicate: { column_id: 'column_1', comparator: 'gt', value: 100 },
			style: { background_color: '#f00', text_color: '#fff', icon: 'flag' }
		}
	],
	page_size: 50,
	chart_panel_id: 'panel_chart_1'
};

describe('parseWireResultsTableConfig', () => {
	it('parses a fully-populated wire config into the domain shape', () => {
		const result = parseWireResultsTableConfig(FULL_WIRE_CONFIG);
		expect(result.ok, 'a well-formed wire config must parse').toBe(true);
		if (!result.ok) return;
		expect(result.config.columns[0]?.identity).toEqual({
			source: 'catalog_field',
			fieldId: 'field.price.close'
		});
		expect(result.config.sort?.direction).toBe('asc');
		expect(result.config.pageSize).toBe(50);
		expect(result.config.chartPanelId).toBe('panel_chart_1');
	});

	it('treats every absent field as its empty default rather than an error', () => {
		const result = parseWireResultsTableConfig({});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.config).toEqual({
			columns: [],
			computedColumns: [],
			sort: null,
			grouping: null,
			formattingRules: [],
			pageSize: null,
			chartPanelId: null
		});
	});

	it('rejects a non-object input', () => {
		const result = parseWireResultsTableConfig('nope');
		expect(result.ok).toBe(false);
	});

	it('rejects a malformed column with a field path pointing at the exact problem', () => {
		const result = parseWireResultsTableConfig({
			columns: [{ id: 'column_1', label: 'Close', identity: { source: 'catalog_field' } }]
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors[0]?.field).toBe('columns[0].identity.field_id');
	});

	it('rejects an unknown identity source', () => {
		const result = parseWireResultsTableConfig({
			sort: { key: { source: 'nonsense' }, direction: 'asc' }
		});
		expect(result.ok).toBe(false);
	});

	it('rejects an invalid sort direction', () => {
		const result = parseWireResultsTableConfig({
			sort: { key: { source: 'result_id' }, direction: 'sideways' }
		});
		expect(result.ok).toBe(false);
	});
});

describe('toWireResultsTableConfig / parseWireResultsTableConfig round trip', () => {
	it('round-trips a fully-populated config back to the same wire shape', () => {
		const parsed = parseWireResultsTableConfig(FULL_WIRE_CONFIG);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(toWireResultsTableConfig(parsed.config)).toEqual(FULL_WIRE_CONFIG);
	});
});

describe('defaultWireResultsTableConfig', () => {
	it('produces an empty, valid wire config', () => {
		const config = defaultWireResultsTableConfig();
		const parsed = parseWireResultsTableConfig(config);
		expect(parsed.ok).toBe(true);
		expect(config.columns).toEqual([]);
		expect(config.sort).toBeNull();
	});
});
