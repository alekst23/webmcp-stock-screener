import { describe, expect, it } from 'vitest';
import type { PanelLinkChannel } from './channels';
import {
	emptyLinkGraph,
	groupForPanelOnChannel,
	groupsForPanel,
	linkPanels,
	propagationTargets,
	removePanelFromGraph,
	unlinkPanel,
	type LinkContext,
	type LinkResult,
	type PanelLinkGraph
} from './links';

function counter(prefix = 'link'): () => string {
	let n = 0;
	return () => `${prefix}_${++n}`;
}

function makeContext(
	channelsByPanel: Record<string, PanelLinkChannel[]>,
	kindByPanel: Record<string, string> = {},
	nextGroupId: () => string = counter()
): LinkContext {
	const kinds: Record<string, string> = { ...kindByPanel };
	for (const panelId of Object.keys(channelsByPanel)) {
		if (!(panelId in kinds)) {
			kinds[panelId] = 'chart';
		}
	}
	return { channelsByPanel, kindByPanel: kinds, nextGroupId };
}

function expectOk(result: LinkResult): asserts result is Extract<LinkResult, { ok: true }> {
	expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
}

function expectFail(result: LinkResult): asserts result is Extract<LinkResult, { ok: false }> {
	expect(result.ok, `expected failure, got ${JSON.stringify(result)}`).toBe(false);
}

// Asserts there is exactly one group and returns it, so callers don't need
// non-null assertions or optional chaining on every group[0] access.
function soleGroup(graph: PanelLinkGraph): PanelLinkGraph['groups'][number] {
	expect(
		graph.groups,
		`expected exactly one group, got ${JSON.stringify(graph.groups)}`
	).toHaveLength(1);
	const [group] = graph.groups;
	if (!group) {
		throw new Error('unreachable: toHaveLength(1) guarantees a first element');
	}
	return group;
}

const ALL_CHANNELS: PanelLinkChannel[] = [
	'symbol',
	'timeframe',
	'result_selection',
	'crosshair',
	'filters'
];

function ctxAllChannels(...panelIds: string[]): LinkContext {
	const channelsByPanel: Record<string, PanelLinkChannel[]> = {};
	for (const id of panelIds) {
		channelsByPanel[id] = ALL_CHANNELS;
	}
	return makeContext(channelsByPanel);
}

describe('emptyLinkGraph', () => {
	it('starts with no groups', () => {
		expect(emptyLinkGraph()).toEqual({ groups: [] });
	});
});

describe('linkPanels — AC1 symmetric join', () => {
	it('joins two panels on a channel into one group reachable from either member', () => {
		const graph = emptyLinkGraph();
		const context = ctxAllChannels('A', 'B');
		const result = linkPanels(graph, 'symbol', ['A', 'B'], context);
		expectOk(result);
		expect(result.changed, 'first link on an empty graph must change something').toBe(true);
		expect(soleGroup(result.graph).panelIds).toEqual(['A', 'B']);
		expect(propagationTargets(result.graph, 'symbol', 'A'), 'A must reach B').toEqual(['B']);
		expect(propagationTargets(result.graph, 'symbol', 'B'), 'B must reach A symmetrically').toEqual(
			['A']
		);
	});
});

describe('linkPanels — AC2 join an existing group', () => {
	it('merges a third panel into the existing group rather than creating a second one', () => {
		const context = ctxAllChannels('A', 'B', 'C');
		const first = linkPanels(emptyLinkGraph(), 'symbol', ['A', 'B'], context);
		expectOk(first);

		const second = linkPanels(first.graph, 'symbol', ['C', 'A'], context);
		expectOk(second);
		expect(soleGroup(second.graph).panelIds).toEqual(['A', 'B', 'C']);
		expect(second.affectedPanelIds.slice().sort()).toEqual(['A', 'B', 'C']);
	});

	it('merges two overlapping pre-existing groups into one with no duplicates', () => {
		const context = ctxAllChannels('A', 'B', 'C', 'D');
		const withAC = linkPanels(emptyLinkGraph(), 'symbol', ['A', 'C'], context);
		expectOk(withAC);
		const withBD = linkPanels(withAC.graph, 'symbol', ['B', 'D'], context);
		expectOk(withBD);

		const merged = linkPanels(withBD.graph, 'symbol', ['A', 'B'], context);
		expectOk(merged);
		expect(soleGroup(merged.graph).panelIds).toEqual(['A', 'B', 'C', 'D']);
	});
});

