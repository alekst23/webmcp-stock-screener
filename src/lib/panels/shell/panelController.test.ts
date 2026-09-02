import { describe, expect, it } from 'vitest';
import { createPanelTestHarness } from '../application/testSupport';
import { createPanel, configurePanelView, readPanelState } from '../application';
import { restoreRevision } from '../../workbench/application/changeHistory';
import { emptyLinkGraph, linkPanels, type LinkContext } from '../domain/links';
import {
	createLayoutTemplateRegistry,
	registerDefaultLayoutTemplates
} from '../domain/layoutTemplates';
import { buildPanelTools } from '../tools/panelTools';
import { createMaximizedPanelState } from '../tools/maximizedState';
import {
	createNewWorkspace,
	createPanelWorkspaceObserver,
	initializeWorkspace,
	loadWorkspace,
	propagateLinkedValue,
	readSnapshot,
	resolvePanelBody,
	seedDefaultWorkspace,
	togglePanelCollapsed,
	undoPanelChange,
	wrapToolsWithNotify
} from './panelController';

describe('initializeWorkspace', () => {
	it('creates a fresh workspace when none is active', () => {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness);
		expect(init.justCreated, 'a brand-new workspace must report justCreated').toBe(true);
		expect(harness.repository.getActiveId(), 'expected the new workspace to become active').toBe(
			init.workspaceId
		);
	});

	it('loads the active workspace instead of creating a second one', () => {
		const harness = createPanelTestHarness();
		const first = initializeWorkspace(harness);
		const second = initializeWorkspace(harness);
		expect(second.justCreated, 'reusing the active workspace must not report justCreated').toBe(
			false
		);
		expect(second.workspaceId, 'expected the same workspace id to be reused').toBe(
			first.workspaceId
		);
	});
});

describe('loadWorkspace', () => {
	it('is never a creation event, even for an id that resolves to zero panels', () => {
		const harness = createPanelTestHarness();
		const { workspaceId } = createNewWorkspace(harness, 'Empty');
		const result = loadWorkspace(workspaceId);
		expect(result.justCreated, 'loading by id must never report justCreated').toBe(false);
	});
});

describe('seedDefaultWorkspace', () => {
	it('creates exactly three panels of the right kinds at left/center/right', () => {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness);
		const deps = { ...harness, workspaceId: init.workspaceId };
		seedDefaultWorkspace(deps, init.justCreated);

		const doc = harness.repository.get(init.workspaceId);
		expect(doc, 'expected the workspace document to exist after seeding').not.toBeNull();
		const state = readPanelState(doc!);
		expect(
			state.panels.length,
			`expected exactly 3 seeded panels, got ${JSON.stringify(state.panels)}`
		).toBe(3);

		const byKind = Object.fromEntries(state.panels.map((p) => [p.kind, p]));
		expect(byKind.filter_builder?.rect.col, 'expected filter_builder on the left').toBe(0);
		expect(byKind.results_table?.rect.col, 'expected results_table in the center').toBe(2);
		expect(byKind.chart?.rect.col, 'expected chart on the right').toBe(4);
		expect(
			state.panels.every((p) => p.source === null),
			'expected every seeded panel to start unbound'
		).toBe(true);
	});

	it('does not fire when a workspace is merely loaded, even if it has zero panels', () => {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness); // creates but does not seed
		const loaded = loadWorkspace(init.workspaceId);
		const deps = { ...harness, workspaceId: loaded.workspaceId };
		seedDefaultWorkspace(deps, loaded.justCreated);

		const state = readPanelState(harness.repository.get(init.workspaceId)!);
		expect(
			state.panels.length,
			`expected no seeding on load of an empty workspace, got ${state.panels.length}`
		).toBe(0);
	});

	it('does not fire when restoring a prior revision, even to an empty snapshot', () => {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness); // revision 1, zero panels
		const deps = { ...harness, workspaceId: init.workspaceId };
		createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		expect(readPanelState(harness.repository.get(init.workspaceId)!).panels.length).toBe(1);

		restoreRevision(
			init.workspaceId,
			1,
			{ actor: 'agent' },
			{
				history: harness.history,
				revisionService: harness.revisions,
				clock: harness.clock,
				repository: harness.repository
			}
		);

		// A restore is a load, never a creation -- seeding must not fire even
		// though the restored (revision 1) content has zero panels.
		seedDefaultWorkspace(deps, false);
		const state = readPanelState(harness.repository.get(init.workspaceId)!);
		expect(
			state.panels.length,
			`expected restore to never trigger seeding, got ${state.panels.length}`
		).toBe(0);
	});

	it('does not fire twice across repeated init calls against the same workspace', () => {
		const harness = createPanelTestHarness();
		const first = initializeWorkspace(harness);
		const deps = { ...harness, workspaceId: first.workspaceId };
		seedDefaultWorkspace(deps, first.justCreated);

		const second = initializeWorkspace(harness);
		seedDefaultWorkspace({ ...harness, workspaceId: second.workspaceId }, second.justCreated);

		const state = readPanelState(harness.repository.get(first.workspaceId)!);
		expect(
			state.panels.length,
			`expected seeding to remain at exactly 3 panels after a second init, got ${state.panels.length}`
		).toBe(3);
	});
});

