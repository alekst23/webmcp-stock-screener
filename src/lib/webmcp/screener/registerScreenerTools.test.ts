import { describe, expect, it, vi } from 'vitest';

describe('registerScreenerTools', () => {
	it('defaults SCREENER_TOOLS_ENABLED to off, so main stays deployable until the epic ships', async () => {
		const { SCREENER_TOOLS_ENABLED } = await import('./registerScreenerTools');
		expect(SCREENER_TOOLS_ENABLED).toBe(false);
	});

	it('registers nothing against document.modelContext while the flag is off', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		const { registerScreenerTools, createDefaultScreenerToolDeps } =
			await import('./registerScreenerTools');
		await registerScreenerTools(createDefaultScreenerToolDeps());
		expect(registerTool).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('builds a complete, self-consistent default dependency set', async () => {
		const { createDefaultScreenerToolDeps } = await import('./registerScreenerTools');
		const deps = createDefaultScreenerToolDeps();
		expect(deps.repository.list()).toEqual([]);
		expect(deps.catalog).toBeDefined();
		expect(deps.instrumentDirectory).toBeDefined();
		expect(deps.provenance.current('prices').sourceId).toBe('not_configured');
	});

	it('would register exactly the six screener tools if the flag were on', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		const { createDefaultScreenerToolDeps } = await import('./registerScreenerTools');
		const { buildScreenerTools, SCREENER_TOOL_NAMES } = await import('./group');
		const { ensureModelContext } = await import('../bridge');
		const mc = ensureModelContext();
		const specs = buildScreenerTools(createDefaultScreenerToolDeps());
		for (const spec of specs) {
			await mc.registerTool({
				name: spec.name,
				description: spec.description,
				inputSchema: spec.inputSchema,
				execute: spec.execute
			});
		}
		expect(registerTool).toHaveBeenCalledTimes(SCREENER_TOOL_NAMES.length);
		vi.unstubAllGlobals();
	});
});
