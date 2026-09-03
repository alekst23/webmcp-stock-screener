// Composition root: builds real infrastructure, initializes (and, for a
// brand-new workspace, seeds) the active workspace, and registers the
// fourteen panel tools against the browser's WebMCP bridge. Mirrors
// workbench/tools/registerWorkbenchTools.ts's createDefault*Deps() +
// register-function shape. Unlike that module, no feature flag: this is the
// new /workbench route's own composition root, not new behavior layered
// into an existing runtime path, so the project's dead-code policy asks
// nothing extra of it.
import { ensureModelContext } from '../../webmcp/bridge';
import { builtinCatalogRegistry } from '../../catalog/registry';
import { createPinnedRunStore } from '../../screener/runStore';
import type { PinnedRunStore } from '../../screener/ports';
import { registerResultsTableRendererContract } from '../../results/tools/tableRendererContract';
import { registerResultsTablePanelKind } from '../../results/registry/resultsTablePanelKind';
import { buildResultsTools } from '../../results/tools/resultsTools';
import { registerWatchlistPanelKind } from '../../workbench/watchlist/registry/watchlistPanelKind';
import { registerAlertDraftPanelKind } from '../../workbench/alerts/registry/alertDraftPanelKind';
import { similarOpportunitiesPanelKindDefinition } from '../../workbench/similarity/panel/domain/panelKind';
import { createChangeHistory, type ChangeHistory } from '../../workbench/application/changeHistory';
import {
	createIdempotencyCache,
	type IdempotencyCache
} from '../../workbench/application/idempotency';
import {
	createRevisionService,
	type RevisionService
} from '../../workbench/application/revisionService';
import { createIdSequencer, type IdSequencer } from '../../workbench/domain/ids';
import type { Clock, WorkspaceRepository } from '../../workbench/domain/ports';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import {
	createLayoutTemplateRegistry,
	registerDefaultLayoutTemplates
} from '../domain/layoutTemplates';
import { createPanelRegistry } from '../registry/panelKindRegistry';
import { registerDefaultPanelKinds } from '../registry/defaultPanelKinds';
import { createSourceRendererRegistry } from '../registry/sourceRendererRegistry';
import { registerDefaultSourceRendererTypes } from '../registry/defaultSourceRendererTypes';
import {
	buildPanelTools,
	createMaximizedPanelState,
	type PanelToolDeps
} from '../tools/panelTools';
import {
	createPanelWorkspaceObserver,
	initializeWorkspace,
	seedDefaultWorkspace,
	wrapToolsWithNotify,
	type PanelWorkspaceObserver
} from './panelController';

export interface PanelShellRuntime {
	deps: PanelToolDeps;
	observer: PanelWorkspaceObserver;
	// The exact PinnedRunStore instance the table renderer contract and the
	// results_table panel kind already close over (T-1010-7) -- exposed here
	// too so registerPanelTools() below can build the two results tools
	// (T-1010-8) against the same store, rather than a second one that would
	// silently disagree with what the panel itself renders.
	runs: PinnedRunStore;
}

// T-0020-1: the seven cross-tool-group instances a shared composition root
// threads into every /workbench tool group (panel, workbench-core,
// screener). Kept minimal and structural (no import of a WorkbenchDeps-style
// interface) so this module does not have to depend on workbench/tools or
// webmcp/screener -- those compose *against* this shape, not the reverse.
export interface WorkbenchSharedInfra {
	repository: WorkspaceRepository;
	clock: Clock;
	ids: IdSequencer;
	idempotency: IdempotencyCache;
	history: ChangeHistory;
	revisions: RevisionService;
	runs: PinnedRunStore;
}

// Builds one fresh instance of each of the seven shared infra pieces --
// callers that need one-off isolation (unit tests, createDefaultPanelShellRuntime
// below) use this; a real composition root instead builds this once and
// threads the same bag into every tool group's own deps builder.
export function createWorkbenchSharedInfra(): WorkbenchSharedInfra {
	const repository = createLocalWorkspaceRepository();
	const clock = { now: () => new Date().toISOString() };
	const ids = createIdSequencer();
	const idempotency = createIdempotencyCache();
	const history = createChangeHistory();
	const revisions = createRevisionService({ repository, clock, ids, idempotency });
	const runs = createPinnedRunStore();
	return { repository, clock, ids, idempotency, history, revisions, runs };
}