describe('the default layout is not a reachable template', () => {
	it('registers only the four named templates, none of them the default arrangement', () => {
		const registry = createLayoutTemplateRegistry();
		registerDefaultLayoutTemplates(registry);
		const names = registry.names();
		expect(names, `expected exactly the four named templates, got ${names.join(', ')}`).toEqual([
			'three_columns',
			'quad',
			'chart_wall_3x3',
			'focus_with_sidebar'
		]);
		expect(registry.get('default')).toBeUndefined();
		expect(registry.get('seed')).toBeUndefined();
	});
});

describe('readSnapshot', () => {
	function makeDeps() {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness);
		return { ...harness, workspaceId: init.workspaceId };
	}

	it('excludes a hidden panel from rendered rects but keeps its stored position', () => {
		const deps = makeDeps();
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		const panelId = created.affectedIds[0]!;
		configurePanelView(deps, { context: { actor: 'agent' }, panelId, hidden: true });

		const snapshot = readSnapshot(deps, null);
		expect(
			snapshot.rects.some((r) => r.panelId === panelId),
			'expected a hidden panel not to appear among rendered rects'
		).toBe(false);
		const stored = snapshot.state.panels.find((p) => p.id === panelId);
		expect(stored?.rect, 'expected the hidden panel to keep its stored position').toEqual({
			col: 0,
			row: 0,
			colSpan: 2,
			rowSpan: 2
		});
	});

	it('renders a collapsed panel at its full stored size', () => {
		const deps = makeDeps();
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 3, rowSpan: 2 }
		});
		const panelId = created.affectedIds[0]!;
		configurePanelView(deps, { context: { actor: 'agent' }, panelId, collapsed: true });

		const snapshot = readSnapshot(deps, null);
		const rect = snapshot.rects.find((r) => r.panelId === panelId)?.rect;
		expect(rect, 'expected a collapsed panel to still occupy its stored footprint').toEqual({
			col: 0,
			row: 0,
			colSpan: 3,
			rowSpan: 2
		});
		expect(snapshot.state.panels.find((p) => p.id === panelId)?.collapsed).toBe(true);
	});

	it('maximizing leaves stored footprints untouched and un-maximizing restores exactly', () => {
		const deps = makeDeps();
		const a = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		}).affectedIds[0]!;
		const b = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'results_table',
			rect: { col: 2, row: 0, colSpan: 2, rowSpan: 2 }
		}).affectedIds[0]!;

		const before = readSnapshot(deps, null);
		const maximized = readSnapshot(deps, a);
		expect(
			maximized.rects,
			'expected only the maximized panel to render, at the full grid'
		).toEqual([{ panelId: a, rect: { col: 0, row: 0, colSpan: 6, rowSpan: 4 } }]);
		expect(
			maximized.state.panels.find((p) => p.id === a)?.rect,
			'stored rect for a untouched'
		).toEqual({ col: 0, row: 0, colSpan: 2, rowSpan: 2 });
		expect(
			maximized.state.panels.find((p) => p.id === b)?.rect,
			'stored rect for b untouched'
		).toEqual({ col: 2, row: 0, colSpan: 2, rowSpan: 2 });

		const restored = readSnapshot(deps, null);
		expect(
			restored.rects,
			'expected un-maximizing to restore exactly the prior rendered arrangement'
		).toEqual(before.rects);
	});
});

