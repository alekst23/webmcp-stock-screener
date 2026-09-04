// T-0020-1: the one shared composition root for `/workbench`. Builds
// exactly one WorkspaceRepository, ID sequencer, idempotency cache,
// revision service, change history, and PinnedRunStore
// (registerPanelTools.ts's createWorkbenchSharedInfra), and threads that
// same bag into all three tool groups this route registers -- panel tools,
// workbench-core tools, and screener tools -- so a mutation made through
// one is visible to a read through another. Deliberately does not call any
// of the three groups' own createDefault*Deps() (each of those still exists
// for that module's own unit tests, AC2) -- instead, buildWorkbenchDeps/
// buildScreenerDeps below call each module's own createWorkbenchDeps(shared)/
// createScreenerDeps(shared) constructor (T-0020-6) directly with this
// route's shared bag, so the field list for each group's deps object is
// owned by that group's own module, not duplicated here.
import type { PanelToolDeps } from '../../panels/tools/panelTools';
import {
	createPanelShellRuntime,
	createWorkbenchSharedInfra,
	registerPanelTools,
	type PanelShellRuntime,
	type WorkbenchSharedInfra
} from '../../panels/shell/registerPanelTools';
// T-0026-5: registers exactly tool-surface-mvp.md's core seven/eight --
// search_catalog, define_screener, run_screener, get_screener_results,
// create_panel, get_canvas_state, remove_panel, set_panel_layout -- not the
// ~39-tool surface EPIC-1015's "chart-demo trim" originally left commented
// out here. registerScreenerTools now registers define_screener +
// run_screener only (group.ts); registerCanvasStateTool (not the whole
// registerWorkbenchTools group -- see that module's own comment) registers
// just get_canvas_state, the MVP's one workbench-core tool. Chart,
// similarity, and follow-up-authoring stay exactly as EPIC-1015 left them
// (commented, no caller) -- out of this ticket's scope.
import {
	createScreenerDeps,
	registerScreenerTools
} from '../../webmcp/screener/registerScreenerTools';
import type { ScreenerToolDeps } from '../../webmcp/screener/group';
import type { PanelBindingDeps } from '../../panels/application';
import type { ScreenerEvaluationPort } from '../../screener/ports';
import { createHttpScreenerEvaluationPort } from '../../screener/infra/httpEvaluationPort';
import {
	createWorkbenchDeps,
	registerCanvasStateTool,
	type DefaultWorkbenchDeps
} from '../tools/registerWorkbenchTools';
import { resolveApiBaseUrl } from '../../workspace/apiConfig';
// T-0020-11: the filter panel's human "Run" control needs the exact same
// evaluationPort/runStore this composition wires run_screener to (so a
// human-triggered run pins into the same PinnedRunStore an agent's run
// would) plus this route's own shared observer -- all three only exist once
// screenerDeps is built below, strictly after the filter_builder kind is
// registered (createPanelShellRuntime, inside registerPanelTools), so this
// is a second-phase call rather than something createFilterBuilderPanelKindDefinition
// itself could set. See filterBuilderPanelContext.ts's own comment for why
// that ordering is still safe.
import { setFilterBuilderPanelRunDeps } from '../../screener/panel/filterBuilderPanelContext';
// T-1015-3: the chart, similarity, and follow-up-authoring tool groups were
// merged, tested, and flag-gated off pending exactly this -- a route that
// calls them. Each one still builds its own default deps (its own
// WorkspaceRepository instance, reading/writing the same localStorage-backed
// keys the shared infra above also uses) and self-gates on its own
// `*_TOOLS_ENABLED` constant, so calling all three here unconditionally is
// safe regardless of flag state: a call against a flag still off is a no-op,
// exactly like every other group's own register*Tools(). Not folded into the
// shared-infra bag above -- doing so would mean building each group its own
// createXDeps(shared) constructor, which is new plumbing this ticket's
// Solution Approach explicitly does not introduce.
// import { createChartDeps, registerChartTools } from '../chart/tools/registerChartTools';
// import { createSimilarityDeps, registerSimilarityTools } from '../similarity/tools/registerSimilarityTools';
// import {
// 	createFollowupAuthoringDeps,
// 	registerFollowupAuthoringTools
// } from '../followup/tools/registerFollowupTools';
import { registerResolveTickerTool } from '../chart/tools/resolveTicker';
// T-0026-2: search_catalog existed but was never registered on this route --
// the one live composition root /workbench's real entry point drives. Added
// standalone (registerSearchCatalogTool, not the three-tool discovery group)
// so this stayed the minimal additive change; T-0026-5 folds it into the
// exact core-tool MVP registration this file settles into.
import { registerSearchCatalogTool } from '../../webmcp/discovery/searchCatalog';

