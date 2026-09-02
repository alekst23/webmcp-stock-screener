// Composition root that wires real infrastructure to buildWorkbenchTools and
// registers the seven-tool surface against document.modelContext (T-1006-8).
// Gated behind WORKBENCH_TOOLS_ENABLED per the project's dead-code policy:
// this is new registration behavior in an existing runtime path
// (document.modelContext already carries the shipping 11-tool surface), so
// it stays off until the sibling epics (T-1007..T-1013) that register their
// own operations against T-1006-7's registry are ready to ship alongside it.
// Not called from app startup by this ticket -- flip the flag (or make it a
// real runtime toggle) once the program's surface is complete.
import { ensureModelContext } from '../../webmcp/bridge';
import { createIdSequencer } from '../domain/ids';
import { makeProvenance, type MarketDataProvenance } from '../domain/provenance';
import { createChangeHistory } from '../application/changeHistory';
import { createIdempotencyCache } from '../application/idempotency';
import { operationRegistry } from '../application/operationRegistry';
import { createRevisionService } from '../application/revisionService';
import { createLocalWorkspaceRepository } from '../infra/workspaceRepository';
import { buildWorkbenchTools, type WorkbenchDeps } from './index';

export const WORKBENCH_TOOLS_ENABLED = false;

// A trivial fixed-value provenance source, matching T-1006-3's "no mock
// pipeline" boundary -- the separate reference/fundamental-data workstream
// supplies a real ProvenanceSource later.
// `static` rather than a zero-second delay: nothing ticks behind this, and a
// delay of zero would read as "live enough", which is the claim it must not
// make. Currency and price adjustment are omitted because it carries neither.
const FIXED_PROVENANCE: MarketDataProvenance = makeProvenance({
	asOf: new Date(0).toISOString(),
	sourceId: 'not_configured',
	sourceLabel: 'No market-data source configured',
	liveness: 'static',
	timezone: 'America/New_York'
});

export function createDefaultWorkbenchDeps(): WorkbenchDeps {
	const repository = createLocalWorkspaceRepository();
	const clock = { now: () => new Date().toISOString() };
	const ids = createIdSequencer();
	// One instance shared with revisions below: save_workspace replays
	// idempotency_key against the same cache mutating tools use, so a
	// caller can't tell save's bypass of RevisionService.commit apart from
	// any other tool's idempotency behavior.
	const idempotency = createIdempotencyCache();
	return {
		repository,
		revisions: createRevisionService({
			repository,
			clock,
			ids,
			idempotency
		}),
		history: createChangeHistory(),
		registry: operationRegistry,
		provenance: { current: () => FIXED_PROVENANCE },
		clock,
		ids,
		idempotency
	};
}

export async function registerWorkbenchTools(
	deps: WorkbenchDeps = createDefaultWorkbenchDeps()
): Promise<void> {
	if (!WORKBENCH_TOOLS_ENABLED) {
		return;
	}
	const mc = ensureModelContext();
	for (const spec of buildWorkbenchTools(deps)) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
}
