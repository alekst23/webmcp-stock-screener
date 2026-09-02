// AC9, AC11: delete the panel, free its cells (it just leaves
// state.panels, so its rect stops being occupied), drop it from every
// channel's link group (dissolving groups left with fewer than two
// members), and drop its stored selection. affectedIds names the removed
// panel plus every panel whose link group actually changed.
import { removePanelFromGraph } from '../domain/links';
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import { commitPanelChange, findPanel, type PanelUseCaseDeps } from './support';

export interface RemovePanelRequest {
	context: MutationContext;
	panelId: string;
}

export function removePanel(deps: PanelUseCaseDeps, request: RemovePanelRequest): MutationEnvelope {
	return commitPanelChange(deps, request.context, 'panels.remove_panel', request, (_doc, state) => {
		const panel = findPanel(state, request.panelId);

		const linkResult = removePanelFromGraph(state.links, request.panelId);
		const graph = linkResult.ok ? linkResult.graph : state.links;
		const affectedByLinks = linkResult.ok ? linkResult.affectedPanelIds : [];

		const { [request.panelId]: _removed, ...selections } = state.selections;

		return {
			nextState: {
				panels: state.panels.filter((p) => p.id !== request.panelId),
				links: graph,
				selections
			},
			affectedIds: [request.panelId, ...affectedByLinks],
			diffSummary: `Removed ${panel.kind} panel "${panel.title}".`
		};
	});
}
