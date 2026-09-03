// T-1014-11: the composition root for the whole follow-up tool surface.
//
// Every preceding ticket's own register<Group>Tools.ts wraps a real
// build<Group>Tools/create<Tool>Tool factory behind a module-level
// `..._ENABLED = false` flag that is read *inside* that function -- live
// gating, not dead code. This file does not flip any of those flags (they
// stay false, and their owning files stay untouched): it imports each
// group's `build*`/`create*` factory directly and registers the resulting
// ToolSpec[] itself, exactly the way `panels/shell/registerPanelTools.ts`
// (EPIC-1007's own, already-live composition root) registers its own
// fourteen tools with no flag at all. This is "register on the new
// surface" read literally -- one more `ensureModelContext()` +
// `registerTool` loop, composing existing factories rather than adding a
// fifteenth flag of its own.
//
// One shared runtime (repository, clock, ids, idempotency, history,
// operationRegistry, panel registries, the real PinnedRunStore) is built
// once and threaded into every group's deps -- no group gets a private,
// disconnected copy of shared state. `catalog` is deliberately left
// undefined on every deps object that accepts it: each mutation composes
// `composeWorkspaceCatalogRegistry(doc)` fresh from the *current* document
// at call time (see followup/application/createComputedField.ts's own
// default), which is what makes a computed field created a moment ago
// already resolve in the very next call -- freezing one catalog instance
// at runtime-build time would miss that.
import { ensureModelContext } from '../../../webmcp/bridge';
import { fail } from '../../../webmcp/toolResult';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import { createChangeHistory, type ChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache, type IdempotencyCache } from '../../application/idempotency';
import {
	createOperationRegistry,
	type OperationRegistry
} from '../../application/operationRegistry';
import { createRevisionService, type RevisionService } from '../../application/revisionService';
import { createIdSequencer, type IdSequencer } from '../../domain/ids';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { readScreeners } from '../../../screener/state';
import { readCapturedSetups } from '../../chart/domain/capturedSetup';
import { readPanelState } from '../../../panels/application';
import { initializeWorkspace } from '../../../panels/shell/panelController';
import {
	createPanelRegistry,
	type PanelRegistry
} from '../../../panels/registry/panelKindRegistry';
import { registerDefaultPanelKinds } from '../../../panels/registry/defaultPanelKinds';
import {
	createSourceRendererRegistry,
	type SourceRendererRegistry
} from '../../../panels/registry/sourceRendererRegistry';
import { registerDefaultSourceRendererTypes } from '../../../panels/registry/defaultSourceRendererTypes';
import {
	createLayoutTemplateRegistry,
	registerDefaultLayoutTemplates,
	type LayoutTemplateRegistry
} from '../../../panels/domain/layoutTemplates';
import { similarOpportunitiesPanelKindDefinition } from '../../similarity/panel/domain/panelKind';
import { createPinnedRunStore } from '../../../screener/runStore';
import {
	createTrackedPinnedRunStore,
	type TrackedPinnedRunStore
} from '../infra/trackedPinnedRunStore';
import {
	isGatedFollowupTool,
	unmetFollowupPrerequisite,
	type FollowupAvailabilitySnapshot
} from '../domain/followupAvailability';

import { buildFollowupAuthoringTools, type FollowupAuthoringToolsDeps } from './index';
import { buildDeriveFiltersFromSetupTool } from '../../screener/tools/deriveFiltersFromSetup';
import type { DeriveFiltersFromSetupDeps } from '../../screener/tools/deriveFiltersFromSetup';
import { buildRefineSimilaritySearchTool } from '../../similarity/refinement/tools/refineSimilaritySearch';
import type { RefineSimilaritySearchToolDeps } from '../../similarity/refinement/tools/refineSimilaritySearch';
import type { SimilarityApiPort } from '../../similarity/domain/apiPort';
import { createHttpSimilarityApi } from '../../similarity/infra/httpSimilarityApi';
import { createBacktestScreenerTool } from '../../backtest/tools/backtestScreener';
import { createGetBacktestResultsTool } from '../../backtest/tools/getBacktestResults';
import type { BacktestApiPort } from '../../backtest/domain/apiPort';
import { createHttpBacktestApi } from '../../backtest/infra/httpBacktestApi';
import { buildWatchlistTools, type WatchlistToolsDeps } from '../../watchlist/tools/index';
import { buildAlertTools, type AlertToolsDeps } from '../../alerts/tools/index';
import type { AlertHistoricalDataPort } from '../../alerts/domain/alertPreview';
import { createInMemoryAlertHistoricalData } from '../../alerts/infra/inMemoryAlertHistoricalData';
import { buildExportResultsTool } from '../../export/tools/exportResultsTool';
import type { ExportResultsDeps } from '../../export/tools/exportResultsTool';
import { DEV_API_BASE_URL } from '../../../workspace/apiConfig';

