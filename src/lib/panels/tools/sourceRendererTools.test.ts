import { describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../webmcp/types';
import { buildLifecycleTools } from './lifecycleTools';
import { buildSourceRendererTools } from './sourceRendererTools';
import { createPanelToolTestHarness, resultPayload } from './testSupport';

function tool(tools: ToolSpec[], name: string): ToolSpec {
	const found = tools.find((t) => t.name === name);
	if (!found) {
		throw new Error(`tool "${name}" not found among ${tools.map((t) => t.name).join(', ')}`);
	}
	return found;
}

describe('sourceRendererTools', () => {
	describe('bind_panel_source', () => {
		it('AC6: accepts a source reference and binds it', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({ kind: 'chart' });
			const spec = tool(buildSourceRendererTools(deps), 'bind_panel_source');
			const result = await spec.execute({
				panel_id: 'panel_chart_1',
				source: { type: 'screener_results', ref: { run_id: 'run_1' } }
			});
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
		});

		it('AC3: schema enumerates registered source types', () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildSourceRendererTools(deps), 'bind_panel_source');
			const schema = spec.inputSchema as {
				properties: { source: { properties: { type: { enum: string[] } } } };
			};
			expect(schema.properties.source.properties.type.enum).toEqual(
				deps.sourceRenderer.sourceTypeNames()
			);
		});

		it('AC9: a source type the active renderer does not accept fails with the accepted types listed', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			// results_table defaults to the "table" renderer, whose acceptedSourceTypes omits
			// "panel_reference" (unlike chart_grid, which accepts every registered source type).
			await tool(lifecycle, 'create_panel').execute({ kind: 'results_table' });
			const spec = tool(buildSourceRendererTools(deps), 'bind_panel_source');
			const result = await spec.execute({
				panel_id: 'panel_results_table_1',
				source: { type: 'panel_reference', ref: { panel_id: 'panel_chart_1' } }
			});
			expect(result.isError, `expected failure, got ${JSON.stringify(result)}`).toBe(true);
			const payload = resultPayload(result) as { error: string; acceptedSourceTypes: string[] };
			expect(payload.error).toBe('invalid_source');
			expect(payload.acceptedSourceTypes).toEqual(['screener_results', 'watchlist', 'symbol_list']);
		});
	});

	describe('set_panel_renderer', () => {
		it('AC3: schema enumerates registered renderer types', () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildSourceRendererTools(deps), 'set_panel_renderer');
			const schema = spec.inputSchema as { properties: { renderer: { enum: string[] } } };
			expect(schema.properties.renderer.enum).toEqual(deps.sourceRenderer.rendererTypeNames());
		});

		it('AC9: an unknown renderer fails with the registered renderer types listed', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({ kind: 'chart' });
			const spec = tool(buildSourceRendererTools(deps), 'set_panel_renderer');
			const result = await spec.execute({ panel_id: 'panel_chart_1', renderer: 'not_a_renderer' });
			expect(result.isError).toBe(true);
			const payload = resultPayload(result) as { error: string; registeredTypes: string[] };
			expect(payload.error).toBe('unknown_renderer_type');
			expect(payload.registeredTypes).toEqual(deps.sourceRenderer.rendererTypeNames());
		});

		it('changing renderer preserves recognized fields and warns about dropped ones', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({ kind: 'results_table' });
			const spec = tool(buildSourceRendererTools(deps), 'set_panel_renderer');
			const result = await spec.execute({ panel_id: 'panel_results_table_1', renderer: 'heatmap' });
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
			const payload = resultPayload(result) as { warnings: string[] };
			expect(payload.warnings.length).toBeGreaterThan(0);
		});
	});

	describe('configure_chart_grid', () => {
		it("AC3: schema field names are generated from the chart_grid renderer's own schema", () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildSourceRendererTools(deps), 'configure_chart_grid');
			const schema = spec.inputSchema as { properties: Record<string, unknown> };
			expect(Object.keys(schema.properties)).toEqual(
				expect.arrayContaining([
					'rows',
					'columns',
					'item_count',
					'page',
					'page_size',
					'shared_studies',
					'chart_settings'
				])
			);
		});

		it('AC6: sets rows, columns, item count, pagination, shared studies, and chart settings', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({ kind: 'chart' }); // defaultRenderer: chart_grid
			const spec = tool(buildSourceRendererTools(deps), 'configure_chart_grid');
			const result = await spec.execute({
				panel_id: 'panel_chart_1',
				rows: 2,
				columns: 4,
				item_count: 8,
				page: 1,
				page_size: 8,
				shared_studies: ['sma_20'],
				chart_settings: { theme: 'dark' }
			});
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
		});

		it('AC9: the wrong renderer fails and names the current renderer', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({ kind: 'results_table' }); // renderer: table
			const spec = tool(buildSourceRendererTools(deps), 'configure_chart_grid');
			const result = await spec.execute({ panel_id: 'panel_results_table_1', rows: 2 });
			expect(result.isError).toBe(true);
			const payload = resultPayload(result) as { error: string; currentRenderer: string };
			expect(payload.error).toBe('wrong_renderer');
			expect(payload.currentRenderer).toBe('table');
		});
	});

	describe('configure_panel_view', () => {
		it('AC6: applies only the fields supplied, leaving the rest untouched', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({ kind: 'chart', title: 'Original' });
			const spec = tool(buildSourceRendererTools(deps), 'configure_panel_view');
			const result = await spec.execute({ panel_id: 'panel_chart_1', collapsed: true });
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
			const payload = resultPayload(result) as { diff_summary: string };
			expect(payload.diff_summary).toMatch(/collapsed/);
			expect(payload.diff_summary).not.toMatch(/retitled/);
		});

		it('AC9: invalid view configuration fails with the rejected fields and reasons', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({ kind: 'chart' });
			const spec = tool(buildSourceRendererTools(deps), 'configure_panel_view');
			const result = await spec.execute({
				panel_id: 'panel_chart_1',
				config: { not_a_recognized_field: true }
			});
			expect(result.isError).toBe(true);
			const payload = resultPayload(result) as {
				error: string;
				errors: { field: string; reason: string }[];
			};
			expect(payload.error).toBe('invalid_config');
			expect(payload.errors.length).toBeGreaterThan(0);
		});
	});
});
