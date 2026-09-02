// AC8: store a panel's selection and propagate the same value to every
// panel linked on the result_selection channel. An empty set clears the
// selection, and the clear propagates like any other change.
//
// T-1010-6 (AC6, AC7) added the two renderer hooks used below --
// `validateSelection` and `selectionCapacity`. Before that ticket, this
// function stored and propagated whatever `selectedIds` it was given with no
// per-renderer check at all; both hooks are optional on RendererTypeDefinition
// so a renderer that doesn't define them (every renderer that existed before
// this ticket) behaves exactly as it did before.
import { propagationTargets } from '../domain/links';
import type { Panel } from '../domain/panel';
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import { PanelOperationError } from './errors';
import { commitPanelChange, findPanel, type PanelUseCaseDeps } from './support';

export interface SetPanelSelectionRequest {
	context: MutationContext;
	panelId: string;
	selectedIds: string[];
}

// AC6: rejects with the active renderer's own reasons; a renderer with no
// validateSelection hook accepts anything, as before this ticket.
function checkSelection(deps: PanelUseCaseDeps, panel: Panel, selectedIds: string[]): void {
	if (panel.renderer === null) {
		return;
	}
	const validate = deps.sourceRenderer.getRendererType(panel.renderer)?.validateSelection;
	if (!validate) {
		return;
	}
	const result = validate({ selectedIds, panel, deps });
	if (!result.ok) {
		throw new PanelOperationError(
			'invalid_selection',
			`Selection rejected for panel "${panel.title}".`,
			{ errors: result.errors }
		);
	}
}

// AC7: a linked target whose active renderer declares selectionCapacity
// 'single' only ever receives the primary (first) selected id, with a
// warning naming what did not propagate. Every other target -- including any
// renderer that doesn't declare selectionCapacity at all -- receives the
// full selection unchanged, exactly as before this ticket.
function propagatedSelection(
	deps: PanelUseCaseDeps,
	target: Panel,
	selectedIds: string[]
): { value: string[]; warning: string | null } {
	const capacity = target.renderer
		? deps.sourceRenderer.getRendererType(target.renderer)?.selectionCapacity
		: undefined;
	if (capacity !== 'single' || selectedIds.length <= 1) {
		return { value: selectedIds, warning: null };
	}
	const [primary] = selectedIds;
	return {
		value: primary !== undefined ? [primary] : [],
		warning:
			`Panel "${target.title}" can only show one selected result; showing "${primary}" and ` +
			`not propagating the other ${selectedIds.length - 1}.`
	};
}

export function setPanelSelection(
	deps: PanelUseCaseDeps,
	request: SetPanelSelectionRequest
): MutationEnvelope {
	return commitPanelChange(
		deps,
		request.context,
		'panels.set_panel_selection',
		request,
		(_doc, state) => {
			const panel = findPanel(state, request.panelId);
			checkSelection(deps, panel, request.selectedIds);

			const targets = propagationTargets(state.links, 'result_selection', panel.id);
			const selections = { ...state.selections, [panel.id]: request.selectedIds };
			const warnings: string[] = [];
			for (const targetId of targets) {
				const targetPanel = state.panels.find((p) => p.id === targetId);
				const propagated = targetPanel
					? propagatedSelection(deps, targetPanel, request.selectedIds)
					: { value: request.selectedIds, warning: null };
				selections[targetId] = propagated.value;
				if (propagated.warning) {
					warnings.push(propagated.warning);
				}
			}

			const summary =
				request.selectedIds.length === 0
					? `Cleared selection on panel "${panel.title}".`
					: `Set panel "${panel.title}" selection to ${request.selectedIds.length} result(s).`;
			const propagatedNote =
				targets.length > 0 ? ` Propagated to ${targets.length} linked panel(s).` : '';

			return {
				nextState: { ...state, selections },
				affectedIds: [panel.id, ...targets],
				diffSummary: `${summary}${propagatedNote}`,
				warnings: warnings.length > 0 ? warnings : undefined
			};
		}
	);
}
