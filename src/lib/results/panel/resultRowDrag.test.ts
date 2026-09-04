import { describe, expect, it } from 'vitest';
import type { ResultRow } from '../domain/page';
import { resultRowToPanelSource, UNKNOWN_EXCHANGE } from './resultRowDrag';

function row(overrides: Partial<ResultRow> = {}): ResultRow {
	return {
		resultId: 'result_1',
		instrumentId: 'inst:XNAS:AAPL',
		ticker: 'AAPL',
		rank: 1,
		compositeScore: 0.9,
		...overrides
	};
}

describe('resultRowToPanelSource', () => {
	it('builds an "instrument" source ref carrying the row\'s canonical instrument ID', () => {
		const source = resultRowToPanelSource(row());
		expect(source.type).toBe('instrument');
		expect(source.ref).toEqual({
			instrument: {
				instrument_id: 'inst:XNAS:AAPL',
				symbol: 'AAPL',
				exchange: UNKNOWN_EXCHANGE,
				asset_type: 'equity'
			}
		});
	});

	it('falls back to the instrument ID as the symbol when ticker is null', () => {
		const source = resultRowToPanelSource(row({ ticker: null }));
		expect((source.ref.instrument as { symbol: string }).symbol).toBe('inst:XNAS:AAPL');
	});
});
