import { describe, expect, it } from 'vitest';
import {
	buildWebmcpStatus,
	formatAgentToolsContext,
	formatAvailableStatus,
	formatBridgeStatus,
	formatDefinedStatus
} from './status';

describe('formatDefinedStatus', () => {
	// hotfix/webmcp-bridge-status: "available" used to be the word here, and
	// it read as "callable" to a real agent that could not call anything.
	// "defined" is what spec.md's prose already called this number.
	it('formats as count and "WebMCP tools defined"', () => {
		const result = formatDefinedStatus({ toolCount: 11, toolNames: [] });
		expect(result).toBe('11 WebMCP tools defined');
	});

	it('reflects the exact tool count passed in, not a capped or rounded value', () => {
		const result = formatDefinedStatus({ toolCount: 42, toolNames: [] });
		expect(result).toContain('42');
	});

	// Still guards a real invariant: bridge state lives in formatBridgeStatus
	// and a separate element, so this string must never imply callability.
	it('never mentions connection state', () => {
		const result = formatDefinedStatus({ toolCount: 11, toolNames: [] });
		expect(result.toLowerCase()).not.toContain('connected');
		expect(result.toLowerCase()).not.toContain('unavailable');
	});

	it('is unaffected by toolNames -- the name list is not folded into this string', () => {
		const result = formatDefinedStatus({
			toolCount: 2,
			toolNames: ['run_screener', 'create_panel']
		});
		expect(result).toBe('2 WebMCP tools defined');
	});
});

// hotfix/webmcp-bridge-status: the second, live count. Unlike the defined
// count this one does track feature #10's progressive availability.
describe('formatAvailableStatus', () => {
	it('formats the live registered count', () => {
		expect(formatAvailableStatus(5)).toBe('5 available');
	});

	it('reports zero as a real number, not an absence', () => {
		const result = formatAvailableStatus(0);
		expect(result).toBe('0 available');
	});
});

// hotfix/webmcp-bridge-status: four states, each a distinct real condition.
describe('formatBridgeStatus', () => {
	it('reports a connected bridge', () => {
		const result = formatBridgeStatus('connected').toLowerCase();
		expect(result).toContain('connected');
	});

	it('reports a failed connection', () => {
		const failed = formatBridgeStatus('failed').toLowerCase();
		expect(failed).toContain('fail');
	});

	// The regression: the header blamed the browser for a capability the page
	// now supplies itself, and a working tool surface was suppressed behind
	// that guess. No state may name the browser as a cause again.
	it('never blames the browser in any state', () => {
		const states = ['connecting', 'connected', 'failed'] as const;

		for (const state of states) {
			const result = formatBridgeStatus(state).toLowerCase();
			expect(
				result,
				`state "${state}" must not attribute anything to the browser, got: ${result}`
			).not.toContain('browser');
			expect(result, `state "${state}" must not report unavailability`).not.toContain(
				'unavailable'
			);
		}
	});

	// The precise failure this change exists to prevent: claiming a live
	// bridge before one exists. "connecting" contains "connect", so the
	// assertion is word-boundaried rather than a substring check.
	it('never claims to be connected while still connecting', () => {
		const result = formatBridgeStatus('connecting').toLowerCase();
		expect(result, `"connecting" must not read as connected, got: ${result}`).not.toMatch(
			/\bconnected\b/
		);
	});

	it('returns a distinct string for every state', () => {
		const states = ['connecting', 'connected', 'failed'] as const;
		const rendered = states.map((s) => formatBridgeStatus(s));

		expect(
			new Set(rendered).size,
			`expected 3 distinct strings, got: ${rendered.join(' | ')}`
		).toBe(3);
	});
});

