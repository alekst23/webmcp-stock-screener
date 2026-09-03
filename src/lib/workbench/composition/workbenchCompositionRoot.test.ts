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
import { ADD_CHART_ANNOTATION_TOOL_NAME } from '../../workbench/chart/tools/addChartAnnotation';
import { CAPTURE_CHART_SETUP_TOOL_NAME } from '../../workbench/chart/tools/captureChartSetup';
import { GET_CHART_DATA_TOOL_NAME } from '../../workbench/chart/tools/getChartData';
import { FIND_SIMILAR_SETUPS_TOOL_NAME } from '../../workbench/similarity/tools/findSimilarSetups';
import { EXPLAIN_SIMILARITY_TOOL_NAME } from '../../workbench/similarity/tools/explainSimilarity';
import { COMPARE_SETUPS_TOOL_NAME } from '../../workbench/similarity/comparison/tools/compareSetups';
import { BACKTEST_SCREENER_TOOL_NAME } from '../../workbench/backtest/tools/backtestScreener';
import { GET_BACKTEST_RESULTS_TOOL_NAME } from '../../workbench/backtest/tools/getBacktestResults';
import { PREVIEW_ALERT_TOOL_NAME } from '../../workbench/alerts/tools/previewAlert';
import { CREATE_ALERT_DRAFT_TOOL_NAME } from '../../workbench/alerts/tools/createAlertDraft';
import { EDIT_ALERT_DRAFT_TOOL_NAME } from '../../workbench/alerts/tools/editAlertDraft';
import { ENABLE_ALERT_TOOL_NAME } from '../../workbench/alerts/tools/enableAlert';
import { DISABLE_ALERT_TOOL_NAME } from '../../workbench/alerts/tools/disableAlert';
import { UPSERT_WATCHLIST_TOOL_NAME } from '../../workbench/watchlist/tools/upsertWatchlist';
import { SAVE_RESULTS_TO_WATCHLIST_TOOL_NAME } from '../../workbench/watchlist/tools/saveResultsToWatchlist';
import { CREATE_CUSTOM_STUDY_TOOL_NAME } from '../../workbench/followup/tools/createCustomStudy';
import { CREATE_COMPUTED_FIELD_TOOL_NAME } from '../../workbench/followup/tools/createComputedField';
import {
	buildScreenerDeps,
	buildWorkbenchDeps,
	createWorkbenchSharedInfra,
	registerWorkbenchComposition
} from './workbenchCompositionRoot';

