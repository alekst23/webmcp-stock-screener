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
//
// createFollowupAuthoringDeps(shared) below (bug fix, see git history):
// this composition root used to build its own, separate WorkspaceRepository
// with a fully unseeded IdSequencer, the exact "builds its own infra
// instead of sharing registerPanelTools.ts's bag" bug already found and
// fixed for chart (createChartTools.ts's createChartDeps) -- with the
// consequence that a reload could re-mint a `field.custom.<n>`/
// `study.custom.<n>` id an existing computed field/custom study already
// held. `computedFieldIdSeed`/`customStudyIdSeed` (followupIds.ts) already
// existed for exactly this and were simply never wired into a composition
// root -- this is that wiring, not a new mechanism.
import { ensureModelContext } from '../../../webmcp/bridge';
import { createIdSequencer } from '../../domain/ids';
import type { IdSequencer } from '../../domain/ids';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { operationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { WorkbenchSharedInfra } from '../../../panels/shell/registerPanelTools';
import { readComputedFields } from '../domain/computedField';
import { readCustomStudies } from '../domain/customStudy';
import { computedFieldIdSeed, customStudyIdSeed } from '../domain/followupIds';
import { buildFollowupAuthoringTools, type FollowupAuthoringToolsDeps } from './index';

export const FOLLOWUP_AUTHORING_TOOLS_ENABLED = true;

export function followupIdSeed(doc: WorkspaceDocument | null): Record<string, number> {
	if (!doc) {
		return {};
	}
	return {
		...computedFieldIdSeed(readComputedFields(doc).map((f) => f.id)),
		...customStudyIdSeed(readCustomStudies(doc).map((s) => s.id))
	};
}

// Built directly against a given shared infra bag -- repository, revisions,
// history and clock are the exact same instances every other /workbench
// tool group's deps object is built against -- rather than this module
// constructing its own independent repository. `ids` is deliberately NOT
// `shared.ids`: that sequencer is only ever seeded for the resource kinds
// the panel/workbench-core/screener groups mint, not `computedfield`/
// `customstudy` -- reusing it here unseeded would reintroduce this same bug
// for this group's own resources. Mirrors chart/tools/registerChartTools.ts's
// createChartDeps exactly.
export function createFollowupAuthoringDeps(
	shared: WorkbenchSharedInfra
): FollowupAuthoringToolsDeps {
	const { repository, clock, revisions, history } = shared;
	const activeId = repository.getActiveId();
	const ids = createIdSequencer(followupIdSeed(activeId ? repository.get(activeId) : null));
	return {
		repository,
		revisions,
		history,
		registry: operationRegistry,
		clock,
		ids
	};
}

// Fresh instances every call -- never a module-global default -- so a second
// mount (or a test) never sees another instance's registrations. Kept for
// this module's own unit tests and any standalone caller; the real
// composition root (workbenchCompositionRoot.ts) calls
// createFollowupAuthoringDeps directly with its shared bag instead, so this
// group never builds an independent repository there.
export function createDefaultFollowupAuthoringDeps(): FollowupAuthoringToolsDeps {
	const repository = createLocalWorkspaceRepository();
	const clock = { now: () => new Date().toISOString() };
	const activeId = repository.getActiveId();
	const ids: IdSequencer = createIdSequencer(
		followupIdSeed(activeId ? repository.get(activeId) : null)
	);
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
