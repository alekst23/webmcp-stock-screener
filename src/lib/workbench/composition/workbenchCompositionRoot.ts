// T-0020-1: the one shared composition root for `/workbench`. Builds
// exactly one WorkspaceRepository, ID sequencer, idempotency cache,
// revision service, change history, and PinnedRunStore
// (registerPanelTools.ts's createWorkbenchSharedInfra), and threads that
// same bag into all three tool groups this route registers -- panel tools,
// workbench-core tools, and screener tools -- so a mutation made through
// one is visible to a read through another. Deliberately does not call any
// of the three groups' own createDefault*Deps(): each of those still
// exists for that module's own unit tests (AC2), but this module builds
// each group's deps object directly against the shared bag instead.
import { builtinCatalogRegistry } from '../../catalog/registry';
import { createUnavailableInstrumentDirectory } from '../../discovery/unavailableDirectory';
import {
	createPanelShellRuntime,
	createWorkbenchSharedInfra,
	registerPanelTools,
	type PanelShellRuntime,
	type WorkbenchSharedInfra
} from '../../panels/shell/registerPanelTools';
import { registerScreenerTools } from '../../webmcp/screener/registerScreenerTools';
import type { ScreenerToolDeps } from '../../webmcp/screener/group';
import { registerWorkbenchTools, type DefaultWorkbenchDeps } from '../tools/registerWorkbenchTools';
import { operationRegistry } from '../application/operationRegistry';
import { createPreviewStore } from '../infra/previewStore';
import { makeProvenance, type MarketDataProvenance } from '../domain/provenance';

export type { WorkbenchSharedInfra };
export { createWorkbenchSharedInfra };

// Matches registerWorkbenchTools.ts's and registerScreenerTools.ts's own
// FIXED_PROVENANCE: no real market-data source is wired up on /workbench
// yet, so every group that requires a ProvenanceSource is honest about it
// carrying neither currency nor a price adjustment, and reporting `static`
// liveness rather than a delay of zero (which would read as "live enough").
const FIXED_PROVENANCE: MarketDataProvenance = makeProvenance({
	asOf: new Date(0).toISOString(),
	sourceId: 'not_configured',
	sourceLabel: 'No market-data source configured',
	liveness: 'static',
	timezone: 'America/New_York'
});

// WorkbenchDeps built directly against the shared bag -- repository,
// revisions, history, clock, ids, and idempotency are the exact same
// instances every other group's deps object below also carries.
export function buildWorkbenchDeps(shared: WorkbenchSharedInfra): DefaultWorkbenchDeps {
	return {
		repository: shared.repository,
		revisions: shared.revisions,
		history: shared.history,
		registry: operationRegistry,
		provenance: { current: () => FIXED_PROVENANCE },
		clock: shared.clock,
		ids: shared.ids,
		idempotency: shared.idempotency,
		previews: createPreviewStore({ clock: shared.clock })
	};
}

// ScreenerToolDeps built directly against the shared bag, with `runStore`
// pointed at the same PinnedRunStore the panel shell's results_table panel
// kind and table renderer contract already close over -- the precondition
// T-0020-2's auto-bind needs: a run_screener call and a results_table panel
// read must agree on what's pinned.
export function buildScreenerDeps(shared: WorkbenchSharedInfra): ScreenerToolDeps {
	return {
		repository: shared.repository,
		revisions: shared.revisions,
		history: shared.history,
		registry: operationRegistry,
		provenance: { current: () => FIXED_PROVENANCE },
		clock: shared.clock,
		ids: shared.ids,
		idempotency: shared.idempotency,
		catalog: builtinCatalogRegistry,
		// Honest "no reference-data source" default (matches
		// registerScreenerTools.ts's own createDefaultScreenerToolDeps), not a
		// mock dataset.
		instrumentDirectory: createUnavailableInstrumentDirectory(),
		runStore: shared.runs
	};
}

// Builds the shared infra once, constructs each group's deps against it,
// and registers all three tool groups in order (panel, workbench-core,
// screener). Returns the PanelShellRuntime so the /workbench route can
// still hand `deps`/`observer` to PanelContainer exactly as before.
export async function registerWorkbenchComposition(): Promise<PanelShellRuntime> {
	const shared = createWorkbenchSharedInfra();
	const panelRuntime = createPanelShellRuntime(shared);
	const workbenchDeps = buildWorkbenchDeps(shared);
	const screenerDeps = buildScreenerDeps(shared);

	await registerPanelTools(panelRuntime);
	await registerWorkbenchTools(workbenchDeps);
	await registerScreenerTools(screenerDeps);

	return panelRuntime;
}
