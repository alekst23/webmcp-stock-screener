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
// Chart-demo trim (see plan: "Trim the WebMCP tool surface to a chart-only
// demo set"): registerWorkbenchTools/registerScreenerTools/registerChartTools/
// registerSimilarityTools/registerFollowupAuthoringTools have no caller below
// any more -- only their own createXDeps builders survive as live imports,
// still exercised directly by workbenchCompositionRoot.test.ts. Restoring the
// full surface means uncommenting the register* imports below alongside their
// call sites in registerWorkbenchComposition.
import {
	createScreenerDeps
	// registerScreenerTools
} from '../../webmcp/screener/registerScreenerTools';
import type { ScreenerToolDeps } from '../../webmcp/screener/group';
import type { PanelBindingDeps } from '../../webmcp/screener/runScreener';
import type { ScreenerEvaluationPort } from '../../screener/ports';
import {
	createWorkbenchDeps,
	// registerWorkbenchTools,
	type DefaultWorkbenchDeps
} from '../tools/registerWorkbenchTools';
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
// so this stays the minimal additive change; T-0026-3 folds it into the
// exact-seven-tool MVP registration this file settles into.
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
		evaluationPort: overrides?.evaluationPort
	};
}

// Injection seam for tests only: `+page.svelte`'s real call site never
// passes this, so the shipped default behavior (createScreenerEngine wired
// to the honest-unavailable ScreenerMarketData, per createRunScreenerTool's
// own default in runScreener.ts) is unchanged. Exists so a test can call
// the REAL registerWorkbenchComposition() -- not a hand-reconstruction of
// its internals -- while still substituting a fake evaluation port (no real
// ScreenerMarketData adapter exists anywhere in this codebase yet, so every
// real evaluation refuses with empty_universe).
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

	// Chart-demo trim (see plan: "Trim the WebMCP tool surface to a
	// chart-only demo set"): the workbench-core/screener/chart-authoring/
	// similarity/follow-up-authoring groups below are commented out, not
	// deleted, so restoring the full ~39-tool surface later is a straight
	// uncomment -- buildWorkbenchDeps/buildScreenerDeps above still exist and
	// are still exercised directly by workbenchCompositionRoot.test.ts, they
	// just have no caller here for now. registerResolveTickerTool() is the
	// one new tool this trim adds -- see resolveTicker.ts for why a chart
	// panel needs it (bind_panel_source's 'instrument' source type requires
	// a resolved instrument_id/symbol/exchange/asset_type, and nothing else
	// in this codebase can mint one; see that file's own header for why this
	// isn't routed through webmcp/discovery instead).
	//
	// const workbenchDeps = buildWorkbenchDeps(shared);
	// const screenerDeps = buildScreenerDeps(shared, panelRuntime.deps, overrides);
	// await registerWorkbenchTools(workbenchDeps);
	// await registerScreenerTools(screenerDeps);
	// await registerChartTools(createChartDeps(shared, overrides?.chartBaseUrl));
	// await registerSimilarityTools(
	// 	createSimilarityDeps(shared, panelRuntime.deps, overrides?.chartBaseUrl)
	// );
	// await registerFollowupAuthoringTools(createFollowupAuthoringDeps(shared));
	await registerResolveTickerTool();
	await registerSearchCatalogTool();

	return panelRuntime;
}
