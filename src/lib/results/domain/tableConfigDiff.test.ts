import { describe, expect, it } from 'vitest';
import { describeResultsTableConfigChange } from './tableConfigDiff';
import type { DisplayColumn, ResultsTableConfig } from './tableConfig';

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
		valueType: 'number'
	};
}

function volumeColumn(id = 'column_2'): DisplayColumn {
	return {
		id,
		identity: { source: 'catalog_field', fieldId: 'field.volume' },
		label: 'Volume',
		valueType: 'number'
	};
}

describe('describeResultsTableConfigChange (T-1010-6, AC2)', () => {
	it('reports no changes when nothing differs', () => {
		const config = emptyConfig({ columns: [closeColumn()] });
		expect(describeResultsTableConfigChange(config, config)).toBe(
			'no changes to the table configuration'
		);
	});

	it('names an added column by its label, not the whole configuration', () => {
		const previous = emptyConfig({ columns: [closeColumn()] });
		const next = emptyConfig({ columns: [closeColumn(), volumeColumn()] });
		const summary = describeResultsTableConfigChange(previous, next);
		expect(summary).toContain('added column "Volume"');
		expect(summary).not.toContain('Close'); // unchanged column isn't restated
	});

	it('names a removed column by its label', () => {
		const previous = emptyConfig({ columns: [closeColumn(), volumeColumn()] });
		const next = emptyConfig({ columns: [closeColumn()] });
		expect(describeResultsTableConfigChange(previous, next)).toContain('removed column "Volume"');
	});

	it('describes how the sort changed', () => {
		const previous = emptyConfig({ columns: [closeColumn()] });
		const next = emptyConfig({
			columns: [closeColumn()],
			sort: { key: { source: 'catalog_field', fieldId: 'field.price.close' }, direction: 'asc' }
		});
		const summary = describeResultsTableConfigChange(previous, next);
		expect(summary).toContain('sorted by "Close" (asc)');
	});

	it('reports a cleared sort distinctly from a changed one', () => {
		const previous = emptyConfig({
			columns: [closeColumn()],
			sort: { key: { source: 'catalog_field', fieldId: 'field.price.close' }, direction: 'asc' }
		});
		const next = emptyConfig({ columns: [closeColumn()] });
		expect(describeResultsTableConfigChange(previous, next)).toBe('cleared the sort');
	});

	it('does not mention the sort when it is unchanged', () => {
		const config = emptyConfig({
			columns: [closeColumn(), volumeColumn()],
			sort: { key: { source: 'catalog_field', fieldId: 'field.price.close' }, direction: 'asc' }
		});
		const next = { ...config, columns: [closeColumn()] };
		expect(describeResultsTableConfigChange(config, next)).not.toContain('sort');
	});

	it('combines multiple changes into one plain-language sentence', () => {
		const previous = emptyConfig({ columns: [closeColumn()], pageSize: 25 });
		const next = emptyConfig({ columns: [volumeColumn()], pageSize: 50 });
		const summary = describeResultsTableConfigChange(previous, next);
		expect(summary).toContain('added column "Volume"');
		expect(summary).toContain('removed column "Close"');
		expect(summary).toContain('page size changed to 50');
	});
});