// T-0020-5: every tool name gated behind a flag this epic's AC2 says must
// stay false (chart, similarity, backtest, alert, watchlist, followup) --
// imported as each tool's own exported *_TOOL_NAME constant, not a hand-typed
// string, so a future rename of one of these tools cannot silently make this
// negative test pass for the wrong reason.
const OUT_OF_SCOPE_TOOL_NAMES = [
	ADD_CHART_ANNOTATION_TOOL_NAME,
	CAPTURE_CHART_SETUP_TOOL_NAME,
	GET_CHART_DATA_TOOL_NAME,
	FIND_SIMILAR_SETUPS_TOOL_NAME,
	EXPLAIN_SIMILARITY_TOOL_NAME,
	COMPARE_SETUPS_TOOL_NAME,
	BACKTEST_SCREENER_TOOL_NAME,
	GET_BACKTEST_RESULTS_TOOL_NAME,
	PREVIEW_ALERT_TOOL_NAME,
	CREATE_ALERT_DRAFT_TOOL_NAME,
	EDIT_ALERT_DRAFT_TOOL_NAME,
	ENABLE_ALERT_TOOL_NAME,
	DISABLE_ALERT_TOOL_NAME,
	UPSERT_WATCHLIST_TOOL_NAME,
	SAVE_RESULTS_TO_WATCHLIST_TOOL_NAME,
	CREATE_CUSTOM_STUDY_TOOL_NAME,
	CREATE_COMPUTED_FIELD_TOOL_NAME
] as const;

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
		const screenerDeps = buildScreenerDeps(shared, panelRuntime.deps);

		expect(
			panelRuntime.deps.repository,
			"panel tools must share the composition root's WorkspaceRepository, not build their own"
		).toBe(shared.repository);
		expect(
			workbenchDeps.repository,
			"workbench-core tools must share the composition root's WorkspaceRepository, not build their own"
		).toBe(shared.repository);
		expect(
			screenerDeps.repository,
			"screener tools must share the panel runtime's WorkspaceRepository, not build their own"
		).toBe(shared.repository);

		expect(
			panelRuntime.deps.revisions,
			"panel tools must share the composition root's RevisionService, not build their own"
		).toBe(shared.revisions);
		expect(
			workbenchDeps.revisions,
			"workbench-core tools must share the composition root's RevisionService, not build their own"
		).toBe(shared.revisions);
		expect(
			screenerDeps.revisions,
			"screener tools must share the panel runtime's RevisionService, not build their own"
		).toBe(shared.revisions);

		expect(
			panelRuntime.deps.history,
			"panel tools must share the composition root's ChangeHistory, not build their own"
		).toBe(shared.history);
		expect(
			workbenchDeps.history,
			"workbench-core tools must share the composition root's ChangeHistory, not build their own"
		).toBe(shared.history);
		expect(
			screenerDeps.history,
			"screener tools must share the panel runtime's ChangeHistory, not build their own"
		).toBe(shared.history);

		expect(
			workbenchDeps.idempotency,
			"workbench-core tools must share the composition root's IdempotencyCache, not build their own"
		).toBe(shared.idempotency);
		expect(
			screenerDeps.idempotency,
			"screener tools must share the composition root's IdempotencyCache, not build their own"
		).toBe(shared.idempotency);

		expect(
			panelRuntime.runs,
			"the panel shell's results_table panel must read the composition root's own PinnedRunStore, not a second one"
		).toBe(shared.runs);
		expect(
			screenerDeps.runStore,
			'run_screener must write into the same PinnedRunStore the panel shell reads from, not a second one'
		).toBe(shared.runs);

		// T-0020-2: the auto-bind wiring reuses the panel runtime's own
		// registries, not second instances.
		expect(
			screenerDeps.panelBinding?.kinds,
			"run_screener's auto-bind must reuse the panel runtime's own panel-kind registry, not a second instance"
		).toBe(panelRuntime.deps.kinds);
		expect(
			screenerDeps.panelBinding?.sourceRenderer,
			"run_screener's auto-bind must reuse the panel runtime's own source-renderer registry, not a second instance"
		).toBe(panelRuntime.deps.sourceRenderer);
		expect(
			screenerDeps.panelBinding?.templates,
			"run_screener's auto-bind must reuse the panel runtime's own layout-template registry, not a second instance"
		).toBe(panelRuntime.deps.templates);
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
			expect(
				removed.isError,
				'removing the seeded panel to make room for the new one must succeed'
			).toBeFalsy();

			const createPanelSpec = specs.get('create_panel')!;
			const created = await createPanelSpec.execute({
				kind: 'chart',
				rect: { col: 0, row: 0, col_span: 2, row_span: 4 }
			});
			expect(
				created.isError,
				'creating a chart panel through the panel tool group must succeed'
			).toBeFalsy();
			const envelope = (await textOf(created)) as { affected_ids: string[] };
			const newPanelId = envelope.affected_ids[0]!;

			const getCanvasStateSpec = specs.get('get_canvas_state')!;
			const canvasResult = await getCanvasStateSpec.execute({});
			expect(
				canvasResult.isError,
				'reading canvas state back through the workbench-core tool group must succeed'
			).toBeFalsy();
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

	// T-0020-5: today this is true by inspection (chart/similarity/backtest/
	// alert/watchlist/followup all still have their own flags off), but
	// nothing asserted it -- a future accidental flip of one of those flags
	// without also updating this composition root would go uncaught without
	// this test.
	it('never registers a chart/similarity/backtest/alert/watchlist/followup tool name (AC2)', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		try {
			await registerWorkbenchComposition();
			const names = registerTool.mock.calls.map((args: unknown[]) => (args[0] as ToolSpec).name);
			for (const outOfScopeName of OUT_OF_SCOPE_TOOL_NAMES) {
				expect(
					names,
					`"${outOfScopeName}" belongs to a tool group whose flag must stay false -- ` +
						'registerWorkbenchComposition() must never register it'
				).not.toContain(outOfScopeName);
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
