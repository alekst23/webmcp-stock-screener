// AC8: validate every named panel's kind against the requested channel
// before creating any link (linkPanels' own all-or-nothing contract),
// then merge them into that channel's group.
import { linkPanels as linkPanelsInGraph } from '../domain/links';
import type { LinkContext } from '../domain/links';
import type { PanelLinkChannel } from '../domain/channels';
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import { commitPanelChange, findPanel, throwLinkFailure, type PanelUseCaseDeps } from './support';
import type { Panel } from '../domain/panel';

export interface LinkPanelsRequest {
	context: MutationContext;
	channel: PanelLinkChannel;
	panelIds: string[];
}

function buildLinkContext(deps: PanelUseCaseDeps, panels: Panel[]): LinkContext {
	const channelsByPanel: Record<string, PanelLinkChannel[]> = {};
	const kindByPanel: Record<string, string> = {};
	for (const panel of panels) {
		kindByPanel[panel.id] = panel.kind;
		channelsByPanel[panel.id] = deps.kinds.get(panel.kind)?.linkChannels ?? [];
	}
	return { channelsByPanel, kindByPanel, nextGroupId: () => deps.ids.next('link') };
}

export function linkPanels(deps: PanelUseCaseDeps, request: LinkPanelsRequest): MutationEnvelope {
	return commitPanelChange(deps, request.context, 'panels.link_panels', request, (_doc, state) => {
		// Fail with a clear "unknown panel" before the domain module's more
		// generic "not known to the link graph" gets a chance to.
		for (const panelId of request.panelIds) {
			findPanel(state, panelId);
		}
		const context = buildLinkContext(deps, state.panels);
		const result = linkPanelsInGraph(state.links, request.channel, request.panelIds, context);
		if (!result.ok) {
			throwLinkFailure(result.failure);
		}

		const summary = result.changed
			? `Linked ${result.affectedPanelIds.length} panel(s) on the "${request.channel}" channel.`
			: `Panels already linked on the "${request.channel}" channel; no change.`;
		return {
			nextState: { ...state, links: result.graph },
			affectedIds: result.affectedPanelIds,
			diffSummary: summary
		};
	});
}
