import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { removePanel } from './removePanel';
import { linkPanels } from './linkPanels';

function ctx() {
	return { actor: 'agent' as const };
}

function seedTwoLinkedCharts(deps: ReturnType<typeof createPanelTestHarness>) {
	createPanel(deps, {
		context: ctx(),
		kind: 'chart',
		rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
	});
	createPanel(deps, {
		context: ctx(),
		kind: 'chart',
		rect: { col: 2, row: 0, colSpan: 2, rowSpan: 2 }
	});
	linkPanels(deps, {
		context: ctx(),
		channel: 'symbol',
		panelIds: ['panel_chart_1', 'panel_chart_2']
	});
}

describe('removePanel', () => {
	it('AC9: deletes the panel and frees its cells for a subsequent placement', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }
		});

		const envelope = removePanel(deps, { context: ctx(), panelId: 'panel_alerts_1' });
		expect(envelope.affectedIds).toEqual(['panel_alerts_1']);
		expect(readPanelState(deps.repository.get(deps.workspaceId)!).panels).toEqual([]);

		// the freed cell can be reused
		const reused = createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }
		});
		expect(reused.affectedIds).toEqual(['panel_alerts_2']);
	});

	it('AC9/AC11: removal drops the panel from its link group and names the affected remaining member; a two-member group dissolves', () => {
		const deps = createPanelTestHarness();
		seedTwoLinkedCharts(deps);

		const envelope = removePanel(deps, { context: ctx(), panelId: 'panel_chart_1' });
		expect(
			envelope.affectedIds.sort(),
			`expected both panels named as affected, got ${JSON.stringify(envelope.affectedIds)}`
		).toEqual(['panel_chart_1', 'panel_chart_2']);

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.links.groups.length, 'a group left with one member must dissolve').toBe(0);
	});

	it('AC9: an unknown panel id fails, changes nothing, and says the id is unknown', () => {
		const deps = createPanelTestHarness();
		try {
			removePanel(deps, { context: ctx(), panelId: 'panel_chart_99' });
			expect.fail('expected an unknown_panel error');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			expect((err as PanelOperationError).code).toBe('unknown_panel');
		}
		expect(deps.repository.get(deps.workspaceId)).toBeNull();
	});

	it("AC14: undo restores the removed panel's id, kind, config, footprint, source, renderer and link memberships", () => {
		const deps = createPanelTestHarness();
		seedTwoLinkedCharts(deps);
		deps.repository.get(deps.workspaceId); // sanity: workspace exists before removal

		const beforeState = readPanelState(deps.repository.get(deps.workspaceId)!);
		const beforePanel = beforeState.panels.find((p) => p.id === 'panel_chart_1')!;

		const envelope = removePanel(deps, { context: ctx(), panelId: 'panel_chart_1' });
		const record = deps.history.findByUndoToken(envelope.undoToken!);
		const restoredDoc = record!.inverseDraft!.document;
		const restoredState = readPanelState(restoredDoc);

		const restoredPanel = restoredState.panels.find((p) => p.id === 'panel_chart_1');
		expect(restoredPanel, 'undo must bring the panel back with its original id').toEqual(
			beforePanel
		);
		expect(restoredState.links, 'undo must restore the original link graph').toEqual(
			beforeState.links
		);
	});
});
