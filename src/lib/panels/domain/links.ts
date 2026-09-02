// Per-channel undirected link groups between panels. A group is a set of
// panel IDs sharing one channel's current value; propagation on one channel
// never touches another channel's groups. A panel's supported channels and
// kind are passed in as data (LinkContext) rather than looked up in the
// panel-kind registry, so this module has no dependency on it.

import type { PanelLinkChannel } from './channels';

export interface PanelLinkGroup {
	id: string;
	channel: PanelLinkChannel;
	panelIds: string[];
}

export interface PanelLinkGraph {
	groups: PanelLinkGroup[];
}

export function emptyLinkGraph(): PanelLinkGraph {
	return { groups: [] };
}

export type LinkFailure =
	| { code: 'self_link'; message: string; panelId: string }
	| { code: 'unknown_panel'; message: string; panelId: string }
	| {
			code: 'unsupported_channel';
			message: string;
			panelId: string;
			kind: string;
			channel: PanelLinkChannel;
			supportedChannels: PanelLinkChannel[];
	  }
	| { code: 'not_linked'; message: string; panelId: string; channel: PanelLinkChannel };

export type LinkResult =
	| { ok: true; graph: PanelLinkGraph; affectedPanelIds: string[]; changed: boolean }
	| { ok: false; failure: LinkFailure };

export interface LinkContext {
	channelsByPanel: Record<string, PanelLinkChannel[]>;
	kindByPanel: Record<string, string>;
	nextGroupId(): string;
}

function sortedUnique(ids: string[]): string[] {
	return [...new Set(ids)].sort();
}

function cloneGraph(graph: PanelLinkGraph): PanelLinkGraph {
	return { groups: [...graph.groups] };
}

function ok(graph: PanelLinkGraph, affectedPanelIds: string[], changed: boolean): LinkResult {
	return { ok: true, graph, affectedPanelIds, changed };
}

function fail(failure: LinkFailure): LinkResult {
	return { ok: false, failure };
}

// Fewer than two distinct panels after dedup covers both `['A', 'A']` and a
// single-element `['A']` — neither is a link.
function selfLinkFailure(panelIds: string[], distinct: string[]): LinkFailure {
	const lone = distinct[0];
	if (lone === undefined) {
		return {
			code: 'self_link',
			message: 'Linking requires at least two distinct panels.',
			panelId: panelIds[0] ?? ''
		};
	}
	return {
		code: 'self_link',
		message: `Cannot link panel "${lone}" to itself.`,
		panelId: lone
	};
}

function validatePanel(
	panelId: string,
	channel: PanelLinkChannel,
	context: LinkContext
): LinkFailure | null {
	const kind = context.kindByPanel[panelId];
	const channels = context.channelsByPanel[panelId];
	if (kind === undefined || channels === undefined) {
		return {
			code: 'unknown_panel',
			message: `Panel "${panelId}" is not known to the link graph.`,
			panelId
		};
	}
	if (!channels.includes(channel)) {
		const supported = channels.length > 0 ? channels.join(', ') : 'no channels';
		return {
			code: 'unsupported_channel',
			message: `Panel "${panelId}" (kind "${kind}") does not support the "${channel}" channel; it supports: ${supported}.`,
			panelId,
			kind,
			channel,
			supportedChannels: channels
		};
	}
	return null;
}

// Merges every named panel's existing group on this channel into one group.
// Validates every panel before creating any link — all-or-nothing.
export function linkPanels(
	graph: PanelLinkGraph,
	channel: PanelLinkChannel,
	panelIds: string[],
	context: LinkContext
): LinkResult {
	const distinct = sortedUnique(panelIds);
	if (distinct.length < 2) {
		return fail(selfLinkFailure(panelIds, distinct));
	}
	for (const panelId of distinct) {
		const failure = validatePanel(panelId, channel, context);
		if (failure) {
			return fail(failure);
		}
	}

	const overlapping = graph.groups.filter(
		(group) => group.channel === channel && group.panelIds.some((id) => distinct.includes(id))
	);
	const only = overlapping.length === 1 ? overlapping[0] : undefined;
	const members = sortedUnique(distinct.concat(...overlapping.map((group) => group.panelIds)));

	// Exactly one pre-existing group already contains every named panel:
	// nothing new to merge in.
	if (only !== undefined && only.panelIds.length === members.length) {
		return ok(cloneGraph(graph), [], false);
	}

	// Extending the one group being touched keeps its identity; colliding
	// two-or-more groups (or forming a brand new one) mints a fresh id, since
	// that group's members did not previously belong to one shared group.
	const groupId = only !== undefined ? only.id : context.nextGroupId();
	const mergedGroup: PanelLinkGroup = { id: groupId, channel, panelIds: members };
	const untouched = graph.groups.filter((group) => !overlapping.includes(group));
	return ok({ groups: [...untouched, mergedGroup] }, members, true);
}

// Removes one panel from one channel's group; dissolves a group left with
// fewer than two members.
export function unlinkPanel(
	graph: PanelLinkGraph,
	channel: PanelLinkChannel,
	panelId: string
): LinkResult {
	const group = graph.groups.find(
		(candidate) => candidate.channel === channel && candidate.panelIds.includes(panelId)
	);
	if (!group) {
		return fail({
			code: 'not_linked',
			message: `Panel "${panelId}" is not linked on the "${channel}" channel.`,
			panelId,
			channel
		});
	}

	const remaining = group.panelIds.filter((id) => id !== panelId);
	const rest = graph.groups.filter((candidate) => candidate !== group);
	if (remaining.length < 2) {
		return ok({ groups: rest }, remaining, true);
	}
	return ok({ groups: [...rest, { ...group, panelIds: remaining }] }, remaining, true);
}

// Every-channel cleanup for remove_panel. Reports changed: false when the
// panel belonged to no group on any channel — a normal outcome for a
// blanket cleanup call, not an error.
export function removePanelFromGraph(graph: PanelLinkGraph, panelId: string): LinkResult {
	const affected = new Set<string>();
	let changed = false;
	const groups: PanelLinkGroup[] = [];

	for (const group of graph.groups) {
		if (!group.panelIds.includes(panelId)) {
			groups.push(group);
			continue;
		}
		changed = true;
		const remaining = group.panelIds.filter((id) => id !== panelId);
		remaining.forEach((id) => affected.add(id));
		if (remaining.length >= 2) {
			groups.push({ ...group, panelIds: remaining });
		}
	}

	if (!changed) {
		return ok(cloneGraph(graph), [], false);
	}
	return ok({ groups }, sortedUnique([...affected]), true);
}

// Who receives a broadcast on this channel from this source. Excludes the
// source; empty when the panel is in no group on that channel.
export function propagationTargets(
	graph: PanelLinkGraph,
	channel: PanelLinkChannel,
	sourcePanelId: string
): string[] {
	const group = graph.groups.find(
		(candidate) => candidate.channel === channel && candidate.panelIds.includes(sourcePanelId)
	);
	if (!group) {
		return [];
	}
	return group.panelIds.filter((id) => id !== sourcePanelId);
}

export function groupsForPanel(graph: PanelLinkGraph, panelId: string): PanelLinkGroup[] {
	return graph.groups.filter((group) => group.panelIds.includes(panelId));
}

export function groupForPanelOnChannel(
	graph: PanelLinkGraph,
	channel: PanelLinkChannel,
	panelId: string
): PanelLinkGroup | undefined {
	return graph.groups.find(
		(group) => group.channel === channel && group.panelIds.includes(panelId)
	);
}