describe('linkPanels — AC3 channel independence', () => {
	it('keeps groups on different channels from interacting', () => {
		const context = ctxAllChannels('A', 'B', 'C', 'D');
		const symbolLink = linkPanels(emptyLinkGraph(), 'symbol', ['A', 'B'], context);
		expectOk(symbolLink);
		const filtersLink = linkPanels(symbolLink.graph, 'filters', ['C', 'D'], context);
		expectOk(filtersLink);

		expect(
			propagationTargets(filtersLink.graph, 'symbol', 'A'),
			'symbol propagation must not reach the filters group'
		).toEqual(['B']);
		expect(
			propagationTargets(filtersLink.graph, 'filters', 'A'),
			'A is not in any filters group'
		).toEqual([]);
		expect(groupsForPanel(filtersLink.graph, 'A')).toHaveLength(1);
	});
});

describe('linkPanels — AC4 unsupported channel', () => {
	it('rejects naming both the channel and the kind, and creates no link', () => {
		const context = makeContext(
			{ A: ['symbol'], B: ALL_CHANNELS },
			{ A: 'filter_builder', B: 'chart' }
		);
		const graph = emptyLinkGraph();
		const result = linkPanels(graph, 'crosshair', ['A', 'B'], context);
		expectFail(result);
		expect(result.failure.code).toBe('unsupported_channel');
		if (result.failure.code === 'unsupported_channel') {
			expect(result.failure.panelId).toBe('A');
			expect(result.failure.kind).toBe('filter_builder');
			expect(result.failure.channel).toBe('crosshair');
			expect(result.failure.supportedChannels).toEqual(['symbol']);
		}
		expect(graph.groups, 'the original graph must be untouched').toEqual([]);
	});

	it('validates every named panel before creating any link', () => {
		// B is unsupported on the channel but sorts after A; if validation
		// stopped after the first ok panel, this would incorrectly link.
		const context = makeContext({ A: ALL_CHANNELS, B: ['symbol'] }, { A: 'chart', B: 'chart' });
		const result = linkPanels(emptyLinkGraph(), 'crosshair', ['A', 'B'], context);
		expectFail(result);
		expect(result.failure.code).toBe('unsupported_channel');
	});

	it('rejects an unknown panel id', () => {
		const context = ctxAllChannels('A');
		const result = linkPanels(emptyLinkGraph(), 'symbol', ['A', 'ghost'], context);
		expectFail(result);
		expect(result.failure.code).toBe('unknown_panel');
		expect(result.failure.panelId).toBe('ghost');
	});
});

describe('linkPanels — AC5 self-link', () => {
	it('rejects linking a panel to itself and changes nothing', () => {
		const graph = emptyLinkGraph();
		const context = ctxAllChannels('A');
		const result = linkPanels(graph, 'symbol', ['A', 'A'], context);
		expectFail(result);
		expect(result.failure.code).toBe('self_link');
		expect(result.failure.panelId).toBe('A');
		expect(graph.groups).toEqual([]);
	});

	it('rejects a single-element panelIds list as not a link', () => {
		const context = ctxAllChannels('A');
		const result = linkPanels(emptyLinkGraph(), 'symbol', ['A'], context);
		expectFail(result);
		expect(result.failure.code).toBe('self_link');
	});
});

describe('linkPanels — AC6 duplicate link', () => {
	it('re-linking an already-grouped pair succeeds without a duplicate and reports no change', () => {
		const context = ctxAllChannels('A', 'B');
		const first = linkPanels(emptyLinkGraph(), 'symbol', ['A', 'B'], context);
		expectOk(first);

		const second = linkPanels(first.graph, 'symbol', ['A', 'B'], context);
		expectOk(second);
		expect(second.changed).toBe(false);
		expect(second.affectedPanelIds).toEqual([]);
		expect(soleGroup(second.graph).panelIds).toEqual(['A', 'B']);
	});

	it('re-linking a subset of an existing group also reports no change', () => {
		const context = ctxAllChannels('A', 'B', 'C');
		const grouped = linkPanels(emptyLinkGraph(), 'symbol', ['A', 'B', 'C'], context);
		expectOk(grouped);
		const again = linkPanels(grouped.graph, 'symbol', ['B', 'C'], context);
		expectOk(again);
		expect(again.changed).toBe(false);
	});
});

describe('unlinkPanel — AC7 remove a member, keep the rest linked', () => {
	it('keeps the remaining members linked to each other after a three-panel unlink', () => {
		const context = ctxAllChannels('A', 'B', 'C');
		const grouped = linkPanels(emptyLinkGraph(), 'symbol', ['A', 'B', 'C'], context);
		expectOk(grouped);

		const result = unlinkPanel(grouped.graph, 'symbol', 'A');
		expectOk(result);
		expect(result.changed).toBe(true);
		expect(result.affectedPanelIds.slice().sort()).toEqual(['B', 'C']);
		expect(soleGroup(result.graph).panelIds).toEqual(['B', 'C']);
		expect(propagationTargets(result.graph, 'symbol', 'A')).toEqual([]);
	});

	it('dissolves a group left with fewer than two members', () => {
		const context = ctxAllChannels('A', 'B');
		const grouped = linkPanels(emptyLinkGraph(), 'symbol', ['A', 'B'], context);
		expectOk(grouped);

		const result = unlinkPanel(grouped.graph, 'symbol', 'A');
		expectOk(result);
		expect(result.graph.groups, 'a lone remaining member is not a group').toEqual([]);
		expect(result.affectedPanelIds).toEqual(['B']);
		expect(groupForPanelOnChannel(result.graph, 'symbol', 'B')).toBeUndefined();
	});

	it('fails with not_linked when the panel has no group on that channel', () => {
		const result = unlinkPanel(emptyLinkGraph(), 'symbol', 'A');
		expectFail(result);
		expect(result.failure.code).toBe('not_linked');
		expect(result.failure).toMatchObject({ panelId: 'A', channel: 'symbol' });
	});
});

