import { describe, expect, it, vi } from 'vitest';

describe('registerScreenerTools', () => {
	// T-0020-1: flipped true -- /workbench's shared composition root now
	// wires this group's tools to the same shared repository/revisions/
	// PinnedRunStore every other registered group uses. This is a genuine
	// global constant (not per-route config), so this test asserts the new
	// behavior directly rather than distinguishing a route-specific override.
	it('SCREENER_TOOLS_ENABLED is true now that the shared composition root wires this group in (T-0020-1)', async () => {
		const { SCREENER_TOOLS_ENABLED } = await import('./registerScreenerTools');
		expect(SCREENER_TOOLS_ENABLED).toBe(true);
	});

	it('registers tools against document.modelContext now that the flag is on', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		const { registerScreenerTools, createDefaultScreenerToolDeps } =
			await import('./registerScreenerTools');
		await registerScreenerTools(createDefaultScreenerToolDeps());
		expect(registerTool).toHaveBeenCalled();
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

	it('would register exactly SCREENER_TOOL_NAMES if the flag were on', async () => {
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
