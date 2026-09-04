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
import { RESOLVE_TICKER_TOOL_NAME } from '../../workbench/chart/tools/resolveTicker';
import { GET_CHART_DATA_TOOL_NAME } from '../../workbench/chart/tools/getChartData';
import { FIND_SIMILAR_SETUPS_TOOL_NAME } from '../../workbench/similarity/tools/findSimilarSetups';
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

// Chart-demo trim (see plan: "Trim the WebMCP tool surface to a chart-only
// demo set"), narrowed by T-0026-5: registerWorkbenchComposition() now
// registers the MVP core tools (tool-surface-mvp.md) -- panel tools,
// get_canvas_state, define_screener, run_screener, resolve_ticker,
// search_catalog -- but chart-authoring, similarity, and follow-up-authoring
// stay commented out at their call sites (workbenchCompositionRoot.ts), and
// get_app_context/create_screener stay deliberately unregistered (the
// former is "Deliberately absent" per tool-surface-mvp.md; the latter was
// deleted from the screener group, replaced by define_screener) -- these
// names stay out of scope below.
//
// The panel/results tool names below (duplicate_panel through
// explain_result) match TOOLS_OFF_MVP_SURFACE in registerPanelTools.ts --
// present in buildPanelTools()/buildResultsTools()'s own full roster
// (unchanged, still exercised by panelTools.test.ts/resultsTools.test.ts)
// but filtered out at that registration boundary per tool-surface-mvp.md's
// "deliberately absent" table, so they must never reach this route either.
const OUT_OF_SCOPE_TOOL_NAMES_TRIMMED_FOR_DEMO = [
	'get_app_context',
	'create_screener',
	GET_CHART_DATA_TOOL_NAME,
	FIND_SIMILAR_SETUPS_TOOL_NAME,
	CREATE_CUSTOM_STUDY_TOOL_NAME,
	CREATE_COMPUTED_FIELD_TOOL_NAME,
	'duplicate_panel',
	'apply_layout_template',
	'split_panel',
	'maximize_panel',
	'reset_layout',
	'bind_panel_source',
	'set_panel_renderer',
	'configure_chart_grid',
	'configure_panel_view',
	'link_panels',
	'unlink_panels',
	'set_panel_selection',
	'explain_result'
] as const;

// T-0020-5, narrowed by T-1015-3: backtest/alert/watchlist stay behind a
// flag with no caller -- `measure`/`splitInstances` (backtest) was an
// accepted drop, and the other two have no reason to enable independent of
// this cutover (see T-1015-3's Solution Approach). Imported as each tool's
// own exported *_TOOL_NAME constant, not a hand-typed string, so a future
// rename of one of these tools cannot silently make this negative test pass
// for the wrong reason.
const OUT_OF_SCOPE_TOOL_NAMES = [
	BACKTEST_SCREENER_TOOL_NAME,
	GET_BACKTEST_RESULTS_TOOL_NAME,
	PREVIEW_ALERT_TOOL_NAME,
	CREATE_ALERT_DRAFT_TOOL_NAME,
	EDIT_ALERT_DRAFT_TOOL_NAME,
	ENABLE_ALERT_TOOL_NAME,
	DISABLE_ALERT_TOOL_NAME,
	UPSERT_WATCHLIST_TOOL_NAME,
	SAVE_RESULTS_TO_WATCHLIST_TOOL_NAME
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
	// T-0026-5: get_canvas_state (workbench-core) is now registered too --
	// narrowly, via registerCanvasStateTool, not the whole registerWorkbenchTools
	// group (see that module's own comment for why). This proves the
	// cross-group wiring the old commented-out test below asserted, against
	// the real composition root rather than a hand-reconstruction.
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

			// hotfix/empty-grid-canvas: the default seed layout is now a single
			// sparse filter_builder panel (defaultLayout.ts), leaving room for a
			// new panel without first removing anything.
			const createPanelSpec = specs.get('create_panel')!;
			const created = await createPanelSpec.execute({ kind: 'chart' });
			expect(
				created.isError,
				`creating a chart panel through the panel tool group must succeed: ${JSON.stringify(created)}`
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
			expect(names).toContain('define_screener');
			expect(names).toContain('run_screener');
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('registers only the MVP core tool set (tool-surface-mvp.md): panel tools, get_canvas_state, define_screener, run_screener, resolve_ticker, and search_catalog', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		try {
			await registerWorkbenchComposition();
			const names = registerTool.mock.calls.map((args: unknown[]) => (args[0] as ToolSpec).name);
			expect(names).toContain('create_panel');
			expect(names).toContain('get_canvas_state');
			expect(names).toContain('define_screener');
			expect(names).toContain('run_screener');
			expect(names).toContain(RESOLVE_TICKER_TOOL_NAME);
			// T-0026-2 AC1: search_catalog existed but was never reachable through
			// this route's real registration path before this ticket.
			expect(names).toContain('search_catalog');
			for (const trimmedName of OUT_OF_SCOPE_TOOL_NAMES_TRIMMED_FOR_DEMO) {
				expect(
					names,
					`"${trimmedName}" is deliberately absent from the MVP surface -- ` +
						'registerWorkbenchComposition() must not register it'
				).not.toContain(trimmedName);
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});

	// T-0020-5, narrowed by T-1015-3: today this is true by inspection
	// (backtest/alert/watchlist still have their own flags off), but nothing
	// asserted it -- a future accidental flip of one of those flags without
	// also updating this composition root would go uncaught without this
	// test.
	it('never registers a backtest/alert/watchlist tool name (T-1015-3 Solution Approach)', async () => {
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
