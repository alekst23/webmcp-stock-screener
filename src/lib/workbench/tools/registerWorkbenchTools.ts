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
import {
	createWorkbenchSharedInfra,
	type WorkbenchSharedInfra
} from '../../panels/shell/registerPanelTools';
import { NOT_CONFIGURED_PROVENANCE } from '../domain/provenance';
import { operationRegistry } from '../application/operationRegistry';
import { createPreviewStore } from '../infra/previewStore';
import { buildWorkbenchTools, type WorkbenchDeps } from './index';
import { buildSafetyTools, type SafetyToolDeps } from './safetyTools';

// T-0020-1: on for real -- /workbench's shared composition root
// (workbench/composition/workbenchCompositionRoot.ts) now wires this
// group's tools to the same repository/revisions/history/idempotency every
// other registered group shares, so the sibling epics this flag was
// waiting on are no longer a blocker.
export const WORKBENCH_TOOLS_ENABLED = true;

// WorkbenchDeps already carries every field SafetyDeps needs besides
// `previews` (repository, revisions, history, registry, idempotency, clock,
// ids), so this intersection satisfies both buildWorkbenchTools and
// buildSafetyTools from one shared dependency set, without editing
// WorkbenchDeps itself in tools/index.ts.
export type DefaultWorkbenchDeps = WorkbenchDeps & Pick<SafetyToolDeps, 'previews'>;

// T-0020-6: built directly against a given shared infra bag -- repository,
// revisions, history, clock, ids, and idempotency are the exact same
// instances every other /workbench tool group's deps object is built
// against -- rather than this module constructing its own independent
// copies. Mirrors registerPanelTools.ts's createPanelShellRuntime(shared) /
// createDefaultPanelShellRuntime() split: createDefaultWorkbenchDeps below
// now delegates here, and workbenchCompositionRoot.ts's own
// buildWorkbenchDeps calls this directly with its shared bag instead of
// duplicating this field list.
export function createWorkbenchDeps(shared: WorkbenchSharedInfra): DefaultWorkbenchDeps {
	return {
		repository: shared.repository,
		revisions: shared.revisions,
		history: shared.history,
		registry: operationRegistry,
		provenance: { current: () => NOT_CONFIGURED_PROVENANCE },
		clock: shared.clock,
		ids: shared.ids,
		idempotency: shared.idempotency,
		// Session-scoped, in-memory: previews never outlive the runtime that
		// created them, matching the epic's stated preview-lifetime assumption.
		previews: createPreviewStore({ clock: shared.clock })
	};
}

// Fresh instances every call -- never a module-global default -- so a
// second mount (or a test) never sees another instance's registrations.
// Kept for this module's own unit tests and any standalone caller;
// /workbench's actual composition (workbenchCompositionRoot.ts, T-0020-1)
// calls createWorkbenchDeps directly with its own shared bag instead, so
// this group never builds independent instances in that composition.
export function createDefaultWorkbenchDeps(): DefaultWorkbenchDeps {
	return createWorkbenchDeps(createWorkbenchSharedInfra());
}

export async function registerWorkbenchTools(
	deps: DefaultWorkbenchDeps = createDefaultWorkbenchDeps()
): Promise<void> {
	if (!WORKBENCH_TOOLS_ENABLED) {
		return;
	}
	const mc = ensureModelContext();
	const specs = [...buildWorkbenchTools(deps), ...buildSafetyTools(deps)];
	for (const spec of specs) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
}

// T-0026-5: the MVP's only workbench-core tool (capability H,
// tool-surface-mvp.md #7) is get_canvas_state. Every other tool this
// group's own buildWorkbenchTools builds (get_app_context, create_workspace,
// save_workspace, undo_change, get_change_history,
// restore_workspace_revision) plus both of buildSafetyTools' tools
// (preview_workspace_changes, apply_previewed_changes) are listed as
// "Deliberately absent" in tool-surface-mvp.md -- workspace lifecycle and
// safety aren't exercised by the MVP use case. Registering the whole group
// via registerWorkbenchTools above would register those too, so the
// composition root calls this narrower export instead -- independent of
// WORKBENCH_TOOLS_ENABLED, since get_canvas_state must be live regardless of
// whether the rest of this group ever is.
export async function registerCanvasStateTool(
	deps: DefaultWorkbenchDeps = createDefaultWorkbenchDeps()
): Promise<void> {
	const spec = buildWorkbenchTools(deps).find((s) => s.name === 'get_canvas_state');
	if (!spec) {
		throw new Error('get_canvas_state tool spec not found in buildWorkbenchTools output.');
	}
	const mc = ensureModelContext();
	await mc.registerTool({
		name: spec.name,
		description: spec.description,
		inputSchema: spec.inputSchema,
		execute: spec.execute
	});
}
