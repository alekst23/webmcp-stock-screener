import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectNewSurfaceBridge } from './newSurfaceSession';
import { clearModelContext } from './testSupport';
import type { ModelContext, RegisteredToolInfo } from './types';
import type { WebmcpBridgeState } from './status';

// A minimal fake implementing getTools() too -- webmcp/testSupport.ts's own
// fakeBridge() does not, and this module's whole job (unlike session.ts's)
// is reading the tool list back off getTools() once composition settles.
function fakeBridgeWithTools(names: string[]): ModelContext {
	const tools: RegisteredToolInfo[] = names.map((name) => ({
		name,
		description: `${name} tool`,
		inputSchema: {}
	}));
	return {
		registerTool: async () => {},
		getTools: async () => tools
	};
}

function recorder(): { states: WebmcpBridgeState[] } {
	return { states: [] };
}

describe('connectNewSurfaceBridge', () => {
	afterEach(() => {
		clearModelContext();
		vi.restoreAllMocks();
	});

	it('reports connecting synchronously, before compose can possibly resolve', () => {
		document.modelContext = fakeBridgeWithTools([]);
		const seen = recorder();

		void connectNewSurfaceBridge(
			() => new Promise(() => {}),
			(state) => seen.states.push(state)
		);

		expect(seen.states, 'the first state reported must be connecting').toEqual(['connecting']);
	});

	it('reports connected with the composed runtime and the live tool list on success', async () => {
		document.modelContext = fakeBridgeWithTools(['create_panel', 'run_screener']);
		const seen = recorder();
		const runtime = { deps: 'fake-deps' };

		const { result, status } = await connectNewSurfaceBridge(
			async () => runtime,
			(state) => seen.states.push(state)
		);

		expect(
			seen.states,
			`expected connecting -> connected, got: ${seen.states.join(' -> ')}`
		).toEqual(['connecting', 'connected']);
		expect(result, 'the composed runtime must be returned to the caller').toBe(runtime);
		expect(status.toolCount, 'the defined count must reflect what is actually on the bridge').toBe(
			2
		);
		expect(status.toolNames.sort()).toEqual(['create_panel', 'run_screener'].sort());
	});

	it('reports failed, a null result, and logs the underlying error when compose rejects', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		document.modelContext = fakeBridgeWithTools([]);
		const seen = recorder();
		const failure = new Error('composition blew up');

		const { result, status } = await connectNewSurfaceBridge(
			async () => {
				throw failure;
			},
			(state) => seen.states.push(state)
		);

		expect(seen.states, `expected connecting -> failed, got: ${seen.states.join(' -> ')}`).toEqual([
			'connecting',
			'failed'
		]);
		expect(result, 'a failed composition leaves nothing to render').toBeNull();
		expect(status.toolCount, 'a failed composition must report zero tools, not a stale count').toBe(
			0
		);
		expect(
			logged,
			'the underlying error must reach the console for diagnosis'
		).toHaveBeenCalledWith('WebMCP bridge failed to connect', failure);
	});
});
