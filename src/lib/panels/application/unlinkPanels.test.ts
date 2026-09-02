import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { linkPanels } from './linkPanels';
import { unlinkPanels } from './unlinkPanels';

function ctx() {
	return { actor: 'agent' as const };
}

describe('unlinkPanels', () => {
	it('AC8: unlinking one panel from a channel leaves the remaining panels linked to each other', () => {
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
		});
		linkPanels(deps, {
			context: ctx(),
			channel: 'symbol',
			panelIds: ['panel_chart_1', 'panel_chart_2', 'panel_chart_3']
		});

		unlinkPanels(deps, { context: ctx(), channel: 'symbol', panelIds: ['panel_chart_1'] });

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.links.groups.length).toBe(1);
		expect(state.links.groups[0]!.panelIds.sort()).toEqual(['panel_chart_2', 'panel_chart_3']);
	});

	it('AC8: independent channels are unaffected -- unlinking on one channel leaves another channel untouched', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' });
		createPanel(deps, { context: ctx(), kind: 'chart' });
		linkPanels(deps, {
			context: ctx(),
			channel: 'symbol',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});
		linkPanels(deps, {
			context: ctx(),
			channel: 'timeframe',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});

		unlinkPanels(deps, { context: ctx(), channel: 'symbol', panelIds: ['panel_chart_1'] });

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		const timeframeGroup = state.links.groups.find((g) => g.channel === 'timeframe');
		expect(timeframeGroup?.panelIds.sort(), 'the timeframe channel must be untouched').toEqual([
			'panel_chart_1',
			'panel_chart_2'
		]);
	});

	it('a panel not linked on the named channel fails, and the batch applies nothing', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' });
		createPanel(deps, { context: ctx(), kind: 'chart' });
		linkPanels(deps, {
			context: ctx(),
			channel: 'symbol',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});

		try {
			unlinkPanels(deps, {
				context: ctx(),
				channel: 'symbol',
				panelIds: ['panel_chart_1', 'panel_chart_99']
			});
			expect.fail('expected a not_linked error');
		} catch (err) {
			expect((err as PanelOperationError).code).toBe('not_linked');
		}
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(
			state.links.groups[0]!.panelIds.sort(),
			'the whole batch must have applied nothing'
		).toEqual(['panel_chart_1', 'panel_chart_2']);
	});
});
