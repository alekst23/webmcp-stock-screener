import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { setPanelRenderer } from './setPanelRenderer';
import { bindPanelSource } from './bindPanelSource';

function ctx() {
	return { actor: 'agent' as const };
}

describe('bindPanelSource', () => {
	it('AC4: rebinds to a compatible source, leaving the renderer unchanged', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' }); // chart_grid renderer by default

		const envelope = bindPanelSource(deps, {
			context: ctx(),
			panelId: 'panel_chart_1',
			source: { type: 'screener_results', ref: { run_id: 'run_1' } }
		});
		expect(envelope.affectedIds).toEqual(['panel_chart_1']);

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		const panel = state.panels[0]!;
		expect(panel.source).toEqual({ type: 'screener_results', ref: { run_id: 'run_1' } });
		expect(panel.renderer, 'binding a source must not change the renderer').toBe('chart_grid');
	});

	it('AC4: an incompatible source type is rejected, the panel unchanged, and accepted types listed', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' });
		setPanelRenderer(deps, { context: ctx(), panelId: 'panel_chart_1', renderer: 'scatter_plot' });

		try {
			bindPanelSource(deps, {
				context: ctx(),
				panelId: 'panel_chart_1',
				source: { type: 'watchlist', ref: { watchlist_id: 'w1' } }
			});
			expect.fail('expected an invalid_source error');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			const opErr = err as PanelOperationError;
			expect(opErr.code).toBe('invalid_source');
			expect((opErr.details.acceptedSourceTypes as string[]).sort()).toEqual([
				'screener_results',
				'symbol_list'
			]);
		}
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(
			state.panels[0]!.source,
			'the panel must remain unbound after a rejected bind'
		).toBeNull();
	});

	it('AC4: an unknown panel id fails and says the id is unknown', () => {
		const deps = createPanelTestHarness();
		try {
			bindPanelSource(deps, {
				context: ctx(),
				panelId: 'panel_chart_99',
				source: { type: 'screener_results', ref: { run_id: 'r' } }
			});
			expect.fail('expected an unknown_panel error');
		} catch (err) {
			expect((err as PanelOperationError).code).toBe('unknown_panel');
		}
	});
});
