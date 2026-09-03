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
import {
	createScreenerDeps,
	registerScreenerTools
} from '../../webmcp/screener/registerScreenerTools';
import type { ScreenerToolDeps } from '../../webmcp/screener/group';
import type { PanelBindingDeps } from '../../webmcp/screener/runScreener';
import type { ScreenerEvaluationPort } from '../../screener/ports';
import {
	createWorkbenchDeps,
	registerWorkbenchTools,
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
import { registerChartTools } from '../chart/tools/registerChartTools';
import { registerSimilarityTools } from '../similarity/tools/registerSimilarityTools';
import { registerFollowupAuthoringTools } from '../followup/tools/registerFollowupTools';

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
}

// Builds the shared infra once, constructs each group's deps against it,
// and registers all three tool groups in order (panel, workbench-core,
// screener). Returns the PanelShellRuntime so the /workbench route can
// still hand `deps`/`observer` to PanelContainer exactly as before.
export async function registerWorkbenchComposition(
	overrides?: WorkbenchCompositionOverrides
): Promise<PanelShellRuntime> {
	const shared = createWorkbenchSharedInfra();
	const panelRuntime = createPanelShellRuntime(shared);
	const workbenchDeps = buildWorkbenchDeps(shared);
	const screenerDeps = buildScreenerDeps(shared, panelRuntime.deps, overrides);

	await registerPanelTools(panelRuntime);
	await registerWorkbenchTools(workbenchDeps);
	await registerScreenerTools(screenerDeps);

	// T-1015-3: registered after the three groups above so the active
	// workspace panelRuntime just seeded already exists --
	// createDefaultSimilarityDeps() requires one. Each call is a no-op while
	// its own flag stays false, so this line is safe to run unconditionally.
	await registerChartTools();
	await registerSimilarityTools();
	await registerFollowupAuthoringTools();

	return panelRuntime;
}
