import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { linkPanels } from './linkPanels';
import { setPanelSelection } from './setPanelSelection';

function ctx() {
	return { actor: 'agent' as const };
}

describe('setPanelSelection', () => {
	it('AC8: propagates a selection to every panel in the result_selection group, and to no panel outside it', () => {
		const deps = createPanelTestHarness();
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
		createPanel(deps, {
			context: ctx(),
			kind: 'chart',
			rect: { col: 4, row: 0, colSpan: 2, rowSpan: 2 }
		}); // not linked
		linkPanels(deps, {
			context: ctx(),
			channel: 'result_selection',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});

		const envelope = setPanelSelection(deps, {
			context: ctx(),
			panelId: 'panel_chart_1',
			selectedIds: ['r1', 'r2']
		});
		expect(envelope.affectedIds.sort()).toEqual(['panel_chart_1', 'panel_chart_2']);

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.selections['panel_chart_1']).toEqual(['r1', 'r2']);
		expect(
			state.selections['panel_chart_2'],
			'the linked panel must receive the same selection'
		).toEqual(['r1', 'r2']);
		expect(
			state.selections['panel_chart_3'],
			'the unlinked panel must not receive the selection'
		).toBeUndefined();
	});

	it('AC8: selecting an empty set clears the selection and the clear propagates', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' });
		createPanel(deps, { context: ctx(), kind: 'chart' });
		linkPanels(deps, {
			context: ctx(),
			channel: 'result_selection',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});
		setPanelSelection(deps, { context: ctx(), panelId: 'panel_chart_1', selectedIds: ['r1'] });

		setPanelSelection(deps, { context: ctx(), panelId: 'panel_chart_1', selectedIds: [] });

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.selections['panel_chart_1']).toEqual([]);
		expect(
			state.selections['panel_chart_2'],
			'the clear must propagate like any other change'
		).toEqual([]);
	});

	it('an unknown panel id fails and says the id is unknown', () => {
		const deps = createPanelTestHarness();
		expect(() =>
			setPanelSelection(deps, { context: ctx(), panelId: 'panel_chart_99', selectedIds: [] })
		).toThrow(PanelOperationError);
	});
});
