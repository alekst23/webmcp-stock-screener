// Composition root for the computed-field/custom-study authoring surface,
// gated the same way alerts/tools/registerAlertTools.ts gates
// ALERT_TOOLS_ENABLED: the follow-up tool surface this belongs to is wired
// on together by T-1014-11, not by this ticket. Not called from app
// startup here.
//
// T-1014-11's job also includes composing this workspace's catalog
// registry (workspaceCatalog.ts#composeWorkspaceCatalogRegistry) into the
// `catalog` dependency of the screener/results/chart tool groups it wires
// alongside this one -- that is what actually makes a created field/study
// usable as a results column, ranking input, filter operand or
// study-output source in a live app; see the ticket's Solution Approach.
import { ensureModelContext } from '../../../webmcp/bridge';
import { createIdSequencer } from '../../domain/ids';
import type { IdSequencer } from '../../domain/ids';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { operationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { buildFollowupAuthoringTools, type FollowupAuthoringToolsDeps } from './index';

export const FOLLOWUP_AUTHORING_TOOLS_ENABLED = false;

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