// hotfix/workbench-ui-refactor: pairs the count with the full tool-name
// list so the header can list every tool the app defines, not just a count.
describe('buildWebmcpStatus', () => {
	it('returns the tool count and the ordered list of tool names', () => {
		const tools = [{ name: 'run_screener' }, { name: 'create_panel' }];

		const status = buildWebmcpStatus(tools);

		expect(status).toEqual({ toolCount: 2, toolNames: ['run_screener', 'create_panel'] });
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
		const result = formatAgentToolsContext(
			{ toolCount: 2, toolNames: ['run_screener', 'create_panel'] },
			'connected'
		);

		expect(result).toContain('2');
		expect(result).toContain('run_screener');
		expect(result).toContain('create_panel');
		expect(result).toContain('document.modelContext');
	});

	it('is not just a bare name list -- it reads as a sentence with a preface', () => {
		const result = formatAgentToolsContext(
			{ toolCount: 1, toolNames: ['create_panel'] },
			'connected'
		);

		expect(result.length).toBeGreaterThan('create_panel'.length + 20);
		expect(result).toMatch(/^WebMCP agent context:/);
	});

	it('tells the agent to treat document.modelContext as the live source, not this static list', () => {
		const result = formatAgentToolsContext(
			{ toolCount: 1, toolNames: ['create_panel'] },
			'connected'
		);

		expect(result).toContain('not necessarily what');
		expect(result).toContain('authoritative');
	});

	// The page supplies its own document.modelContext, so a client with no
	// native WebMCP support can still drive the surface -- but only if the
	// comment says how. Without this the reader is back to diagnosing an
	// apparently dead tool list unaided.
	it('tells a connected reader how to call the tools directly', () => {
		const result = formatAgentToolsContext(
			{ toolCount: 2, toolNames: ['run_screener', 'get_chart_data'] },
			'connected'
		);
		const lower = result.toLowerCase();

		expect(lower, `expected executeTool named, got: ${result}`).toContain(
			'document.modelcontext.executetool'
		);
		expect(lower, `expected getTools named, got: ${result}`).toContain(
			'document.modelcontext.gettools'
		);
	});

	// No state may tell a reader its browser is the problem: that claim sent a
	// real agent to the UI fallback while a callable surface sat on
	// document.modelContext.
	it('never tells the reader the browser lacks a bridge', () => {
		const states = ['connecting', 'connected', 'failed'] as const;
		const status = { toolCount: 2, toolNames: ['run_screener', 'get_chart_data'] };

		for (const state of states) {
			const lower = formatAgentToolsContext(status, state).toLowerCase();
			expect(lower, `state "${state}" must not claim the bridge is absent`).not.toContain(
				'is not connected here'
			);
			expect(lower, `state "${state}" must not blame the browser`).not.toContain('in this browser');
		}
	});

	// hotfix/webmcp-bridge-status: the connected branch used to label the full
	// defined list "Available tools:" -- the exact word the header was moved
	// off because an agent read it as "callable".
	it('labels the list as defined, not available, even when connected', () => {
		const result = formatAgentToolsContext(
			{ toolCount: 1, toolNames: ['create_panel'] },
			'connected'
		);

		expect(result, `the list label must not read as "callable", got: ${result}`).not.toContain(
			'Available tools:'
		);
		expect(result).toContain('Defined tools:');
	});

	// This is the text on the DOM at first paint on a *working* WebMCP browser:
	// connect() cannot have settled yet. Reporting a dead bridge here sent
	// every agent to the UI fallback on every page load.
	it('does not report a dead bridge while the connection is still in flight', () => {
		const result = formatAgentToolsContext(
			{ toolCount: 2, toolNames: ['run_screener', 'create_panel'] },
			'connecting'
		);
		const lower = result.toLowerCase();

		expect(lower, `expected registration described as in progress, got: ${result}`).toContain(
			'in progress'
		);
		expect(
			lower,
			'the unavailable-browser claim is false while a connect is in flight'
		).not.toContain('is not connected here');
		expect(
			lower,
			'a reader must be told to check document.modelContext rather than trust this snapshot'
		).toContain('query document.modelcontext');
		expect(result, 'the tool names are useful in every state').toContain('run_screener');
	});

	// A bridge IS present when registration throws. Telling the reader
	// document.modelContext is missing would be flatly false.
	it('reports a failed connection as a present bridge whose registration failed', () => {
		const result = formatAgentToolsContext({ toolCount: 1, toolNames: ['create_panel'] }, 'failed');
		const lower = result.toLowerCase();

		expect(lower).toContain('not callable');
		expect(
			lower,
			`a failed registration must not claim the bridge is absent, got: ${result}`
		).not.toContain('is not connected here');
		expect(lower, 'the bridge is present -- say so').toContain('document.modelcontext is present');
		expect(lower, `expected the UI fallback named, got: ${result}`).toContain('ui');
	});

	it('gives every bridge state its own wording', () => {
		const states = ['connecting', 'connected', 'failed'] as const;
		const status = { toolCount: 2, toolNames: ['run_screener', 'create_panel'] };

		const rendered = states.map((state) => formatAgentToolsContext(status, state));

		expect(
			new Set(rendered).size,
			'collapsing any pair asserts something untrue about callability for one of them'
		).toBe(3);
	});

	// The caller wraps this in <!-- -->; a literal "--" would truncate the
	// comment early and could expose the tail as rendered page text.
	it('never emits a double hyphen in any bridge state', () => {
		const states = ['connecting', 'connected', 'failed'] as const;

		for (const state of states) {
			const result = formatAgentToolsContext(
				{ toolCount: 2, toolNames: ['run_screener', 'create_panel'] },
				state
			);
			expect(
				result,
				`state "${state}" emitted "--", which closes an HTML comment early`
			).not.toContain('--');
		}
	});
});
