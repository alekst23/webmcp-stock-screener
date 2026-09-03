import { beforeEach, describe, expect, it, vi } from 'vitest';

// T-1015-3: mirrors registerChartTools.test.ts / registerWorkbenchTools.test.ts's
// own flag-flip coverage -- this module's register*Tools() and its
// *_TOOLS_ENABLED constant previously had no dedicated test at all (only
// similarityIntegration.test.ts, which builds the three tools directly and
// never touches this file's registration/flag behavior).
describe('registerSimilarityTools', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('SIMILARITY_TOOLS_ENABLED is true now that the composition root wires this group in (T-1015-3)', async () => {
		const { SIMILARITY_TOOLS_ENABLED } = await import('./registerSimilarityTools');
		expect(SIMILARITY_TOOLS_ENABLED).toBe(true);
	});

	it('registers the three similarity tools against document.modelContext now that the flag is on', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		try {
			const { registerSimilarityTools } = await import('./registerSimilarityTools');
			// createDefaultSimilarityDeps() (this module's own default deps
			// builder) requires an active workspace -- seed one the same way
			// registerPanelTools() does, via a fresh repository against the
			// same localStorage the default deps builder reads.
			const { createLocalWorkspaceRepository } = await import('../../infra/workspaceRepository');
			const { emptyWorkspace } = await import('../../domain/workspace');
			const repository = createLocalWorkspaceRepository();
			const doc = emptyWorkspace('workspace_1', 'Research', '2026-09-03T00:00:00.000Z');
			repository.put(doc);
			repository.setActiveId(doc.id);

			await registerSimilarityTools();
			const names = registerTool.mock.calls.map((args: unknown[]) => {
				const tool = args[0] as { name: string };
				return tool.name;
			});
			expect(names).toEqual(
				expect.arrayContaining(['find_similar_setups', 'explain_similarity', 'compare_setups'])
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
