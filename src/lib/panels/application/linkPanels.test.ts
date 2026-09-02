import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { linkPanels } from './linkPanels';

function ctx() {
	return { actor: 'agent' as const };
}

function seedThreeCharts(deps: ReturnType<typeof createPanelTestHarness>) {
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
}

describe('linkPanels', () => {
	it('AC8: links two panels on a channel they both support', () => {
		const deps = createPanelTestHarness();
		seedThreeCharts(deps);

		const envelope = linkPanels(deps, {
			context: ctx(),
			channel: 'symbol',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});
		expect(envelope.affectedIds.sort()).toEqual(['panel_chart_1', 'panel_chart_2']);

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.links.groups.length).toBe(1);
		expect(state.links.groups[0]!.panelIds.sort()).toEqual(['panel_chart_1', 'panel_chart_2']);
	});

	it('AC8: linking a third panel into an existing group merges all three into one group', () => {
		const deps = createPanelTestHarness();
		seedThreeCharts(deps);
		linkPanels(deps, {
			context: ctx(),
			channel: 'symbol',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});

		linkPanels(deps, {
			context: ctx(),
			channel: 'symbol',
			panelIds: ['panel_chart_2', 'panel_chart_3']
		});

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.links.groups.length, 'expected one merged group').toBe(1);
		expect(state.links.groups[0]!.panelIds.sort()).toEqual([
			'panel_chart_1',
			'panel_chart_2',
			'panel_chart_3'
		]);
	});

	it("AC8: a panel whose kind doesn't declare the channel fails naming the channel and the kind, no link created", () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' });
		createPanel(deps, { context: ctx(), kind: 'filter_builder' }); // only supports 'filters'

		try {
			linkPanels(deps, {
				context: ctx(),
				channel: 'symbol',
				panelIds: ['panel_chart_1', 'panel_filter_builder_1']
			});
			expect.fail('expected an unsupported_channel error');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			expect((err as PanelOperationError).code).toBe('unsupported_channel');
		}
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.links.groups.length, 'no link must have been created').toBe(0);
	});

	it('AC8: linking a panel to itself fails and nothing changes', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' });

		try {
			linkPanels(deps, {
				context: ctx(),
				channel: 'symbol',
				panelIds: ['panel_chart_1', 'panel_chart_1']
			});
			expect.fail('expected a self_link error');
		} catch (err) {
			expect((err as PanelOperationError).code).toBe('self_link');
		}
	});

	it('AC8: linking already-linked panels again succeeds without duplicating, reporting no effective change', () => {
		const deps = createPanelTestHarness();
		seedThreeCharts(deps);
		linkPanels(deps, {
			context: ctx(),
			channel: 'symbol',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});

		const envelope = linkPanels(deps, {
			context: ctx(),
			channel: 'symbol',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});

		expect(envelope.affectedIds, 'no panels newly affected by a no-op link').toEqual([]);
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.links.groups.length, 'must still be exactly one group, not a duplicate').toBe(1);
	});
});