describe('removePanelFromGraph — AC8 drop from every channel', () => {
	it('removes the panel from every channel group it belonged to and names every affected panel', () => {
		const context = ctxAllChannels('A', 'B', 'C', 'D');
		let graph: PanelLinkGraph = emptyLinkGraph();
		graph = ((): PanelLinkGraph => {
			const r = linkPanels(graph, 'symbol', ['A', 'B'], context);
			expectOk(r);
			return r.graph;
		})();
		graph = ((): PanelLinkGraph => {
			const r = linkPanels(graph, 'filters', ['A', 'C', 'D'], context);
			expectOk(r);
			return r.graph;
		})();

		const result = removePanelFromGraph(graph, 'A');
		expectOk(result);
		expect(result.changed).toBe(true);
		// symbol group dissolves (B alone); filters group keeps C and D.
		expect(result.affectedPanelIds.slice().sort()).toEqual(['B', 'C', 'D']);
		expect(groupForPanelOnChannel(result.graph, 'symbol', 'B')).toBeUndefined();
		const filtersGroup = groupForPanelOnChannel(result.graph, 'filters', 'C');
		expect(filtersGroup?.panelIds).toEqual(['C', 'D']);
		expect(groupsForPanel(result.graph, 'A')).toEqual([]);
	});

	it('reports changed: false for a panel that belongs to no group', () => {
		const graph = emptyLinkGraph();
		const result = removePanelFromGraph(graph, 'ghost');
		expectOk(result);
		expect(result.changed).toBe(false);
		expect(result.affectedPanelIds).toEqual([]);
	});
});

describe('propagationTargets — AC9 broadcast set excludes the source', () => {
	it('returns every other group member and never the source', () => {
		const context = ctxAllChannels('A', 'B', 'C');
		const grouped = linkPanels(emptyLinkGraph(), 'result_selection', ['A', 'B', 'C'], context);
		expectOk(grouped);
		const targets = propagationTargets(grouped.graph, 'result_selection', 'B');
		expect(targets.slice().sort()).toEqual(['A', 'C']);
		expect(targets).not.toContain('B');
	});

	it('returns an empty array when the panel is in no group on that channel', () => {
		expect(propagationTargets(emptyLinkGraph(), 'crosshair', 'A')).toEqual([]);
	});
});

describe('immutability', () => {
	it('never mutates the input graph across linkPanels, unlinkPanel, and removePanelFromGraph', () => {
		const context = ctxAllChannels('A', 'B', 'C');
		const base = linkPanels(emptyLinkGraph(), 'symbol', ['A', 'B'], context);
		expectOk(base);
		const snapshot: PanelLinkGraph = JSON.parse(JSON.stringify(base.graph));

		const afterLink = linkPanels(base.graph, 'symbol', ['B', 'C'], context);
		expectOk(afterLink);
		expect(base.graph, 'linkPanels must not mutate its input graph').toEqual(snapshot);

		const afterUnlink = unlinkPanel(base.graph, 'symbol', 'A');
		expectOk(afterUnlink);
		expect(base.graph, 'unlinkPanel must not mutate its input graph').toEqual(snapshot);

		const afterRemove = removePanelFromGraph(base.graph, 'A');
		expectOk(afterRemove);
		expect(base.graph, 'removePanelFromGraph must not mutate its input graph').toEqual(snapshot);
	});
});

describe('groupsForPanel / groupForPanelOnChannel', () => {
	it('lists every group a panel belongs to across channels', () => {
		const context = ctxAllChannels('A', 'B', 'C');
		const symbolLink = linkPanels(emptyLinkGraph(), 'symbol', ['A', 'B'], context);
		expectOk(symbolLink);
		const filtersLink = linkPanels(symbolLink.graph, 'filters', ['A', 'C'], context);
		expectOk(filtersLink);

		const groups = groupsForPanel(filtersLink.graph, 'A');
		expect(groups.map((g) => g.channel).sort()).toEqual(['filters', 'symbol']);
	});

	it('returns undefined when a panel has no group on the named channel', () => {
		expect(groupForPanelOnChannel(emptyLinkGraph(), 'timeframe', 'A')).toBeUndefined();
	});
});
