import { describe, expect, it, vi } from 'vitest';

describe('registerWorkbenchTools', () => {
	it('defaults WORKBENCH_TOOLS_ENABLED to off, so main stays deployable while sibling epics land', async () => {
		const { WORKBENCH_TOOLS_ENABLED } = await import('./registerWorkbenchTools');
		expect(WORKBENCH_TOOLS_ENABLED).toBe(false);
	});

	it('registers nothing against document.modelContext while the flag is off', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		const { registerWorkbenchTools, createDefaultWorkbenchDeps } =
			await import('./registerWorkbenchTools');
		await registerWorkbenchTools(createDefaultWorkbenchDeps());
		expect(registerTool).not.toHaveBeenCalled();
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
