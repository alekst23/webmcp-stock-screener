import { describe, expect, it } from 'vitest';
import { emptyWorkspace } from '../../workbench/domain/workspace';
import { makePanel } from '../domain/panel';
import { linkPanels, type LinkContext } from '../domain/links';
import { createPanelRegistry, type PanelRegistry } from '../registry/panelKindRegistry';
import { createIdSequencer } from '../../workbench/domain/ids';
import {
	emptyPanelState,
	panelIdSeed,
	readPanelState,
	writePanelState,
	type PanelSystemState
} from './panelState';

// The eight kinds the pre-T-1015-11 PROJECTABLE_KINDS set hardcoded --
// registered here so these tests exercise the same "known kind" behavior
// against a real PanelRegistry instead of a closed set.
function registryWithOriginalEightKinds(): PanelRegistry {
	const registry = createPanelRegistry();
	for (const kind of [
		'filter_builder',
		'chart',
		'study_library',
		'results_table',
		'similar_opportunities',
		'watchlist',
		'alerts',
		'symbol_details'
	]) {
		registry.register({
			kind,
			defaultTitle: kind,
			defaultSize: { colSpan: 1, rowSpan: 1 },
			minSize: { colSpan: 1, rowSpan: 1 },
			defaultConfig: () => ({}),
			validateConfig: () => ({ ok: true, value: {} }),
			configSchema: { type: 'object', properties: {} },
			linkChannels: [],
			bindingTypes: [],
			defaultRenderer: null,
			component: async () => ({})
		});
	}
	return registry;
}

describe('readPanelState', () => {
	it('returns an empty state for a workspace with no panel_system extension', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z');
		const state = readPanelState(doc);
		expect(state, `expected an empty state, got ${JSON.stringify(state)}`).toEqual(
			emptyPanelState()
		);
	});

	it('never throws on malformed extension data, and drops only the bad entries', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z');
		doc.extensions['panel_system'] = {
			panels: [
				{
					id: 'panel_chart_1',
					kind: 'chart',
					title: 'Chart',
					config: {},
					rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
				},
				{ id: 'panel_bad', kind: 'chart' /* missing rect */ },
				'not even an object',
				null
			],
			links: { groups: [{ id: 'link_1', channel: 'symbol', panelIds: ['panel_chart_1'] }] },
			selections: { panel_chart_1: ['r1', 'r2'], bad: 'not-an-array' }
		};

		expect(() => readPanelState(doc)).not.toThrow();
		const state = readPanelState(doc);
		expect(
			state.panels.length,
			`expected only the valid panel to survive, got ${JSON.stringify(state.panels)}`
		).toBe(1);
		expect(state.panels[0]?.id).toBe('panel_chart_1');
		expect(state.links.groups.length).toBe(1);
		expect(state.selections).toEqual({ panel_chart_1: ['r1', 'r2'] });
	});

	it('never throws when the extension itself is garbage', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z');
		doc.extensions['panel_system'] = 'not an object';
		expect(() => readPanelState(doc)).not.toThrow();
		expect(readPanelState(doc)).toEqual(emptyPanelState());
	});

	// Bug fix (see git history): a persisted document written before
	// panelIdSeed existed can hold two panels sharing one id (an unseeded
	// sequencer re-minting an already-used id). PanelContainer.svelte's keyed
	// `{#each ... (occupied.panelId)}` throws Svelte's own fatal
	// each_key_duplicate error on a raw duplicate, so this must be repaired
	// on read rather than left to crash the whole panel grid.
	it('drops a later panel sharing an id an earlier one already used, keeping the first', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z');
		doc.extensions['panel_system'] = {
			panels: [
				{
					id: 'panel_chart_1',
					kind: 'chart',
					title: 'First',
					config: {},
					rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
				},
				{
					id: 'panel_chart_1',
					kind: 'chart',
					title: 'Second (corrupted duplicate)',
					config: {},
					rect: { col: 2, row: 0, colSpan: 2, rowSpan: 2 }
				}
			]
		};

		const state = readPanelState(doc);

		expect(state.panels.length, `expected the duplicate dropped, got ${state.panels.length}`).toBe(
			1
		);
		expect(state.panels[0]?.title, 'the first occurrence must win, not the last').toBe('First');
	});
});

