import { describe, expect, it } from 'vitest';
import { buildWebmcpStatus, formatWebmcpStatus } from './status';

describe('formatWebmcpStatus', () => {
	it('formats as count and "tools available"', () => {
		const result = formatWebmcpStatus({ toolCount: 11, toolNames: [] });
		expect(result).toBe('11 tools available');
	});

	it('reflects the exact tool count passed in, not a capped or rounded value', () => {
		const result = formatWebmcpStatus({ toolCount: 42, toolNames: [] });
		expect(result).toContain('42');
	});

	it('never mentions connection state', () => {
		const result = formatWebmcpStatus({ toolCount: 11, toolNames: [] });
		expect(result.toLowerCase()).not.toContain('connected');
		expect(result.toLowerCase()).not.toContain('unavailable');
	});

	it('is unaffected by toolNames -- the name list is not folded into this string', () => {
		const result = formatWebmcpStatus({ toolCount: 2, toolNames: ['defineStudy', 'getWorkspace'] });
		expect(result).toBe('2 tools available');
	});
});

// hotfix/workbench-ui-refactor: pairs the count with the full tool-name
// list so the header can list every tool the app defines, not just a count.
describe('buildWebmcpStatus', () => {
	it('returns the tool count and the ordered list of tool names', () => {
		const tools = [{ name: 'defineStudy' }, { name: 'getWorkspace' }];

		const status = buildWebmcpStatus(tools);

		expect(status).toEqual({ toolCount: 2, toolNames: ['defineStudy', 'getWorkspace'] });
	});

	it('returns an empty name list and zero count for no tools', () => {
		const status = buildWebmcpStatus([]);

		expect(status).toEqual({ toolCount: 0, toolNames: [] });
	});
});
