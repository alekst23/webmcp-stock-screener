import { describe, expect, it } from 'vitest';
import { buildWebmcpStatus, formatAgentToolsContext, formatWebmcpStatus } from './status';

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

// hotfix/workbench-ui-refactor: this text is embedded in an HTML comment,
// never rendered visibly -- it's the only place the tool-name list is
// spelled out, so it must actually explain what the tools are.
describe('formatAgentToolsContext', () => {
	it('includes the tool count, every tool name, and how to call them', () => {
		const result = formatAgentToolsContext({
			toolCount: 2,
			toolNames: ['defineStudy', 'getWorkspace']
		});

		expect(result).toContain('2');
		expect(result).toContain('defineStudy');
		expect(result).toContain('getWorkspace');
		expect(result).toContain('document.modelContext');
	});

	it('is not just a bare name list -- it reads as a sentence with a preface', () => {
		const result = formatAgentToolsContext({ toolCount: 1, toolNames: ['getWorkspace'] });

		expect(result.length).toBeGreaterThan('getWorkspace'.length + 20);
		expect(result).toMatch(/^WebMCP agent context:/);
	});

	it('tells the agent to treat document.modelContext as the live source, not this static list', () => {
		const result = formatAgentToolsContext({ toolCount: 1, toolNames: ['getWorkspace'] });

		expect(result).toContain('not necessarily what');
		expect(result).toContain('authoritative');
	});
});
