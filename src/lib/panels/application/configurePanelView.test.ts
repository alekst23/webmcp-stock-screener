import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { configurePanelView } from './configurePanelView';

function ctx() {
	return { actor: 'agent' as const };
}

describe('configurePanelView', () => {
	it('AC3: retitling changes only the title -- id/kind/config/source/renderer/position untouched', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }
		});
		const before = readPanelState(deps.repository.get(deps.workspaceId)!).panels[0]!;

		configurePanelView(deps, { context: ctx(), panelId: 'panel_alerts_1', title: 'My Alerts' });

		const after = readPanelState(deps.repository.get(deps.workspaceId)!).panels[0]!;
		expect(after.title).toBe('My Alerts');
		expect(after.rect).toEqual(before.rect);
		expect(after.config).toEqual(before.config);
		expect(after.kind).toBe(before.kind);
	});

	it('AC3: hiding keeps position/config intact but not rendered; showing restores it in place', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }
		});

		configurePanelView(deps, { context: ctx(), panelId: 'panel_alerts_1', hidden: true });
		let panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels[0]!;
		expect(panel.hidden).toBe(true);
		expect(panel.rect).toEqual({ col: 0, row: 0, colSpan: 2, rowSpan: 1 });

		configurePanelView(deps, { context: ctx(), panelId: 'panel_alerts_1', hidden: false });
		panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels[0]!;
		expect(panel.hidden).toBe(false);
		expect(panel.rect, 'showing again must restore the exact same position').toEqual({
			col: 0,
			row: 0,
			colSpan: 2,
			rowSpan: 1
		});
	});

	it('AC3: collapsing retains the stored size, and expanding restores it', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }
		});

		configurePanelView(deps, { context: ctx(), panelId: 'panel_alerts_1', collapsed: true });
		let panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels[0]!;
		expect(panel.collapsed).toBe(true);
		expect(panel.rect).toEqual({ col: 0, row: 0, colSpan: 2, rowSpan: 1 });

		configurePanelView(deps, { context: ctx(), panelId: 'panel_alerts_1', collapsed: false });
		panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels[0]!;
		expect(panel.collapsed).toBe(false);
	});

	it("AC3: view configuration is validated against the panel's active renderer contract", () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' }); // chart_grid renderer

		configurePanelView(deps, { context: ctx(), panelId: 'panel_chart_1', config: { rows: 3 } });
		const panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels[0]!;
		expect(panel.config).toEqual({ rows: 3 });

		expect(() =>
			configurePanelView(deps, {
				context: ctx(),
				panelId: 'panel_chart_1',
				config: { rows: 'nope' }
			})
		).toThrow(PanelOperationError);
	});

	it('AC3: an unknown panel id fails and says the id is unknown', () => {
		const deps = createPanelTestHarness();
		expect(() =>
			configurePanelView(deps, { context: ctx(), panelId: 'panel_x_99', title: 'x' })
		).toThrow(PanelOperationError);
	});

	it('AC3: a panel with no active renderer rejects a config change', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'watchlist' }); // defaultRenderer null

		expect(() =>
			configurePanelView(deps, {
				context: ctx(),
				panelId: 'panel_watchlist_1',
				config: { sortBy: 'symbol' }
			})
		).toThrow(PanelOperationError);
	});
});