// T-0020-9: only `createWorkbenchSharedInfra` (the value) is ever imported
// from this module -- no importer anywhere in the codebase reaches for the
// `WorkbenchSharedInfra` type through this re-export (callers that need the
// type import it directly from registerPanelTools.ts, its real home), so it
// is not re-exported here.
export { createWorkbenchSharedInfra };

// WorkbenchDeps built directly against the shared bag -- delegates to
// registerWorkbenchTools.ts's own constructor (T-0020-6) so this module
// does not duplicate that group's field list.
export function buildWorkbenchDeps(shared: WorkbenchSharedInfra): DefaultWorkbenchDeps {
	return createWorkbenchDeps(shared);
}

// ScreenerToolDeps built directly against the shared bag, with `runStore`
// pointed at the same PinnedRunStore the panel shell's results_table panel
// kind and table renderer contract already close over -- the precondition
// T-0020-2's auto-bind needs: a run_screener call and a results_table panel
// read must agree on what's pinned. `panelDeps` is the panel runtime's own
// PanelToolDeps (T-0020-1's createPanelShellRuntime output) -- its
// kinds/sourceRenderer/templates registries are reused as-is (T-0020-2:
// bindRunToResultsPanel needs exactly those three) rather than this module
// building second instances. The base fields (repository, revisions, ...,
// catalog, instrumentDirectory) delegate to registerScreenerTools.ts's own
// constructor (T-0020-6); only the cross-group extras this route's
// composition alone knows about (runStore, panelBinding, evaluationPort
// override) are added here.
//
// T-0026-4: `evaluationPort` now defaults to HttpScreenerEvaluationPort,
// pointed at the same backend base URL the chart tool group already
// resolves (`overrides?.chartBaseUrl`, itself `resolveApiBaseUrl(env....)`
// from +page.svelte -- not a second, independent URL resolution), rather
// than leaving the default to fall through to run_screener.ts's own
// in-browser-engine fallback. `overrides?.evaluationPort` still substitutes
// cleanly ahead of this default -- workbenchCompositionRoot.test.ts's fake
// evaluation port seam is unchanged.
export function buildScreenerDeps(
	shared: WorkbenchSharedInfra,
	panelDeps: Pick<PanelToolDeps, 'kinds' | 'sourceRenderer' | 'templates'>,
	overrides?: WorkbenchCompositionOverrides
): ScreenerToolDeps {
	const panelBinding: PanelBindingDeps = {
		kinds: panelDeps.kinds,
		sourceRenderer: panelDeps.sourceRenderer,
		templates: panelDeps.templates
	};
	return {
		...createScreenerDeps(shared),
		runStore: shared.runs,
		panelBinding,
		evaluationPort:
			overrides?.evaluationPort ??
			createHttpScreenerEvaluationPort({ baseUrl: resolveApiBaseUrl(overrides?.chartBaseUrl) })
	};
}

// Injection seam for tests: `+page.svelte`'s real call site never passes
// `evaluationPort`, so the shipped default (T-0026-4: HttpScreenerEvaluationPort
// against the real backend, see buildScreenerDeps above) applies. Exists so
// a test can call the REAL registerWorkbenchComposition() -- not a
// hand-reconstruction of its internals -- while still substituting a fake
// evaluation port instead of making real network calls.
export interface WorkbenchCompositionOverrides {
	evaluationPort?: ScreenerEvaluationPort;
	// The chart tool group's own backend base URL (bug fix, see git history):
	// absent means createChartDeps' own default (DEV_API_BASE_URL). The real
	// call site (+page.svelte) passes the same resolveApiBaseUrl(env....)
	// value it already resolves for fetchPanelStatus, so the chart's bars
	// port and the panel-status fetch agree on which backend they're talking
	// to.
	chartBaseUrl?: string;
}

