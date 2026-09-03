import { describe, expect, it, vi } from 'vitest';

// T-1015-3: mirrors registerChartTools.test.ts / registerWorkbenchTools.test.ts's
// own flag-flip coverage -- registerFollowupAuthoringTools() and its
// *_TOOLS_ENABLED constant previously had no dedicated test of their own
// (createComputedField.test.ts/createCustomStudy.test.ts exercise the tool
// factories directly, never this file's registration/flag behavior).
describe('registerFollowupAuthoringTools', () => {
	it('FOLLOWUP_AUTHORING_TOOLS_ENABLED is true now that the composition root wires this group in (T-1015-3)', async () => {
		const { FOLLOWUP_AUTHORING_TOOLS_ENABLED } = await import('./registerFollowupTools');
		expect(FOLLOWUP_AUTHORING_TOOLS_ENABLED).toBe(true);
	});

	it('registers the two authoring tools against document.modelContext now that the flag is on', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		try {
			const { registerFollowupAuthoringTools, createDefaultFollowupAuthoringDeps } =
				await import('./registerFollowupTools');
			await registerFollowupAuthoringTools(createDefaultFollowupAuthoringDeps());
			const names = registerTool.mock.calls.map((args: unknown[]) => {
				const tool = args[0] as { name: string };
				return tool.name;
			});
			expect(names).toEqual(
				expect.arrayContaining(['create_computed_field', 'create_custom_study'])
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
