// T-1015-5: bridge.ts's own coverage, extracted from register.test.ts before
// that file retired along with the legacy tool surface. register.test.ts
// exercised ensureModelContext()/onBridgeReplaced()/the same-document relay
// only as a side effect of testing connectWebmcp against the 11-tool
// builder -- deleting it wholesale would have left this transport module,
// which every tool group on the new surface still depends on via
// ensureModelContext(), without direct test coverage (AC4). These cases are
// rewritten against bridge.ts's own exports, with no dependency on the
// legacy engine or tool builder.
import { afterEach, describe, expect, it } from 'vitest';
import {
	WEBMCP_AGENT_REQUEST_EVENT,
	WEBMCP_AGENT_RESPONSE_EVENT,
	createPageModelContext,
	ensureModelContext,
	onBridgeReplaced
} from './bridge';
import { clearModelContext } from './testSupport';
import type { ModelContext, ModelContextToolDescriptor, ToolResult } from './types';

function descriptor(name: string): ModelContextToolDescriptor {
	return {
		name,
		description: `${name} tool`,
		inputSchema: { type: 'object', properties: {} },
		execute: async (input: unknown): Promise<ToolResult> => ({
			content: [{ type: 'text', text: JSON.stringify({ name, input }) }]
		})
	};
}

function relayRequest(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
	const id = `request-${Math.random()}`;
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(() => {
			document.removeEventListener(WEBMCP_AGENT_RESPONSE_EVENT, onResponse);
			reject(new Error('Timed out waiting for WebMCP relay response'));
		}, 1000);
		function onResponse(event: Event): void {
			if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') {
				return;
			}
			const response = JSON.parse(event.detail) as Record<string, unknown>;
			if (response.id !== id) {
				return;
			}
			window.clearTimeout(timeout);
			document.removeEventListener(WEBMCP_AGENT_RESPONSE_EVENT, onResponse);
			resolve(response);
		}
		document.addEventListener(WEBMCP_AGENT_RESPONSE_EVENT, onResponse);
		document.dispatchEvent(
			new CustomEvent(WEBMCP_AGENT_REQUEST_EVENT, { detail: JSON.stringify({ id, ...payload }) })
		);
	});
}

describe('ensureModelContext', () => {
	afterEach(() => {
		clearModelContext();
	});

	// The regression this module exists to kill: a page that saw no
	// document.modelContext used to conclude the browser could not do WebMCP
	// and advertise tools nothing could call. It must supply its own bridge.
	it('installs the page-provided bridge when the browser supplies none', async () => {
		clearModelContext();

		const mc = ensureModelContext();
		await mc.registerTool(descriptor('example_tool'));

		expect(document.modelContext, 'the accessor must be installed on document').toBeDefined();
		const tools = await document.modelContext!.getTools!();
		expect(tools.map((t) => t.name)).toEqual(['example_tool']);
	});

	it('returns the same page context across repeated calls so registrations share one registry', async () => {
		clearModelContext();

		const first = ensureModelContext();
		await first.registerTool(descriptor('a'));
		const second = ensureModelContext();
		await second.registerTool(descriptor('b'));

		const tools = await second.getTools!();
		expect(
			tools.map((t) => t.name).sort(),
			'both calls must see the same underlying registry'
		).toEqual(['a', 'b']);
	});

	// A native bridge must win outright: shadowing it with the page's own
	// would hide the tools from the one browser that can see them natively.
	it('returns the browser-supplied bridge without replacing it', () => {
		const supplied: ModelContext = { registerTool: async () => {} };
		document.modelContext = supplied;

		const mc = ensureModelContext();

		expect(mc, 'a browser-supplied bridge must not be shadowed').toBe(supplied);
		expect(document.modelContext).toBe(supplied);
	});

	it('executes a tool called through the page-installed bridge', async () => {
		clearModelContext();

		const mc = ensureModelContext();
		await mc.registerTool(descriptor('example_tool'));
		const result = await document.modelContext!.executeTool!('example_tool', { x: 1 });

		expect(result.isError ?? false, `execute must succeed, got: ${JSON.stringify(result)}`).toBe(
			false
		);
	});
});

describe('onBridgeReplaced', () => {
	afterEach(() => {
		clearModelContext();
	});

	// An extension that injects after this script ran used to leave tools
	// stranded on the object it replaced -- the "unavailable in this browser"
	// bug wearing a new hat. Listeners must hear about the replacement.
	it('notifies listeners when a bridge is injected after the page installed its own', async () => {
		clearModelContext();
		ensureModelContext();

		const seen: ModelContext[] = [];
		const unsubscribe = onBridgeReplaced((mc) => seen.push(mc));
		const injected: ModelContext = { registerTool: async () => {} };
		document.modelContext = injected;

		expect(seen, 'the listener must have been notified of the new bridge').toEqual([injected]);
		unsubscribe();
	});

	it('stops notifying once unsubscribed', () => {
		clearModelContext();
		ensureModelContext();

		const seen: ModelContext[] = [];
		const unsubscribe = onBridgeReplaced((mc) => seen.push(mc));
		unsubscribe();
		document.modelContext = { registerTool: async () => {} };

		expect(seen, 'an unsubscribed listener must not fire').toEqual([]);
	});
});

describe('same-document relay', () => {
	afterEach(() => {
		clearModelContext();
	});

	it('lists tools through the relay when document.modelContext is hidden from an agent world', async () => {
		clearModelContext();
		const mc = ensureModelContext();
		await mc.registerTool(descriptor('relay_tool'));

		const response = await relayRequest({ method: 'getTools' });

		expect(response.ok, `relay failed: ${JSON.stringify(response)}`).toBe(true);
		expect((response.result as { name: string }[]).map((t) => t.name)).toEqual(['relay_tool']);
	});

	it('executes tools through the relay', async () => {
		clearModelContext();
		const mc = ensureModelContext();
		await mc.registerTool(descriptor('relay_tool'));

		const response = await relayRequest({ method: 'executeTool', tool: 'relay_tool', input: {} });

		expect(response.ok, `relay failed: ${JSON.stringify(response)}`).toBe(true);
		expect((response.result as { isError?: boolean }).isError ?? false).toBe(false);
	});

	it('reports a relay error for an unknown method rather than hanging', async () => {
		clearModelContext();
		ensureModelContext();

		const response = await relayRequest({ method: 'notAMethod' });

		expect(response.ok, 'an unknown method must fail cleanly').toBe(false);
		expect(response.error).toContain('Unknown WebMCP relay method');
	});
});

describe('createPageModelContext', () => {
	it('round-trips register/getTools/executeTool/unregister independent of ensureModelContext', async () => {
		const mc = createPageModelContext();
		await mc.registerTool(descriptor('standalone'));

		expect((await mc.getTools!()).map((t) => t.name)).toEqual(['standalone']);
		const result = await mc.executeTool!('standalone', {});
		expect(result.isError ?? false).toBe(false);

		await mc.unregisterTool!('standalone');
		expect((await mc.getTools!()).map((t) => t.name)).toEqual([]);
	});
});
