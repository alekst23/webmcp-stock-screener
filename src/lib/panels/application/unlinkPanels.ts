// AC8, AC11: leave one channel's group, affecting only that channel.
// Named plural (a batch of panels) -- each removal is folded over a local
// copy of the graph so one unknown membership fails the whole batch
// before anything is written back to state.
import { unlinkPanel } from '../domain/links';
import type { PanelLinkGraph } from '../domain/links';
import type { PanelLinkChannel } from '../domain/channels';
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import { commitPanelChange, throwLinkFailure, type PanelUseCaseDeps } from './support';

export interface UnlinkPanelsRequest {
	context: MutationContext;
	channel: PanelLinkChannel;
	panelIds: string[];
}

function unlinkAll(graph: PanelLinkGraph, channel: PanelLinkChannel, panelIds: string[]) {
	let current = graph;
	const affected = new Set<string>();
	for (const panelId of panelIds) {
		const result = unlinkPanel(current, channel, panelId);
		if (!result.ok) {
			throwLinkFailure(result.failure);
		}
		current = result.graph;
		result.affectedPanelIds.forEach((id) => affected.add(id));
	}
	return { graph: current, affected: [...affected] };
}

export function unlinkPanels(
	deps: PanelUseCaseDeps,
	request: UnlinkPanelsRequest
): MutationEnvelope {
	return commitPanelChange(
		deps,
		request.context,
		'panels.unlink_panels',
		request,
		(_doc, state) => {
			const { graph, affected } = unlinkAll(state.links, request.channel, request.panelIds);

			return {
				nextState: { ...state, links: graph },
				affectedIds: [...new Set([...request.panelIds, ...affected])],
				diffSummary: `Unlinked ${request.panelIds.length} panel(s) from the "${request.channel}" channel.`
			};
		}
	);
}