// Builds the panel shell's runtime against a given shared infra bag rather
// than building its own repository/revisions/etc -- the shape
// createDefaultPanelShellRuntime below now delegates to, and the shape a
// shared composition root (T-0020-1) calls directly with its own bag so the
// panel tool group never builds independent instances in that composition.
export function createPanelShellRuntime(shared: WorkbenchSharedInfra): PanelShellRuntime {
	// idempotency is intentionally not read here: it is already folded into
	// `shared.revisions`, and the panel tool group has no other use for the
	// cache directly -- only workbench-core/screener deps need it as its own
	// field (save_workspace's and run_screener's own idempotency replay).
	const { repository, clock, ids, history, revisions, runs } = shared;

	const kinds = createPanelRegistry();
	const sourceRenderer = createSourceRendererRegistry();

	const templates = createLayoutTemplateRegistry();
	registerDefaultLayoutTemplates(templates);

	// T-1010-7 / T-0020-1: `runs` comes from the shared infra bag rather than
	// this function building its own -- the same store instance is closed
	// over by both the table renderer contract's validateSelection hook and
	// the panel body's own reads (so they can never disagree about what's
	// pinned), and, since T-0020-1, by the screener tool group's run_screener
	// too, so a run executed through the screener group is visible here.

	// T-1007-9: seeding runs synchronously, right here, before this function
	// returns -- there is no await between initializeWorkspace deciding
	// justCreated and seedDefaultWorkspace consuming it, so nothing can
	// observe the brand-new workspace before it already has its three panels.
	const init = initializeWorkspace({ repository, revisions, history, clock, ids });
	const deps: PanelToolDeps = {
		workspaceId: init.workspaceId,
		repository,
		revisions,
		history,
		clock,
		ids,
		kinds,
		sourceRenderer,
		templates,
		maximized: createMaximizedPanelState()
	};

	// Real results_table registration (T-1010-7), before the placeholder
	// defaults below -- registerDefaultPanelKinds/registerDefaultSourceRendererTypes
	// now skip any kind/renderer/source already present, so registering these
	// first is what makes "results_table" resolve to the real kind and
	// "table"/"screener_results" resolve to the real renderer contract
	// everywhere downstream, including this same function's own
	// seedDefaultWorkspace call below.
	registerResultsTableRendererContract(sourceRenderer, { runs, catalog: builtinCatalogRegistry });
	registerResultsTablePanelKind(kinds, {
		useCaseDeps: deps,
		runs,
		catalog: builtinCatalogRegistry
	});

	// T-1015-12: the real watchlist and alert_draft kinds (this ticket), and
	// the real similar_opportunities kind (T-1012-6) -- previously only ever
	// registered into registerSimilarityTools.ts's own standalone,
	// disconnected PanelRegistry (see that module's header), never this
	// shared one DEFAULT_SEED_PANELS/seedDefaultWorkspace below actually
	// seeds against. Registering here, before the placeholder defaults and
	// before seedDefaultWorkspace runs, is what makes a brand-new workspace's
	// seeded panels bake in each kind's real defaultConfig() (AC1-AC3)
	// instead of defaultPanelKinds.ts's placeholder shape.
	registerWatchlistPanelKind(kinds, { useCaseDeps: deps });
	registerAlertDraftPanelKind(kinds, { useCaseDeps: deps });
	kinds.register(similarOpportunitiesPanelKindDefinition);

	registerDefaultPanelKinds(kinds);
	registerDefaultSourceRendererTypes(sourceRenderer);

	seedDefaultWorkspace(deps, init.justCreated);

	return { deps, observer: createPanelWorkspaceObserver(), runs };
}

// Fresh instances every call -- never the module-global defaults -- so a
// second mount (or a test) never sees another instance's registrations,
// matching application/testSupport.ts's own isolation convention. Kept for
// this module's own unit tests and any standalone caller; /workbench's
// actual composition (workbench/composition/workbenchCompositionRoot.ts,
// T-0020-1) calls createPanelShellRuntime directly with its own shared bag
// instead, so the panel tool group never builds independent instances there.
export function createDefaultPanelShellRuntime(): PanelShellRuntime {
	return createPanelShellRuntime(createWorkbenchSharedInfra());
}

// Registers the fourteen panel tools plus the two Results tools this epic
// registers directly (T-1010-8: get_screener_results, explain_result) --
// each wrapped so a successful call notifies the shell's observer, which is
// how PanelContainer re-renders without a reload after any agent-driven
// mutation (AC5). Wrapping the two read-only Results tools the same way is
// harmless: notifying after a read that changed nothing just re-renders
// already-current state. Returns the runtime so the caller (the /workbench
// route) can hand the same deps/observer to PanelContainer.
export async function registerPanelTools(
	runtime: PanelShellRuntime = createDefaultPanelShellRuntime()
): Promise<PanelShellRuntime> {
	const mc = ensureModelContext();
	const allTools = [
		...buildPanelTools(runtime.deps),
		...buildResultsTools({ ...runtime.deps, runs: runtime.runs })
	];
	const tools = wrapToolsWithNotify(allTools, runtime.observer);
	for (const spec of tools) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
	return runtime;
}