describe('resolvePanelBody', () => {
	it('treats a placeholder marker object as the placeholder body', async () => {
		const result = await resolvePanelBody({
			component: async () => ({ placeholderKind: 'chart' })
		});
		expect(result).toEqual({ kind: 'placeholder' });
	});

	it('recognizes a bare function as a real component', async () => {
		const fn = () => null;
		const result = await resolvePanelBody({ component: async () => fn });
		expect(result).toEqual({ kind: 'component', component: fn });
	});

	it('unwraps a { default: fn } module shape to the underlying component', async () => {
		const fn = () => null;
		const result = await resolvePanelBody({ component: async () => ({ default: fn }) });
		expect(result).toEqual({ kind: 'component', component: fn });
	});

	it('contains a throwing loader rather than letting it propagate', async () => {
		const result = await resolvePanelBody({
			component: async () => {
				throw new Error('boom');
			}
		});
		expect(result, 'expected the throw to be turned into an error result').toEqual({
			kind: 'error',
			message: 'boom'
		});
	});

	it('contains a rejected loader the same way', async () => {
		const result = await resolvePanelBody({ component: () => Promise.reject(new Error('nope')) });
		expect(result).toEqual({ kind: 'error', message: 'nope' });
	});
});

describe('propagateLinkedValue', () => {
	it('reaches exactly the channel group other members, nobody outside it', () => {
		const context: LinkContext = {
			channelsByPanel: {
				a: ['symbol'],
				b: ['symbol'],
				c: ['symbol'],
				d: ['symbol']
			},
			kindByPanel: { a: 'chart', b: 'chart', c: 'chart', d: 'chart' },
			nextGroupId: () => 'link_1'
		};
		const linked = linkPanels(emptyLinkGraph(), 'symbol', ['a', 'b', 'c'], context);
		expect(linked.ok, 'expected linking a/b/c to succeed').toBe(true);
		if (!linked.ok) return;

		const { next, targets } = propagateLinkedValue(linked.graph, 'symbol', 'a', 'AAPL', {});
		expect(
			[...targets].sort(),
			`expected exactly b and c to receive the broadcast, got ${targets.join(', ')}`
		).toEqual(['b', 'c']);
		expect(next.b).toEqual({ channel: 'symbol', value: 'AAPL' });
		expect(next.c).toEqual({ channel: 'symbol', value: 'AAPL' });
		expect(next.a, 'the source panel must not receive its own broadcast').toBeUndefined();
		expect(next.d, 'a panel outside the group must receive nothing').toBeUndefined();
	});

	it('never crosses channels', () => {
		let nextId = 0;
		const context: LinkContext = {
			channelsByPanel: {
				a: ['symbol', 'timeframe'],
				b: ['symbol'],
				c: ['timeframe']
			},
			kindByPanel: { a: 'chart', b: 'chart', c: 'chart' },
			nextGroupId: () => `link_${++nextId}`
		};
		const withSymbol = linkPanels(emptyLinkGraph(), 'symbol', ['a', 'b'], context);
		expect(withSymbol.ok).toBe(true);
		if (!withSymbol.ok) return;
		const withTimeframe = linkPanels(withSymbol.graph, 'timeframe', ['a', 'c'], context);
		expect(withTimeframe.ok).toBe(true);
		if (!withTimeframe.ok) return;

		const { targets } = propagateLinkedValue(withTimeframe.graph, 'symbol', 'a', 'MSFT', {});
		expect(targets, 'expected a symbol-channel broadcast to reach only the symbol group').toEqual([
			'b'
		]);
	});
});

