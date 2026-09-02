// Composition root for the three similarity tools (T-1012-8): wires real
// infrastructure to buildFindSimilarSetupsTool/buildExplainSimilarityTool/
// buildCompareSetupsTool and registers them against document.modelContext.
// Mirrors chart/tools/registerChartTools.ts's shape exactly -- same
// flagged-off, not-called-from-app-startup pattern every sibling "new
// surface" composition root uses (registerChartTools.ts, registerWorkbenchTools.ts).
// See this ticket's Solution Approach for why: even EPIC-1011's chart tools,
// already merged, are not live in the running app yet -- flipping every
// surface on together is a later, whole-program decision this ticket does
// not make.
//
// The panel-kind registry this factory builds carries ONLY the real
// `similar_opportunities` definition, never combined with
// `registerDefaultPanelKinds()` in the same registry instance -- doing so
// throws `PanelKindConflictError`, since that function unconditionally
// registers a placeholder under the same name and the registry has no
// unregister/replace method. T-1012-4/6/7 hit and documented this same gap;
// see the ticket doc's Solution Approach for the consolidated finding.
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
import { createHttpSimilarityApi } from '../infra/httpSimilarityApi';
import type { SimilarityApiPort } from '../domain/apiPort';
import { similarOpportunitiesPanelKindDefinition } from '../panel/domain/panelKind';
import { buildFindSimilarSetupsTool, type FindSimilarSetupsDeps } from './findSimilarSetups';
import { buildExplainSimilarityTool } from './explainSimilarity';
import { buildCompareSetupsTool } from '../comparison/tools/compareSetups';

export const SIMILARITY_TOOLS_ENABLED = false;

export interface SimilarityToolsDeps extends PanelUseCaseDeps {
	api: SimilarityApiPort;
}

// A workspace-scoped panel registry carrying only this epic's own real kind
// -- never `registerDefaultPanelKinds()` in the same instance, see this
// file's header.
function createSimilarityPanelRegistry(): PanelRegistry {
	const kinds = createPanelRegistry();
	kinds.register(similarOpportunitiesPanelKindDefinition);
	return kinds;
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
