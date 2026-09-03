import { describe, expect, it, vi } from 'vitest';

describe('registerWorkbenchTools', () => {
	// T-0020-1: flipped true -- /workbench's shared composition root now
	// wires this group's tools to the same shared repository/revisions
	// every other registered group uses. This is a genuine global constant
	// (not per-route config), so this test asserts the new behavior
	// directly rather than distinguishing a route-specific override.
	it('WORKBENCH_TOOLS_ENABLED is true now that the shared composition root wires this group in (T-0020-1)', async () => {
		const { WORKBENCH_TOOLS_ENABLED } = await import('./registerWorkbenchTools');
		expect(WORKBENCH_TOOLS_ENABLED).toBe(true);
	});

	it('registers tools against document.modelContext now that the flag is on', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		const { registerWorkbenchTools, createDefaultWorkbenchDeps } =
			await import('./registerWorkbenchTools');
		await registerWorkbenchTools(createDefaultWorkbenchDeps());
		expect(registerTool).toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('builds a complete, self-consistent default dependency set', async () => {
		const { createDefaultWorkbenchDeps } = await import('./registerWorkbenchTools');
		const deps = createDefaultWorkbenchDeps();
		expect(deps.repository.list()).toEqual([]);
		expect(deps.registry.kinds()).toEqual([]);
		expect(deps.provenance.current('prices').sourceId).toBe('not_configured');
	});
});