// Builds the shared infra once, constructs each group's deps against it,
// and registers all three tool groups in order (panel, workbench-core,
// screener). Returns the PanelShellRuntime so the /workbench route can
// still hand `deps`/`observer` to PanelContainer exactly as before.
export async function registerWorkbenchComposition(
	overrides?: WorkbenchCompositionOverrides
): Promise<PanelShellRuntime> {
	const shared = createWorkbenchSharedInfra();
	const panelRuntime = createPanelShellRuntime(shared, { chartBaseUrl: overrides?.chartBaseUrl });

	await registerPanelTools(panelRuntime);

	// T-0026-5: get_canvas_state (workbench-core) and define_screener +
	// run_screener (screener) are the MVP's remaining core tools --
	// registered narrowly (see registerCanvasStateTool's and group.ts's own
	// comments for why the whole workbench-core/screener groups aren't
	// registered wholesale). create_panel/remove_panel/set_panel_layout
	// already come from registerPanelTools above; get_screener_results from
	// that same call (results/tools/resultsTools.ts, folded into panel
	// tools); search_catalog and resolve_ticker below.
	const workbenchDeps = buildWorkbenchDeps(shared);
	// T-0020-11: resolved once, here, rather than left to buildScreenerDeps'
	// own default -- so the exact same ScreenerEvaluationPort instance
	// run_screener gets is also what the filter panel's human Run control
	// gets below (setFilterBuilderPanelRunDeps), instead of building two
	// separate adapters that happen to behave the same way.
	const evaluationPort =
		overrides?.evaluationPort ??
		createHttpScreenerEvaluationPort({ baseUrl: resolveApiBaseUrl(overrides?.chartBaseUrl) });
	const screenerDeps = buildScreenerDeps(shared, panelRuntime.deps, { ...overrides, evaluationPort });

	// T-0020-11: fill in the filter_builder kind's Run-control dependencies
	// now that they exist -- runStore is the same PinnedRunStore instance
	// run_screener itself is given below (shared.runs), evaluationPort is the
	// exact instance just resolved above, and observer is this route's shared
	// notification hub, so a human-triggered run re-renders the panel grid
	// the same way an agent-triggered one does.
	setFilterBuilderPanelRunDeps({
		evaluationPort,
		runStore: shared.runs,
		observer: panelRuntime.observer
	});

	// Bug fix: these two were registered without panelRuntime.observer,
	// so define_screener/run_screener/get_canvas_state mutated the shared
	// repository but never notified PanelContainer -- the FilterBuilder
	// panel (and any results panel) stayed stale until an unrelated tool
	// call happened to notify. See each function's own note.
	await registerCanvasStateTool(workbenchDeps, panelRuntime.observer);
	await registerScreenerTools(screenerDeps, panelRuntime.observer);

	// Chart-authoring, similarity, and follow-up-authoring groups below stay
	// commented out (see plan: "Trim the WebMCP tool surface to a chart-only
	// demo set") -- explicitly out of this ticket's scope (T-0026-5's
	// Solution Approach). registerResolveTickerTool() is the one non-MVP
	// tool this composition still registers -- see resolveTicker.ts for why
	// a chart panel needs it (bind_panel_source's 'instrument' source type
	// requires a resolved instrument_id/symbol/exchange/asset_type, and
	// nothing else in this codebase can mint one; see that file's own header
	// for why this isn't routed through webmcp/discovery instead).
	//
	// await registerChartTools(createChartDeps(shared, overrides?.chartBaseUrl));
	// await registerSimilarityTools(
	// 	createSimilarityDeps(shared, panelRuntime.deps, overrides?.chartBaseUrl)
	// );
	// await registerFollowupAuthoringTools(createFollowupAuthoringDeps(shared));
	await registerResolveTickerTool();
	await registerSearchCatalogTool();

	return panelRuntime;
}