describe('togglePanelCollapsed', () => {
	it('sets collapsed without touching the panel kind or footprint', () => {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness);
		const deps = { ...harness, workspaceId: init.workspaceId };
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		const panelId = created.affectedIds[0]!;

		togglePanelCollapsed(deps, panelId, true);
		const snapshot = readSnapshot(deps, null);
		const panel = snapshot.state.panels.find((p) => p.id === panelId);
		expect(panel?.collapsed).toBe(true);
		expect(panel?.kind).toBe('chart');
		expect(panel?.rect).toEqual({ col: 0, row: 0, colSpan: 2, rowSpan: 2 });
	});
});

describe('undoPanelChange', () => {
	it('restores the rendered workspace to its prior appearance', () => {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness);
		const deps = { ...harness, workspaceId: init.workspaceId };
		const before = readSnapshot(deps, null);

		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		expect(created.undoToken, 'expected create_panel to return an undo token').not.toBeNull();
		expect(readSnapshot(deps, null).rects.length).toBe(1);

		undoPanelChange(deps, created.undoToken!);
		const afterUndo = readSnapshot(deps, null);
		expect(
			afterUndo.rects,
			'expected undo to restore exactly the pre-change rendered arrangement'
		).toEqual(before.rects);
	});
});

describe('wrapToolsWithNotify + panel tool registration', () => {
	function buildRegisteredDeps() {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness);
		return { ...harness, workspaceId: init.workspaceId, maximized: createMaximizedPanelState() };
	}

	it('registers the fourteen panel tools against a fake document.modelContext, reported available', async () => {
		const deps = buildRegisteredDeps();
		const observer = createPanelWorkspaceObserver();
		const tools = wrapToolsWithNotify(buildPanelTools(deps), observer);
		expect(tools.length, `expected fourteen panel tools, got ${tools.length}`).toBe(14);

		const registered = new Map<string, { name: string }>();
		const fakeModelContext = {
			registerTool: async (tool: { name: string }): Promise<void> => {
				registered.set(tool.name, tool);
			},
			getTools: async (): Promise<{ name: string }[]> => [...registered.values()]
		};
		for (const tool of tools) {
			await fakeModelContext.registerTool(tool);
		}
		const available = await fakeModelContext.getTools();
		expect(
			available.length,
			`expected every registered tool to be reported available, got ${available.length}`
		).toBe(14);
		for (const name of [
			'create_panel',
			'duplicate_panel',
			'remove_panel',
			'set_panel_layout',
			'apply_layout_template',
			'split_panel',
			'maximize_panel',
			'bind_panel_source',
			'set_panel_renderer',
			'configure_chart_grid',
			'configure_panel_view',
			'link_panels',
			'unlink_panels',
			'set_panel_selection'
		]) {
			expect(registered.has(name), `expected "${name}" to be registered`).toBe(true);
		}
	});

	it('notifies subscribers exactly once per tool call that mutates the workspace', async () => {
		const deps = buildRegisteredDeps();
		const observer = createPanelWorkspaceObserver();
		const tools = wrapToolsWithNotify(buildPanelTools(deps), observer);
		const createPanelTool = tools.find((t) => t.name === 'create_panel')!;

		let notifications = 0;
		observer.subscribe(() => {
			notifications += 1;
		});
		await createPanelTool.execute({ kind: 'chart' });
		expect(notifications, 'expected exactly one notification for one tool call').toBe(1);
	});
});
