// Composition root that wires real infrastructure to buildScreenerTools and
// registers the six-tool screener surface against document.modelContext
// (T-1009-10), mirroring workbench/tools/registerWorkbenchTools.ts's
// createDefault*Deps() + gated register-function shape.
//
// Gated behind SCREENER_TOOLS_ENABLED per the project's dead-code policy:
// registering a second tool group alongside the shipping 11-tool surface
// (and whatever sibling epics have already registered under their own
// flags) is new behavior in an existing runtime path, so it stays off, and
// is not called from app startup, until this epic's surface is complete.
//
// Independent instances from registerWorkbenchTools.ts's own
// createDefaultWorkbenchDeps() -- like registerPanelTools.ts, this
// composition root builds its own repository/clock/ids rather than
// importing that function, so this ticket does not have to decide how a
// future single composition root shares one workspace repository across
// every tool group. That sharing decision belongs to whichever ticket wires
// every group into one running app.
import { builtinCatalogRegistry } from '../../catalog/registry';
import { createUnavailableInstrumentDirectory } from '../../discovery/unavailableDirectory';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { operationRegistry } from '../../workbench/application/operationRegistry';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import { makeProvenance, type MarketDataProvenance } from '../../workbench/domain/provenance';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { ensureModelContext } from '../bridge';
import { buildScreenerTools, type ScreenerToolDeps } from './group';

export const SCREENER_TOOLS_ENABLED = false;

// Matches registerWorkbenchTools.ts's FIXED_PROVENANCE: `static` rather
// than a zero-second delay, and no currency/price-adjustment claim, since
// no real market-data source is wired up here. None of the six screener
// tools reads this field directly (they carry their own marketData/catalog
// options), but WorkbenchDeps requires it.
const FIXED_PROVENANCE: MarketDataProvenance = makeProvenance({
	asOf: new Date(0).toISOString(),
	sourceId: 'not_configured',
	sourceLabel: 'No market-data source configured',
	liveness: 'static',
	timezone: 'America/New_York'
});

export function createDefaultScreenerToolDeps(): ScreenerToolDeps {
	const repository = createLocalWorkspaceRepository();
	const clock = { now: () => new Date().toISOString() };
	const ids = createIdSequencer();
	const idempotency = createIdempotencyCache();
	return {
		repository,
		revisions: createRevisionService({ repository, clock, ids, idempotency }),
		history: createChangeHistory(),
		registry: operationRegistry,
		provenance: { current: () => FIXED_PROVENANCE },
		clock,
		ids,
		idempotency,
		catalog: builtinCatalogRegistry,
		// Honest "no reference-data source" default (AC6's own convention in
		// set_screener_universe), not a mock dataset.
		instrumentDirectory: createUnavailableInstrumentDirectory()
		// marketData, costBudget, evaluationPort, runStore and now are left
		// undefined: validate_screener and run_screener each apply their own
		// honest-unavailability default (createUnavailableMarketData) when
		// omitted, matching the deviation note's "browser-side over the
		// ScreenerEvaluationPort domain port" architecture.
	};
}

export async function registerScreenerTools(
	deps: ScreenerToolDeps = createDefaultScreenerToolDeps()
): Promise<void> {
	if (!SCREENER_TOOLS_ENABLED) {
		return;
	}
	const mc = ensureModelContext();
	const specs = buildScreenerTools(deps);
	for (const spec of specs) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
}
