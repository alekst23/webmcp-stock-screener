// T-0020-1 AC7: the shared composition root threads one WorkspaceRepository,
// ID sequencer, idempotency cache, revision service, change history, and
// PinnedRunStore through all three /workbench tool groups (panel,
// workbench-core, screener) instead of each building its own -- this test
// proves that by driving a mutation through one tool group (panel's own
// create_panel) and reading it back through another (workbench-core's
// get_canvas_state) against the live, registered tool surface, not
// hand-built fixtures.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolResult, ToolSpec } from '../../webmcp/types';
import { createPanelShellRuntime } from '../../panels/shell/registerPanelTools';
import {
	buildScreenerDeps,
	buildWorkbenchDeps,
	createWorkbenchSharedInfra,
	registerWorkbenchComposition
} from './workbenchCompositionRoot';

beforeEach(() => {
	localStorage.clear();
});

async function textOf(result: ToolResult): Promise<unknown> {
	return JSON.parse(result.content[0]!.text);
}

describe('createWorkbenchSharedInfra + per-group deps builders', () => {
	it('threads the exact same repository/revisions/idempotency/runs instances into every group', () => {
		const shared = createWorkbenchSharedInfra();
		const panelRuntime = createPanelShellRuntime(shared);
		const workbenchDeps = buildWorkbenchDeps(shared);
		const screenerDeps = buildScreenerDeps(shared);

		expect(panelRuntime.deps.repository).toBe(shared.repository);
		expect(workbenchDeps.repository).toBe(shared.repository);
		expect(screenerDeps.repository).toBe(shared.repository);

		expect(panelRuntime.deps.revisions).toBe(shared.revisions);
		expect(workbenchDeps.revisions).toBe(shared.revisions);
		expect(screenerDeps.revisions).toBe(shared.revisions);

		expect(panelRuntime.deps.history).toBe(shared.history);
		expect(workbenchDeps.history).toBe(shared.history);
		expect(screenerDeps.history).toBe(shared.history);

		expect(workbenchDeps.idempotency).toBe(shared.idempotency);
		expect(screenerDeps.idempotency).toBe(shared.idempotency);

		expect(panelRuntime.runs).toBe(shared.runs);
		expect(screenerDeps.runStore).toBe(shared.runs);
	});
});

describe('registerWorkbenchComposition', () => {
	it('a panel created through the panel tool group is visible through the workbench-core get_canvas_state read', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		try {
			await registerWorkbenchComposition();
			const specs = new Map<string, ToolSpec>(
				registerTool.mock.calls.map((args: unknown[]) => {
					const tool = args[0] as ToolSpec;
					return [tool.name, tool];
				})
			);

			// The seeded default layout already fills the grid (T-1007-9), so a
			// free rect must be made first -- remove one seeded panel through the
			// same panel tool group before creating a new one.
			const initialCanvas = (await textOf(await specs.get('get_canvas_state')!.execute({}))) as {
				panels: { id: string }[];
			};
			const removed = await specs
				.get('remove_panel')!
				.execute({ panel_id: initialCanvas.panels[0]!.id });
			expect(removed.isError, JSON.stringify(removed)).toBeFalsy();

			const createPanelSpec = specs.get('create_panel')!;
			const created = await createPanelSpec.execute({
				kind: 'chart',
				rect: { col: 0, row: 0, col_span: 2, row_span: 4 }
			});
			expect(created.isError, JSON.stringify(created)).toBeFalsy();
			const envelope = (await textOf(created)) as { affected_ids: string[] };
			const newPanelId = envelope.affected_ids[0]!;

			const getCanvasStateSpec = specs.get('get_canvas_state')!;
			const canvasResult = await getCanvasStateSpec.execute({});
			expect(canvasResult.isError, JSON.stringify(canvasResult)).toBeFalsy();
			const canvas = (await textOf(canvasResult)) as { panels: { id: string }[] };
			expect(canvas.panels.map((p) => p.id)).toContain(newPanelId);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('registers the panel, workbench-core, and screener tool groups together', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		try {
			await registerWorkbenchComposition();
			const names = registerTool.mock.calls.map((args: unknown[]) => (args[0] as ToolSpec).name);
			expect(names).toContain('create_panel');
			expect(names).toContain('get_canvas_state');
			expect(names).toContain('run_screener');
			expect(names).toContain('create_screener');
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
