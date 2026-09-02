// AC8: store a panel's selection and propagate the same value to every
// panel linked on the result_selection channel. An empty set clears the
// selection, and the clear propagates like any other change.
import { propagationTargets } from '../domain/links';
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import { commitPanelChange, findPanel, type PanelUseCaseDeps } from './support';

export interface SetPanelSelectionRequest {
	context: MutationContext;
	panelId: string;
	selectedIds: string[];
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
			const targets = propagationTargets(state.links, 'result_selection', panel.id);

			const selections = { ...state.selections, [panel.id]: request.selectedIds };
			for (const targetId of targets) {
				selections[targetId] = request.selectedIds;
			}

			const summary =
				request.selectedIds.length === 0
					? `Cleared selection on panel "${panel.title}".`
					: `Set panel "${panel.title}" selection to ${request.selectedIds.length} result(s).`;
			const propagated =
				targets.length > 0 ? ` Propagated to ${targets.length} linked panel(s).` : '';

			return {
				nextState: { ...state, selections },
				affectedIds: [panel.id, ...targets],
				diffSummary: `${summary}${propagated}`
			};
		}
	);
}
