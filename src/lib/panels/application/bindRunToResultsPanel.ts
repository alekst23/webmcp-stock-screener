// AC1/AC3/AC4/AC5 (T-0020-2/T-0020-10/T-0020-11): binds the workspace's
// results_table panel (creating one first if none exists) to a
// just-completed screener run, via the exact same createPanel/
// bindPanelSource application use cases every other panel mutation in this
// directory uses -- so replacing a prior binding, and recording the change
// through RevisionService/change-history, both come for free.
//
// This used to live in webmcp/screener/runScreener.ts, but it takes only
// typed panel/workspace arguments and has zero JSON/wire concerns -- pure
// application-layer orchestration, not a tool-layer responsibility -- so it
// belongs alongside createPanel/bindPanelSource here. Both run_screener's
// tool handler and panelController.ts's human-triggered run
// (runScreenerByHuman) import it from this one place symmetrically.
//
// Best-effort by design (see both call sites): any failure here (a rejected
// source, a workspace that vanished between the run and this call) is the
// caller's job to swallow, never surfacing as a run failure in its own
// right.
import { createPanel } from './createPanel';
import { bindPanelSource } from './bindPanelSource';
import { readPanelState, type PanelSystemState } from './panelState';
import { resolveAutoRect, visibleOccupied } from './support';
import type { PanelUseCaseDeps } from './support';
import type { LayoutTemplateRegistry } from '../domain/layoutTemplates';
import type { PanelRegistry } from '../registry/panelKindRegistry';
import type { SourceRendererRegistry } from '../registry/sourceRendererRegistry';
import type { Actor } from '../../workbench/domain/mutation';

// The three panel-only registries PanelUseCaseDeps needs besides the five
// fields BindRunToResultsPanelDeps already carries (repository/revisions/
// history/clock/ids) -- injected so this module never builds its own
// registry instances, only reuses whichever ones the shared composition
// root already built.
export interface PanelBindingDeps {
	kinds: PanelRegistry;
	sourceRenderer: SourceRendererRegistry;
	templates: LayoutTemplateRegistry;
}

// The subset of PanelUseCaseDeps this function actually reads -- narrowed
// so a caller (run_screener.ts's WorkbenchDeps, panelController.ts's
// RunScreenerByHumanDeps.useCaseDeps) never has to construct a full
// PanelUseCaseDeps just to call this.
export type BindRunToResultsPanelDeps = Pick<
	PanelUseCaseDeps,
	'repository' | 'revisions' | 'history' | 'clock' | 'ids'
>;

// T-0020-10's create-if-absent step, split out so bindRunToResultsPanel
// itself stays a short read-then-delegate. Sized 2x1 (narrower than the
// results_table kind's own 4x2 defaultSize) and auto-placed by
// resolveAutoRect, the same placement helper createPanel itself falls back
// to when no explicit rect is given -- no new placement logic.
function findOrCreateResultsPanelId(
	panelDeps: PanelUseCaseDeps,
	state: PanelSystemState,
	actor: Actor
): string | null {
	const existing = state.panels.find((p) => p.kind === 'results_table');
	if (existing) {
		return existing.id;
	}
	const rect = resolveAutoRect({ colSpan: 2, rowSpan: 1 }, visibleOccupied(state.panels));
	const created = createPanel(panelDeps, {
		context: { actor },
		kind: 'results_table',
		rect
	});
	const [newPanelId] = created.affectedIds;
	return newPanelId ?? null;
}

// T-0020-11: `actor` is threaded through (not hardcoded 'agent') so a
// human-triggered run (panelController.ts's runScreenerByHuman) can record
// the resulting create/bind as actor: 'human' in the action log, the same
// way every other human-vs-agent mutation in this codebase is distinguished
// -- run_screener.ts's own tool-call path still always passes 'agent', so
// its behavior is unchanged by this move.
export function bindRunToResultsPanel(
	deps: BindRunToResultsPanelDeps,
	panelBinding: PanelBindingDeps,
	workspaceId: string,
	runId: string,
	actor: Actor
): void {
	const doc = deps.repository.get(workspaceId);
	if (!doc) {
		return;
	}
	const panelDeps: PanelUseCaseDeps = {
		workspaceId,
		repository: deps.repository,
		revisions: deps.revisions,
		history: deps.history,
		clock: deps.clock,
		ids: deps.ids,
		kinds: panelBinding.kinds,
		sourceRenderer: panelBinding.sourceRenderer,
		templates: panelBinding.templates
	};
	const state = readPanelState(doc);
	const targetId = findOrCreateResultsPanelId(panelDeps, state, actor);
	if (!targetId) {
		return;
	}
	bindPanelSource(panelDeps, {
		context: { actor },
		panelId: targetId,
		source: { type: 'screener_results', ref: { run_id: runId } }
	});
}