// ---------------------------------------------------------------------------
// Shared runtime
// ---------------------------------------------------------------------------

export interface FollowupSurfaceRuntime {
	repository: WorkspaceRepository;
	clock: Clock;
	ids: IdSequencer;
	idempotency: IdempotencyCache;
	history: ChangeHistory;
	registry: OperationRegistry;
	revisions: RevisionService;
	runs: TrackedPinnedRunStore;
	kinds: PanelRegistry;
	sourceRenderer: SourceRendererRegistry;
	templates: LayoutTemplateRegistry;
	workspaceId: string;
	similarityApi: SimilarityApiPort;
	backtestApi: BacktestApiPort;
	alertHistoricalData: AlertHistoricalDataPort;
}

export interface FollowupSurfaceOptions {
	// Isolated backing store per runtime instance (memoryStorage() in
	// tests); real localStorage-backed persistence when omitted.
	storage?: Storage;
	baseUrl?: string;
	// Overridable for tests -- the real client hits a backend this program
	// does not ship a fake of in-process; a test supplies its own
	// SimilarityApiPort fixture instead of stubbing HTTP.
	similarityApi?: SimilarityApiPort;
	backtestApi?: BacktestApiPort;
	// Defaults to the wall clock; a test supplies a fixed Clock so two
	// timestamps recorded microseconds apart don't fail an otherwise-exact
	// content comparison.
	clock?: Clock;
}

// Fresh instances every call -- never a module-level singleton -- so two
// runtimes (a production one and a test's own) never share state, matching
// every sibling composition root's own createDefault*Deps() convention.
export function createDefaultFollowupSurfaceRuntime(
	options: FollowupSurfaceOptions = {}
): FollowupSurfaceRuntime {
	const repository = createLocalWorkspaceRepository(options.storage);
	const clock: Clock = options.clock ?? { now: () => new Date().toISOString() };
	const ids = createIdSequencer();
	const idempotency = createIdempotencyCache();
	const history = createChangeHistory();
	// A fresh registry, not the module-global `operationRegistry` default:
	// this runtime is rebuilt per test, and OperationRegistry.register()
	// throws on a duplicate kind, so sharing the singleton across repeated
	// test-local runtimes would fail the second one.
	const registry = createOperationRegistry();
	const revisions = createRevisionService({ repository, clock, ids, idempotency });

	const kinds = createPanelRegistry();
	kinds.register(similarOpportunitiesPanelKindDefinition);
	registerDefaultPanelKinds(kinds);
	const sourceRenderer = createSourceRendererRegistry();
	registerDefaultSourceRendererTypes(sourceRenderer);
	const templates = createLayoutTemplateRegistry();
	registerDefaultLayoutTemplates(templates);

	const { workspaceId } = initializeWorkspace(
		{ repository, revisions, history, clock, ids },
		'Workbench'
	);

	const baseUrl = options.baseUrl ?? DEV_API_BASE_URL;
	return {
		repository,
		clock,
		ids,
		idempotency,
		history,
		registry,
		revisions,
		runs: createTrackedPinnedRunStore(createPinnedRunStore()),
		kinds,
		sourceRenderer,
		templates,
		workspaceId,
		similarityApi: options.similarityApi ?? createHttpSimilarityApi({ baseUrl }),
		backtestApi: options.backtestApi ?? createHttpBacktestApi({ baseUrl }),
		alertHistoricalData: createInMemoryAlertHistoricalData()
	};
}

// ---------------------------------------------------------------------------
// Per-group deps, all drawn from the one shared runtime
// ---------------------------------------------------------------------------

function followupAuthoringDeps(runtime: FollowupSurfaceRuntime): FollowupAuthoringToolsDeps {
	return {
		repository: runtime.repository,
		revisions: runtime.revisions,
		history: runtime.history,
		registry: runtime.registry,
		clock: runtime.clock,
		ids: runtime.ids
	};
}

function filterDraftDeps(runtime: FollowupSurfaceRuntime): DeriveFiltersFromSetupDeps {
	return {
		repository: runtime.repository,
		revisions: runtime.revisions,
		history: runtime.history,
		registry: runtime.registry,
		clock: runtime.clock,
		ids: runtime.ids
	};
}

