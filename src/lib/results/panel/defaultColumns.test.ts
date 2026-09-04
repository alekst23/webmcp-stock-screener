import { describe, expect, it } from 'vitest';
import { DEFAULT_RENDER_COLUMNS, renderColumnsFor } from './defaultColumns';
import type { ProjectedRow } from '../domain/projection';
import type { DisplayColumn } from '../domain/tableConfig';

function row(overrides: Partial<ProjectedRow> = {}): ProjectedRow {
	return {
		resultId: 'result_run_1_1',
		instrumentId: 'inst_1',
		ticker: null,
		symbol: 'SYM1',
		exchange: 'XNAS',
		assetType: 'equity',
		name: 'Test Instrument 1',
		rank: 1,
		compositeScore: 0.75,
		columns: { col_pe: 12.5 },
		groupValue: null,
		...overrides
	};
}

describe('renderColumnsFor', () => {
	it('falls back to the default identity columns when no columns are configured', () => {
		const columns = renderColumnsFor([]);
		expect(columns.map((c) => c.id)).toEqual(DEFAULT_RENDER_COLUMNS.map((c) => c.id));
	});

	it('the default rank column reads row.rank', () => {
		const [rankColumn] = renderColumnsFor([]);
		expect(rankColumn?.accessor(row({ rank: 7 }))).toBe(7);
	});

	it('the default instrument column prefers ticker, falling back to instrumentId', () => {
		const [, instrumentColumn] = renderColumnsFor([]);
		expect(instrumentColumn?.accessor(row({ ticker: 'AAPL', instrumentId: 'inst_x' }))).toBe(
			'AAPL'
		);
		expect(instrumentColumn?.accessor(row({ ticker: null, instrumentId: 'inst_x' }))).toBe(
			'inst_x'
		);
	});

	it('the default score column reads row.compositeScore', () => {
		const [, , scoreColumn] = renderColumnsFor([]);
		expect(scoreColumn?.accessor(row({ compositeScore: 0.42 }))).toBe(0.42);
	});

	it('maps configured columns to accessors reading row.columns by id, in the given order', () => {
		const configured: DisplayColumn[] = [
			{
				id: 'col_pe',
				identity: { source: 'catalog_field', fieldId: 'field.pe_ratio' },
				label: 'P/E',
				unit: 'x',
				valueType: 'number'
			}
		];
		const columns = renderColumnsFor(configured);
		expect(columns).toHaveLength(1);
		expect(columns[0]?.label).toBe('P/E');
		expect(columns[0]?.unit).toBe('x');
		expect(columns[0]?.accessor(row())).toBe(12.5);
	});

	it('a configured column with no matching entry in row.columns reads null, not undefined or a throw', () => {
		const configured: DisplayColumn[] = [
			{
				id: 'col_missing',
				identity: { source: 'catalog_field', fieldId: 'field.missing' },
				label: 'Missing',
				valueType: 'number'
			}
		];
		const [column] = renderColumnsFor(configured);
		expect(column?.accessor(row())).toBeNull();
	});
});
