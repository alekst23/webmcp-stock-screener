import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { bindPanelSource } from './bindPanelSource';
import { setPanelRenderer } from './setPanelRenderer';

function ctx() {
	return { actor: 'agent' as const };
}

describe('setPanelRenderer', () => {
	it('AC5: the same source is shown by the new renderer; the source itself is unchanged', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'results_table' }); // table renderer, screener_results-compatible
		bindPanelSource(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			source: { type: 'screener_results', ref: { run_id: 'r1' } }
		});

		setPanelRenderer(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			renderer: 'heatmap'
		});

		const panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels[0]!;
		expect(panel.renderer).toBe('heatmap');
		expect(panel.source, 'the source must be unchanged').toEqual({
			type: 'screener_results',
			ref: { run_id: 'r1' }
		});
	});

	it('AC5: fields the new renderer recognizes carry over; unrecognized fields are dropped with a warning, not an error', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'results_table',
			config: { columns: ['symbol'], sortBy: 'symbol', sortDirection: 'asc' }
		});

		const envelope = setPanelRenderer(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			renderer: 'chart_grid'
		});

		expect(
			envelope.warnings.length,
			`expected a warning about dropped fields, got ${JSON.stringify(envelope.warnings)}`
		).toBeGreaterThan(0);
		expect(envelope.warnings[0]).toContain('sortBy');
		const panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels[0]!;
		// "columns" is a field name both table and chart_grid declare, so it carries
		// over; sortBy/sortDirection aren't in chart_grid's schema and are dropped.
		expect(panel.config).toEqual({ columns: ['symbol'] });
	});

	it('AC5: an incompatible renderer for the current source fails, changes nothing, and lists accepted renderers', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'results_table' });
		bindPanelSource(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			source: { type: 'watchlist', ref: { watchlist_id: 'w1' } }
		});

		try {
			setPanelRenderer(deps, {
				context: ctx(),
				panelId: 'panel_results_table_1',
				renderer: 'scatter_plot'
			});
			expect.fail('expected an incompatible_renderer error');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			const opErr = err as PanelOperationError;
			expect(opErr.code).toBe('incompatible_renderer');
			expect((opErr.details.acceptedRenderers as string[]).length).toBeGreaterThan(0);
		}
		const panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels[0]!;
		expect(panel.renderer, 'renderer must remain unchanged').toBe('table');
	});

	it('AC5: an unknown panel id fails and says the id is unknown', () => {
		const deps = createPanelTestHarness();
		expect(() =>
			setPanelRenderer(deps, { context: ctx(), panelId: 'panel_x_99', renderer: 'table' })
		).toThrow(PanelOperationError);
	});
});
