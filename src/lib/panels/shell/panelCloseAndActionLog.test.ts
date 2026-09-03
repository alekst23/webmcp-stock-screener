// T-1015-10: restoring the panel-close and action-log UI affordances.
//
// panelController.ts's new helper functions (removePanelByHuman,
// readActionLog) are pure logic and get real unit coverage here against
// createPanelTestHarness(), the same harness panelController.test.ts uses.
// PanelFrame.svelte's and WorkbenchShell.svelte's wiring is proven by
// actually mounting the real components (the same pattern PanelFrame.test.ts
// already established for this directory) rather than describing the wiring
// in prose, so a regression here fails loudly instead of silently.
import { describe, expect, it } from 'vitest';
import { createRawSnippet, mount, unmount, flushSync } from 'svelte';
import { createPanelTestHarness } from '../application/testSupport';
import { createPanel } from '../application';
import { makePanel } from '../domain/panel';
import PanelFrame from './PanelFrame.svelte';
import WorkbenchShell from './WorkbenchShell.svelte';
import {
	initializeWorkspace,
	readActionLog,
	readSnapshot,
	removePanelByHuman
} from './panelController';

function emptyChildrenSnippet() {
	return createRawSnippet(() => ({
		render: () => '<div data-testid="children"></div>'
	}));
}

function mountTarget(): HTMLDivElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	return target;
}

describe('a human can close a panel by hand', () => {
	// spec.md "Route migration / Panel close"; T-1015-10 AC1
	it('PanelFrame exposes a human-clickable close control alongside the collapse control', () => {
		const panel = makePanel({
			id: 'panel_1',
			kind: 'chart',
			title: 'My Panel',
			config: {},
			rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
		});
		const removed: string[] = [];
		const target = mountTarget();
		const instance = mount(PanelFrame, {
			target,
			props: {
				panel,
				rect: panel.rect,
				kindDefinition: undefined,
				onToggleCollapse: () => {},
				onRemove: (panelId: string) => removed.push(panelId),
				onBroadcast: () => false
			}
		});
		flushSync();

		const collapseControl = target.querySelector('.control.collapse');
		expect(
			collapseControl,
			'expected the pre-existing collapse control to still render'
		).not.toBeNull();

		const closeControl = target.querySelector<HTMLButtonElement>('.control.remove');
		expect(closeControl, 'expected a close control alongside the collapse control').not.toBeNull();

		closeControl!.click();
		flushSync();
		expect(
			removed,
			'expected clicking the close control to call onRemove with the panel id'
		).toEqual(['panel_1']);

		unmount(instance);
	});

	it('clicking the close control has the same effect as the agent-side remove-panel action', () => {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness);
		const deps = { ...harness, workspaceId: init.workspaceId };
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		const panelId = created.affectedIds[0]!;
		expect(readSnapshot(deps, null).state.panels.some((p) => p.id === panelId)).toBe(true);

		const envelope = removePanelByHuman(deps, panelId);

		expect(
			readSnapshot(deps, null).state.panels.some((p) => p.id === panelId),
			'expected removePanelByHuman to remove the panel exactly as the agent-side remove_panel tool would'
		).toBe(false);
		expect(envelope.affectedIds, 'expected the removed panel id to be reported affected').toContain(
			panelId
		);
	});
});

describe('action-log entries carry human-vs-agent attribution', () => {
	// spec.md "Route migration / Action log access"; T-1015-10 AC2
	it("every new ChangeRecord has an actor: 'human' | 'agent' field populated", () => {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness);
		const deps = { ...harness, workspaceId: init.workspaceId };
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		const panelId = created.affectedIds[0]!;
		removePanelByHuman(deps, panelId);

		// initializeWorkspace's own create_workspace commit (actor: agent) is
		// the third record here, alongside the panel create and the human close.
		const records = readActionLog(deps);
		expect(records.length, `expected exactly 3 recorded changes, got ${records.length}`).toBe(3);
		// readActionLog (like ChangeHistory.list) returns newest-first.
		expect(records[0]?.actor, 'expected the human-triggered close to record actor "human"').toBe(
			'human'
		);
		expect(
			records[1]?.actor,
			'expected the agent-triggered panel create to record actor "agent"'
		).toBe('agent');
		expect(
			records[2]?.actor,
			'expected the agent-triggered workspace create to record actor "agent"'
		).toBe('agent');
	});

	it('readActionLog respects a limit, mirroring ChangeHistory.list', () => {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness);
		const deps = { ...harness, workspaceId: init.workspaceId };
		createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'results_table',
			rect: { col: 2, row: 0, colSpan: 2, rowSpan: 2 }
		});

		const limited = readActionLog(deps, 1);
		expect(limited.length, `expected readActionLog(deps, 1) to return exactly 1 record`).toBe(1);
	});
});

describe('the shell exposes an expandable action log', () => {
	// spec.md "Route migration / Action log access"; T-1015-10 AC3
	it('a compact header icon expands into a log listing every recorded action with its actor', () => {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness);
		const deps = { ...harness, workspaceId: init.workspaceId };
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		removePanelByHuman(deps, created.affectedIds[0]!);

		const target = mountTarget();
		const instance = mount(WorkbenchShell, {
			target,
			props: {
				panelStatus: null,
				webmcpStatus: null,
				bridgeState: 'connecting',
				historyDeps: deps,
				resetLayoutDeps: null,
				observer: null,
				children: emptyChildrenSnippet()
			}
		});
		flushSync();

		const toggle = target.querySelector<HTMLButtonElement>('.log-toggle');
		expect(toggle, 'expected a compact log-toggle icon in the shell header').not.toBeNull();

		toggle!.click();
		flushSync();

		const log = target.querySelector('.action-log');
		expect(log, 'expected the log view to render once the icon is toggled').not.toBeNull();
		expect(log?.textContent, 'expected the log to show the agent-attributed entry').toContain(
			'Agent'
		);
		expect(log?.textContent, 'expected the log to show the human-attributed entry').toContain(
			'Human'
		);

		unmount(instance);
	});

	it("is not an always-visible section, unlike the legacy page's log", () => {
		const target = mountTarget();
		const instance = mount(WorkbenchShell, {
			target,
			props: {
				panelStatus: null,
				webmcpStatus: null,
				bridgeState: 'connecting',
				historyDeps: null,
				resetLayoutDeps: null,
				observer: null,
				children: emptyChildrenSnippet()
			}
		});
		flushSync();

		expect(
			target.querySelector('.action-log'),
			'expected the log to start collapsed, per the ticket description scoping this down from ' +
				"the legacy page's always-visible ActivityFeed"
		).toBeNull();

		unmount(instance);
	});
});

describe('closing a panel a human did not create works the same way', () => {
	// T-1015-10 AC4
	it('removing an agent-created panel via the close control succeeds identically', () => {
		const harness = createPanelTestHarness();
		const init = initializeWorkspace(harness);
		const deps = { ...harness, workspaceId: init.workspaceId };
		// The panel was created with actor: "agent" -- a human never touched it
		// before closing it.
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		const panelId = created.affectedIds[0]!;

		removePanelByHuman(deps, panelId);

		expect(
			readSnapshot(deps, null).state.panels.some((p) => p.id === panelId),
			'expected an agent-created panel to be removable via the human close path exactly like ' +
				'a human-created one'
		).toBe(false);
	});
});

describe('production build succeeds and both affordances work with no console errors', () => {
	// T-1015-10 AC5 -- verified via browser check at ticket close per project
	// convention, not a vitest assertion; not run as part of the suite.
	it.todo('panel close and the action-log icon both work in a real browser');
});
