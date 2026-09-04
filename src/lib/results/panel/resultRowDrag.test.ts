import { describe, expect, it } from 'vitest';
import type { ResultRow } from '../domain/page';
import { resultRowToPanelSource } from './resultRowDrag';

function row(overrides: Partial<ResultRow> = {}): ResultRow {
	return {
		resultId: 'result_1',
		instrumentId: 'inst:XNAS:AAPL',
		ticker: 'AAPL',
		symbol: 'AAPL',
		exchange: 'XNAS',
		assetType: 'equity',
		name: 'AAPL',
		rank: 1,
		compositeScore: 0.9,
		...overrides
	};
}

describe('resultRowToPanelSource', () => {
	it('builds an "instrument" source ref carrying the row\'s full instrument reference', () => {
		const source = resultRowToPanelSource(row());
		expect(source.type).toBe('instrument');
		expect(source.ref).toEqual({
			instrument: {
				instrument_id: 'inst:XNAS:AAPL',
				symbol: 'AAPL',
				exchange: 'XNAS',
				asset_type: 'equity'
			}
		});
	});

	it("carries the row's own exchange/asset type through unchanged, honest fallback included", () => {
		const source = resultRowToPanelSource(row({ exchange: 'XUNK', assetType: 'equity' }));
		expect(source.ref).toEqual({
			instrument: {
				instrument_id: 'inst:XNAS:AAPL',
				symbol: 'AAPL',
				exchange: 'XUNK',
				asset_type: 'equity'
			}
		});
	});
});
