// Composition root for the computed-field/custom-study authoring surface.
//
// FOLLOWUP_AUTHORING_TOOLS_ENABLED flipped true by T-1015-3: the capability
// parity check confirmed create_computed_field/create_custom_study as a
// surviving capability behind a flag with no caller --
// workbenchCompositionRoot.ts's registerWorkbenchComposition() now calls
// registerFollowupAuthoringTools() unconditionally.
//
// Deliberately NOT registerAllFollowupTools() (T-1014-11's own, separate
// composition root): that function also registers backtest, watchlist, and
// alert tools unconditionally, bypassing their own *_TOOLS_ENABLED flags,
// which this ticket's Solution Approach explicitly keeps off. This function
// registers only the two authoring tools its own flag gates.
//
// T-1014-11's job also includes composing this workspace's catalog
// registry (workspaceCatalog.ts#composeWorkspaceCatalogRegistry) into the
// `catalog` dependency of the screener/results/chart tool groups it wires
// alongside this one -- that cross-group wiring (what makes a created
// field/study usable as a results column, ranking input, filter operand or
// study-output source elsewhere) is not part of what this narrower call
// wires in; each tool call still builds its own workspace-composed catalog
// registry at call time (see createDefaultFollowupAuthoringDeps below).
import { ensureModelContext } from '../../../webmcp/bridge';
import { createIdSequencer } from '../../domain/ids';
import type { IdSequencer } from '../../domain/ids';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { operationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { buildFollowupAuthoringTools, type FollowupAuthoringToolsDeps } from './index';

export const FOLLOWUP_AUTHORING_TOOLS_ENABLED = true;

export function createDefaultFollowupAuthoringDeps(): FollowupAuthoringToolsDeps {
	const repository = createLocalWorkspaceRepository();
	const clock = { now: () => new Date().toISOString() };
	const ids: IdSequencer = createIdSequencer();
	return {
		repository,
		revisions: createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		}),
		history: createChangeHistory(),
		registry: operationRegistry,
		clock,
		ids
		// catalog left undefined: each tool call builds the workspace-composed
		// registry itself (prepareCreateComputedField/prepareCreateCustomStudy's
		// own default), so a fixture/override is only needed in tests.
	};
}

export async function registerFollowupAuthoringTools(
	deps: FollowupAuthoringToolsDeps = createDefaultFollowupAuthoringDeps()
): Promise<void> {
	if (!FOLLOWUP_AUTHORING_TOOLS_ENABLED) {
		return;
	}
	const mc = ensureModelContext();
	for (const spec of buildFollowupAuthoringTools(deps)) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
}
