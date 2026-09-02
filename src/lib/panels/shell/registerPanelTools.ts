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
import { registerResultsTableRendererContract } from '../../results/tools/tableRendererContract';
import { registerResultsTablePanelKind } from '../../results/registry/resultsTablePanelKind';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
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
}

// Fresh registry instances every call -- never the module-global defaults --
// so a second mount (or a test) never sees another instance's registrations,
// matching application/testSupport.ts's own isolation convention.
export function createDefaultPanelShellRuntime(): PanelShellRuntime {
	const repository = createLocalWorkspaceRepository();
	const clock = { now: () => new Date().toISOString() };
	const ids = createIdSequencer();
	const idempotency = createIdempotencyCache();
	const history = createChangeHistory();
	const revisions = createRevisionService({ repository, clock, ids, idempotency });

	const kinds = createPanelRegistry();
	const sourceRenderer = createSourceRendererRegistry();

	const templates = createLayoutTemplateRegistry();
	registerDefaultLayoutTemplates(templates);

	// T-1010-7: no screener-execution surface is wired into this route yet
	// (registerScreenerTools.ts is gated behind SCREENER_TOOLS_ENABLED=false),
	// so this store starts empty every load -- a results_table panel with no
	// pinned run renders its own "no run" state rather than fabricating one.
	// The same store instance is closed over by both the table renderer
	// contract's validateSelection hook and the panel body's own reads, so
	// they can never disagree about what's pinned.
	const runs = createPinnedRunStore();

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

	registerDefaultPanelKinds(kinds);
	registerDefaultSourceRendererTypes(sourceRenderer);

	seedDefaultWorkspace(deps, init.justCreated);

	return { deps, observer: createPanelWorkspaceObserver() };
}

// Registers the fourteen tools -- each wrapped so a successful call notifies
// the shell's observer, which is how PanelContainer re-renders without a
// reload after any agent-driven mutation (AC5). Returns the runtime so the
// caller (the /workbench route) can hand the same deps/observer to
// PanelContainer.
export async function registerPanelTools(
	runtime: PanelShellRuntime = createDefaultPanelShellRuntime()
): Promise<PanelShellRuntime> {
	const mc = ensureModelContext();
	const tools = wrapToolsWithNotify(buildPanelTools(runtime.deps), runtime.observer);
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
