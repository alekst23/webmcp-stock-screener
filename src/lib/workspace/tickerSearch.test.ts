import { describe, expect, it } from 'vitest';
import { parseTickers } from './tickerSearch';

// hotfix/marketpane-rebrand moved the ticker/universe filter out of
// ChartToolbar into the header, but the spec is explicit that the parsing
// itself must not change -- these are the same cases ChartToolbar's inline
// parseTickers() covered before the extraction.
describe('parseTickers', () => {
	it('splits on commas and uppercases each ticker', () => {
		expect(parseTickers('mock02, mock03')).toEqual(['MOCK02', 'MOCK03']);
	});

	it('splits on whitespace as well as commas', () => {
		expect(parseTickers('aapl msft  goog')).toEqual(['AAPL', 'MSFT', 'GOOG']);
	});

	it('drops empty entries left by stray separators', () => {
		expect(parseTickers(' aapl, , msft,')).toEqual(['AAPL', 'MSFT']);
	});

	it('returns an empty list for blank input', () => {
		expect(parseTickers('   ')).toEqual([]);
	});
});
