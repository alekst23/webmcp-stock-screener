import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { setPanelRenderer } from './setPanelRenderer';
import { configureChartGrid } from './configureChartGrid';

function ctx() {
	return { actor: 'agent' as const };
}

describe('configureChartGrid', () => {
	it('AC6: sets rows/columns/itemCount/pagination/sharedStudies/chartSettings for a chart_grid panel', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' }); // chart_grid renderer by default

		configureChartGrid(deps, {
			context: ctx(),
			panelId: 'panel_chart_1',
			rows: 2,
			columns: 4,
			itemCount: 8,
			page: 1,
			pageSize: 8,
			sharedStudies: ['RSI14'],
			chartSettings: { theme: 'dark' }
		});

		const panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels[0]!;
		expect(panel.config).toEqual({
			rows: 2,
			columns: 4,
			itemCount: 8,
			page: 1,
			pageSize: 8,
			sharedStudies: ['RSI14'],
			chartSettings: { theme: 'dark' }
		});
	});

	it('AC6: rejects a panel whose active renderer is not chart_grid', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' });
		setPanelRenderer(deps, { context: ctx(), panelId: 'panel_chart_1', renderer: 'heatmap' });

		try {
			configureChartGrid(deps, { context: ctx(), panelId: 'panel_chart_1', rows: 2 });
			expect.fail('expected a wrong_renderer error');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			expect((err as PanelOperationError).code).toBe('wrong_renderer');
		}
	});

	it('AC6: an invalid field value fails and changes nothing', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' });

		expect(() =>
			configureChartGrid(deps, {
				context: ctx(),
				panelId: 'panel_chart_1',
				rows: 'not-a-number' as unknown as number
			})
		).toThrow(PanelOperationError);
	});
});