function refinementDeps(runtime: FollowupSurfaceRuntime): RefineSimilaritySearchToolDeps {
	return {
		workspaceId: runtime.workspaceId,
		repository: runtime.repository,
		revisions: runtime.revisions,
		history: runtime.history,
		clock: runtime.clock,
		ids: runtime.ids,
		kinds: runtime.kinds,
		sourceRenderer: runtime.sourceRenderer,
		templates: runtime.templates,
		api: runtime.similarityApi
	};
}

function watchlistDeps(runtime: FollowupSurfaceRuntime): WatchlistToolsDeps {
	return {
		repository: runtime.repository,
		revisions: runtime.revisions,
		history: runtime.history,
		registry: runtime.registry,
		clock: runtime.clock,
		ids: runtime.ids,
		runs: runtime.runs
	};
}

function alertDeps(runtime: FollowupSurfaceRuntime): AlertToolsDeps {
	return {
		repository: runtime.repository,
		revisions: runtime.revisions,
		history: runtime.history,
		registry: runtime.registry,
		clock: runtime.clock,
		ids: runtime.ids,
		historicalData: runtime.alertHistoricalData
	};
}

function exportDeps(runtime: FollowupSurfaceRuntime): ExportResultsDeps {
	return { runs: runtime.runs };
}

// ---------------------------------------------------------------------------
// Availability gate (AC2) -- wraps only the five tools with a workspace-wide
// prerequisite; every other tool is returned unchanged.
// ---------------------------------------------------------------------------

function snapshotFor(
	runtime: FollowupSurfaceRuntime,
	workspaceId: string
): FollowupAvailabilitySnapshot {
	const doc = runtime.repository.get(workspaceId);
	const hasSimilaritySearch = doc
		? readPanelState(doc).panels.some(
				(p) =>
					p.kind === 'similar_opportunities' && Boolean((p.config as { runId?: unknown }).runId)
			)
		: false;
	return {
		hasScreener: doc ? readScreeners(doc).length > 0 : false,
		hasPinnedRun: runtime.runs.hasAnyRun(),
		hasCapturedSetup: doc ? readCapturedSetups(doc).length > 0 : false,
		hasSimilaritySearch
	};
}

function resolveWorkspaceId(runtime: FollowupSurfaceRuntime, input: unknown): string {
	const workspaceId =
		typeof input === 'object' && input !== null
			? (input as { workspace_id?: unknown }).workspace_id
			: undefined;
	return typeof workspaceId === 'string' ? workspaceId : runtime.workspaceId;
}

function withAvailabilityGate(spec: ToolSpec, runtime: FollowupSurfaceRuntime): ToolSpec {
	if (!isGatedFollowupTool(spec.name)) {
		return spec;
	}
	return {
		...spec,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const workspaceId = resolveWorkspaceId(runtime, rawInput);
			const snapshot = snapshotFor(runtime, workspaceId);
			const unmet = unmetFollowupPrerequisite(spec.name, rawInput, snapshot);
			if (unmet) {
				return fail(unmet.message, { error: 'unavailable', reason: unmet.prerequisite });
			}
			return spec.execute(rawInput);
		}
	};
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

// Builds every tool this ticket ships, with the availability gate applied.
// Exported (not just used by registerAllFollowupTools) so tests can drive
// the exact registered surface without going through document.modelContext.
export function buildAllFollowupTools(runtime: FollowupSurfaceRuntime): ToolSpec[] {
	const specs: ToolSpec[] = [
		...buildFollowupAuthoringTools(followupAuthoringDeps(runtime)),
		buildDeriveFiltersFromSetupTool(filterDraftDeps(runtime)),
		buildRefineSimilaritySearchTool(refinementDeps(runtime)),
		createBacktestScreenerTool({
			repository: runtime.repository,
			ids: runtime.ids,
			api: runtime.backtestApi
		}),
		createGetBacktestResultsTool({ api: runtime.backtestApi }),
		...buildWatchlistTools(watchlistDeps(runtime)),
		...buildAlertTools(alertDeps(runtime)),
		buildExportResultsTool(exportDeps(runtime))
	];
	return specs.map((spec) => withAvailabilityGate(spec, runtime));
}

export async function registerAllFollowupTools(
	runtime: FollowupSurfaceRuntime = createDefaultFollowupSurfaceRuntime()
): Promise<{ runtime: FollowupSurfaceRuntime; tools: ToolSpec[] }> {
	const mc = ensureModelContext();
	const tools = buildAllFollowupTools(runtime);
	for (const spec of tools) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
	return { runtime, tools };
}