describe('writePanelState', () => {
	it('projects a known-kind panel into doc.panels/doc.layout with visible mapped from hidden', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z');
		const panel = makePanel({
			id: 'panel_chart_1',
			kind: 'chart',
			title: 'Chart',
			config: { symbol: 'AAPL' },
			rect: { col: 1, row: 2, colSpan: 3, rowSpan: 2 },
			hidden: true
		});
		const state: PanelSystemState = { panels: [panel], links: { groups: [] }, selections: {} };

		const next = writePanelState(doc, state, registryWithOriginalEightKinds());

		expect(
			next.panels.length,
			`expected one projected panel, got ${JSON.stringify(next.panels)}`
		).toBe(1);
		expect(next.panels[0]).toMatchObject({ id: 'panel_chart_1', kind: 'chart', visible: false });
		expect(next.layout).toEqual([
			{ panelId: 'panel_chart_1', col: 1, row: 2, width: 3, height: 2 }
		]);
		expect(next.extensions['panel_system']).toEqual(state);
	});

	it('skips a panel whose kind is not registered in the PanelRegistry rather than corrupting the document', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z');
		const panel = makePanel({
			id: 'panel_custom_1',
			kind: 'an_unregistered_kind',
			title: 'Custom',
			config: {},
			rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
		});
		const state: PanelSystemState = { panels: [panel], links: { groups: [] }, selections: {} };

		const next = writePanelState(doc, state, createPanelRegistry());

		expect(
			next.panels,
			'expected the unregistered-kind panel to be skipped from projection'
		).toEqual([]);
		expect(next.layout).toEqual([]);
		// but it survives in the actual source of truth
		expect((next.extensions['panel_system'] as PanelSystemState).panels).toEqual([panel]);
	});

	it('projects result_selection to EPIC-1006\'s "selection" channel name and nothing else does', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z');
		const a = makePanel({
			id: 'panel_chart_1',
			kind: 'chart',
			title: 'A',
			config: {},
			rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
		});
		const b = makePanel({
			id: 'panel_chart_2',
			kind: 'chart',
			title: 'B',
			config: {},
			rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }
		});
		const c = makePanel({
			id: 'panel_chart_3',
			kind: 'chart',
			title: 'C',
			config: {},
			rect: { col: 2, row: 0, colSpan: 1, rowSpan: 1 }
		});
		const context: LinkContext = {
			channelsByPanel: {
				panel_chart_1: ['result_selection', 'symbol'],
				panel_chart_2: ['result_selection', 'symbol'],
				panel_chart_3: ['result_selection']
			},
			kindByPanel: { panel_chart_1: 'chart', panel_chart_2: 'chart', panel_chart_3: 'chart' },
			nextGroupId: () => 'link_1'
		};
		const selectionLink = linkPanels(
			{ groups: [] },
			'result_selection',
			['panel_chart_1', 'panel_chart_2', 'panel_chart_3'],
			context
		);
		const symbolLink = linkPanels(
			selectionLink.ok ? selectionLink.graph : { groups: [] },
			'symbol',
			['panel_chart_1', 'panel_chart_2'],
			{
				...context,
				nextGroupId: () => 'link_2'
			}
		);
		const graph = symbolLink.ok ? symbolLink.graph : { groups: [] };

		const state: PanelSystemState = { panels: [a, b, c], links: graph, selections: {} };
		const next = writePanelState(doc, state, registryWithOriginalEightKinds());

		const channels = new Set<string>(next.links.map((l) => l.channel));
		expect(
			channels.has('selection'),
			`expected a projected 'selection' link, got channels ${[...channels]}`
		).toBe(true);
		expect(
			channels.has('result_selection'),
			'the wire name result_selection must never appear in the projection'
		).toBe(false);
		expect(channels.has('symbol')).toBe(true);
	});
});

describe('panelIdSeed', () => {
	it('is empty when there is no workspace to seed from', () => {
		expect(panelIdSeed(null)).toEqual({});
	});

	it('is empty for a workspace with no panels yet', () => {
		expect(panelIdSeed(emptyWorkspace('workspace_1', 'Fresh', '2026-01-01T00:00:00.000Z'))).toEqual(
			{}
		);
	});

	// The regression this exists to prevent: a workspace document reloaded
	// from storage (or a remount reusing the active document) must not let a
	// fresh, unseeded IdSequencer re-mint an ID that already exists.
	it('reports the highest sequence per kind, keyed the same way ids.next("panel", kind) is called', () => {
		const registry = registryWithOriginalEightKinds();
		const panels = [
			makePanel({
				id: 'panel_chart_1',
				kind: 'chart',
				title: 'Chart',
				config: {},
				rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
			}),
			makePanel({
				id: 'panel_chart_3',
				kind: 'chart',
				title: 'Chart 2',
				config: {},
				rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }
			}),
			makePanel({
				id: 'panel_watchlist_1',
				kind: 'watchlist',
				title: 'Watchlist',
				config: {},
				rect: { col: 2, row: 0, colSpan: 1, rowSpan: 1 }
			})
		];
		const state: PanelSystemState = { panels, links: { groups: [] }, selections: {} };
		const doc = writePanelState(
			emptyWorkspace('workspace_1', 'Research', '2026-01-01T00:00:00.000Z'),
			state,
			registry
		);

		expect(panelIdSeed(doc)).toEqual({ 'panel:chart': 3, 'panel:watchlist': 1 });
	});

	it('never re-mints an ID a reloaded document already holds', () => {
		const registry = registryWithOriginalEightKinds();
		const state: PanelSystemState = {
			panels: [
				makePanel({
					id: 'panel_chart_1',
					kind: 'chart',
					title: 'Chart',
					config: {},
					rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
				})
			],
			links: { groups: [] },
			selections: {}
		};
		const doc = writePanelState(
			emptyWorkspace('workspace_1', 'Research', '2026-01-01T00:00:00.000Z'),
			state,
			registry
		);

		const ids = createIdSequencer(panelIdSeed(doc));
		expect(ids.next('panel', 'chart')).toBe('panel_chart_2');
	});
});
