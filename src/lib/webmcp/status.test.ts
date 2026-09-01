import { describe, expect, it } from 'vitest';
import { formatWebmcpStatus } from './status';

describe('formatWebmcpStatus', () => {
	it('formats as count and "tools available"', () => {
		const result = formatWebmcpStatus({ toolCount: 11 });
		expect(result).toBe('11 tools available');
	});

	it('reflects the exact tool count passed in, not a capped or rounded value', () => {
		const result = formatWebmcpStatus({ toolCount: 42 });
		expect(result).toContain('42');
	});

	it('never mentions connection state', () => {
		const result = formatWebmcpStatus({ toolCount: 11 });
		expect(result.toLowerCase()).not.toContain('connected');
		expect(result.toLowerCase()).not.toContain('unavailable');
	});
});
