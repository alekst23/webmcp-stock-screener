// Composition root for the three similarity tools (T-1012-8): wires real
// infrastructure to buildFindSimilarSetupsTool/buildExplainSimilarityTool/
// buildCompareSetupsTool and registers them against document.modelContext.
// Mirrors chart/tools/registerChartTools.ts's shape exactly.
//
// SIMILARITY_TOOLS_ENABLED flipped true by T-1015-3: the capability parity
// check confirmed this group as a surviving capability behind a flag with no
// caller -- workbenchCompositionRoot.ts's registerWorkbenchComposition() now
// calls registerSimilarityTools() unconditionally, after the panel/
// workbench/screener groups (createDefaultSimilarityDeps() below requires
// the active workspace those already seed).
//
// createSimilarityDeps(shared, panelDeps, baseUrl) below (bug fix, see git
// history): this composition root used to build its own, separate
// WorkspaceRepository with a fully unseeded IdSequencer -- the same "builds
// its own infra" bug already found and fixed for chart
// (registerChartTools.ts's createChartDeps) -- so a reload could re-mint a
// panel id `find_similar_setups`'s own `bindPanel()` already held, and it
// also built its own, second `PanelRegistry` carrying only
// `similar_opportunities`, disconnected from the live one
// `registerPanelTools.ts`'s `createPanelShellRuntime` builds and
// `PanelContainer` actually renders from. T-1012-4/6/7's original note that
// registering the real kind alongside `registerDefaultPanelKinds()` throws
// `PanelKindConflictError` is stale against `panelKindRegistry.ts`'s current
// placeholder-precedence `register()` -- T-1015-12 already proved this by
// registering the real kind into the shared registry directly
// (registerPanelTools.ts). createSimilarityDeps below reuses that shared
// registry via `panelDeps` instead of building a second one.
import { ensureModelContext } from '../../../webmcp/bridge';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createRevisionService } from '../../application/revisionService';
import { createIdSequencer } from '../../domain/ids';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { DEV_API_BASE_URL } from '../../../workspace/apiConfig';
import {
	createLayoutTemplateRegistry,
	registerDefaultLayoutTemplates
} from '../../../panels/domain/layoutTemplates';
import {
	createPanelRegistry,
	type PanelRegistry
} from '../../../panels/registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../../../panels/registry/sourceRendererRegistry';
import { registerDefaultSourceRendererTypes } from '../../../panels/registry/defaultSourceRendererTypes';
import type { PanelUseCaseDeps } from '../../../panels/application';
import type { WorkbenchSharedInfra } from '../../../panels/shell/registerPanelTools';
import { createHttpSimilarityApi } from '../infra/httpSimilarityApi';
import type { SimilarityApiPort } from '../domain/apiPort';
import { similarOpportunitiesPanelKindDefinition } from '../panel/domain/panelKind';
import { buildFindSimilarSetupsTool, type FindSimilarSetupsDeps } from './findSimilarSetups';
import { buildExplainSimilarityTool } from './explainSimilarity';
import { buildCompareSetupsTool } from '../comparison/tools/compareSetups';

export const SIMILARITY_TOOLS_ENABLED = true;

export interface SimilarityToolsDeps extends PanelUseCaseDeps {
	api: SimilarityApiPort;
}

// A workspace-scoped panel registry carrying only this epic's own real kind
// -- used only by createDefaultSimilarityDeps below for isolated/standalone
// use (tests, a caller with no shared composition). The real composition
// root reuses the live registry instead (createSimilarityDeps).
function createSimilarityPanelRegistry(): PanelRegistry {
	const kinds = createPanelRegistry();
	kinds.register(similarOpportunitiesPanelKindDefinition);
	return kinds;
}

// Built directly against the shared infra bag and the panel tool group's
// already-built registries, exactly like registerChartTools.ts's
// createChartDeps and registerFollowupTools.ts's createFollowupAuthoringDeps.
// `ids` reuses `shared.ids` directly rather than a group-local sequencer:
// unlike chart/followup, this group only ever mints the `panel` resource
// kind (bindPanel()'s create_panel-equivalent), and `shared.ids` is already
// correctly panel-seeded (registerPanelTools.ts's panelIdSeed) -- a second,
// separately-seeded sequencer here would only reintroduce the risk of the
// two panel-minting paths drifting out of sync with each other.
export function createSimilarityDeps(
	shared: WorkbenchSharedInfra,
	panelDeps: Pick<PanelUseCaseDeps, 'workspaceId' | 'kinds' | 'sourceRenderer' | 'templates'>,
	baseUrl: string = DEV_API_BASE_URL
): SimilarityToolsDeps {
	const { repository, clock, revisions, history, ids } = shared;
	return {
		workspaceId: panelDeps.workspaceId,
		repository,
		revisions,
		history,
		clock,
		ids,
		kinds: panelDeps.kinds,
		sourceRenderer: panelDeps.sourceRenderer,
		templates: panelDeps.templates,
		api: createHttpSimilarityApi({ baseUrl })
	};
}

export function createDefaultSimilarityDeps(
	baseUrl: string = DEV_API_BASE_URL
): SimilarityToolsDeps {
	const repository = createLocalWorkspaceRepository();
	const clock = { now: () => new Date().toISOString() };
	const ids = createIdSequencer();
	const activeId = repository.getActiveId();
	if (!activeId) {
		throw new Error(
			'createDefaultSimilarityDeps requires an active workspace -- registerPanelTools seeds one ' +
				'before this composition root runs.'
		);
	}
	const sourceRenderer = createSourceRendererRegistry();
	registerDefaultSourceRendererTypes(sourceRenderer);
	const templates = createLayoutTemplateRegistry();
	registerDefaultLayoutTemplates(templates);
	return {
		workspaceId: activeId,
		repository,
		revisions: createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		}),
		history: createChangeHistory(),
		clock,
		ids,
		kinds: createSimilarityPanelRegistry(),
		sourceRenderer,
		templates,
		api: createHttpSimilarityApi({ baseUrl })
	};
}

export async function registerSimilarityTools(
	deps: SimilarityToolsDeps = createDefaultSimilarityDeps()
): Promise<void> {
	if (!SIMILARITY_TOOLS_ENABLED) {
		return;
	}
	const mc = ensureModelContext();
	const findDeps: FindSimilarSetupsDeps = deps;
	const specs = [
		buildFindSimilarSetupsTool(findDeps),
		buildExplainSimilarityTool({ api: deps.api }),
		buildCompareSetupsTool(deps)
	];
	for (const spec of specs) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
}
