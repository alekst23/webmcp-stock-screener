import { describe, expect, it } from 'vitest';
import { formatColumnValue } from './formatColumnValue';

describe('formatColumnValue', () => {
	it('renders null as an em dash, never a fabricated placeholder', () => {
		expect(formatColumnValue(null, null)).toBe('—');
		expect(formatColumnValue(null, 'USD')).toBe('—');
	});

	it('renders booleans as Yes/No', () => {
		expect(formatColumnValue(true, null)).toBe('Yes');
		expect(formatColumnValue(false, null)).toBe('No');
	});

	it('renders an integer without decimals and a fractional number to two places', () => {
		expect(formatColumnValue(42, null)).toBe('42');
		expect(formatColumnValue(3.14159, null)).toBe('3.14');
	});

	it('appends a unit to a number when present', () => {
		expect(formatColumnValue(42, 'USD')).toBe('42 USD');
		expect(formatColumnValue(3.5, '%')).toBe('3.50 %');
	});

	it('appends a unit to a string when present', () => {
		expect(formatColumnValue('AAPL', null)).toBe('AAPL');
		expect(formatColumnValue('AAPL', 'ticker')).toBe('AAPL ticker');
	});
});
