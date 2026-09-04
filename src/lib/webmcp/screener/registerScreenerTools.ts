// Composition root that wires real infrastructure to buildScreenerTools and
// registers the screener surface against document.modelContext (T-1009-10;
// narrowed to define_screener + run_screener by T-0026-5), mirroring
// workbench/tools/registerWorkbenchTools.ts's createDefault*Deps() + gated
// register-function shape.
//
// Gated behind SCREENER_TOOLS_ENABLED per the project's dead-code policy:
// registering a second tool group alongside the shipping 11-tool surface
// (and whatever sibling epics have already registered under their own
// flags) is new behavior in an existing runtime path, so it stays off, and
// is not called from app startup, until this epic's surface is complete.
//
// T-0020-6: createDefaultScreenerToolDeps below builds against
// registerPanelTools.ts's createWorkbenchSharedInfra() -- the same shared-bag
// constructor registerWorkbenchTools.ts's createDefaultWorkbenchDeps() and
// this route's own composition root (workbenchCompositionRoot.ts) build
// against -- so a standalone call to this module still gets a
// self-consistent, if independent-per-call, bag of instances rather than
// three different constructions of "repository + clock + ids + ...".
import { builtinCatalogRegistry } from '../../catalog/registry';
import { createUnavailableInstrumentDirectory } from '../../discovery/unavailableDirectory';
import {
	createWorkbenchSharedInfra,
	type WorkbenchSharedInfra
} from '../../panels/shell/registerPanelTools';
import { operationRegistry } from '../../workbench/application/operationRegistry';
import { NOT_CONFIGURED_PROVENANCE } from '../../workbench/domain/provenance';
import { ensureModelContext } from '../bridge';
import type { PanelWorkspaceObserver } from '../../panels/shell/panelController';
import { wrapToolsWithNotify } from '../../panels/shell/panelController';
import { buildScreenerTools, type ScreenerToolDeps } from './group';

// T-0020-1: on for real -- /workbench's shared composition root
// (workbench/composition/workbenchCompositionRoot.ts) now wires this
// group's tools to the same repository/revisions/history/idempotency/
// PinnedRunStore every other registered group shares, so a run_screener
// call mutates the same workspace state the panel grid reads.
export const SCREENER_TOOLS_ENABLED = true;

// T-0020-6: built directly against a given shared infra bag -- repository,
// revisions, history, clock, ids, and idempotency are the exact same
// instances every other /workbench tool group's deps object is built
// against -- rather than this module constructing its own independent
// copies. Mirrors registerPanelTools.ts's createPanelShellRuntime(shared) /
// createDefaultPanelShellRuntime() split and
// registerWorkbenchTools.ts's createWorkbenchDeps(shared):
// createDefaultScreenerToolDeps below now delegates here, and
// workbenchCompositionRoot.ts's own buildScreenerDeps calls this directly
// with its shared bag instead of duplicating this field list. Deliberately
// leaves runStore/panelBinding unset -- those are the composition root's
// own cross-group wiring (T-0020-2), not part of this group's own default.
export function createScreenerDeps(shared: WorkbenchSharedInfra): ScreenerToolDeps {
	return {
		repository: shared.repository,
		revisions: shared.revisions,
		history: shared.history,
		registry: operationRegistry,
		provenance: { current: () => NOT_CONFIGURED_PROVENANCE },
		clock: shared.clock,
		ids: shared.ids,
		idempotency: shared.idempotency,
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

// Fresh instances every call -- never a module-global default -- so a
// second mount (or a test) never sees another instance's registrations.
// Kept for this module's own unit tests and any standalone caller;
// /workbench's actual composition (workbenchCompositionRoot.ts, T-0020-1)
// calls createScreenerDeps directly with its own shared bag instead, so
// this group never builds independent instances in that composition.
export function createDefaultScreenerToolDeps(): ScreenerToolDeps {
	return createScreenerDeps(createWorkbenchSharedInfra());
}

// `observer`, when passed, wraps every tool so a successful call notifies
// PanelContainer's shell observer -- the same mechanism registerPanelTools.ts
// applies to the panel/results tools (AC5: "PanelContainer re-renders
// without a reload after any agent-driven mutation"). This group was
// registered via a separate call site from registerPanelTools (T-0026-5),
// which meant define_screener/run_screener mutated the shared repository
// but never notified the observer -- the FilterBuilder panel and any
// results panel silently went stale until an unrelated notify happened to
// fire. workbenchCompositionRoot.ts now passes its shared observer here.
export async function registerScreenerTools(
	deps: ScreenerToolDeps = createDefaultScreenerToolDeps(),
	observer?: PanelWorkspaceObserver
): Promise<void> {
	if (!SCREENER_TOOLS_ENABLED) {
		return;
	}
	const mc = ensureModelContext();
	const built = buildScreenerTools(deps);
	const specs = observer ? wrapToolsWithNotify(built, observer) : built;
	for (const spec of specs) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
}
