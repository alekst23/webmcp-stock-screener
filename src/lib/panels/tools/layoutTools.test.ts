import { describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../webmcp/types';
import { DEFAULT_SEED_PANELS } from '../domain/defaultLayout';
import { buildLayoutTools } from './layoutTools';
import { buildLifecycleTools } from './lifecycleTools';
import { createPanelToolTestHarness, resultPayload } from './testSupport';

function tool(tools: ToolSpec[], name: string): ToolSpec {
	const found = tools.find((t) => t.name === name);
	if (!found) {
		throw new Error(`tool "${name}" not found among ${tools.map((t) => t.name).join(', ')}`);
	}
	return found;
}

describe('layoutTools', () => {
	describe('set_panel_layout', () => {
		it('AC4: rect fields are integer grid cells, not a pixel/percentage/viewport unit', () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLayoutTools(deps), 'set_panel_layout');
			const schema = spec.inputSchema as {
				properties: {
					placements: {
						items: { properties: { rect: { properties: Record<string, { type: string }> } } };
					};
				};
			};
			const rectProps = schema.properties.placements.items.properties.rect.properties;
			for (const field of ['col', 'row', 'col_span', 'row_span']) {
				expect(
					rectProps[field]!.type,
					`${field} must be an integer grid cell, not a css unit`
				).toBe('integer');
			}
			expect(JSON.stringify(spec.inputSchema)).toMatch(/6-column by 4-row/);
		});

		it('AC4: accepts a batch of panel ids with grid positions and sizes', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({
				kind: 'chart',
				rect: { col: 0, row: 0, col_span: 2, row_span: 2 }
			});
			const spec = tool(buildLayoutTools(deps), 'set_panel_layout');
			const result = await spec.execute({
				placements: [
					{ panel_id: 'panel_chart_1', rect: { col: 2, row: 1, col_span: 2, row_span: 2 } }
				]
			});
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
		});

		it('AC9: an out-of-bounds placement reports the grid bounds', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({ kind: 'chart' });
			const spec = tool(buildLayoutTools(deps), 'set_panel_layout');
			const result = await spec.execute({
				placements: [
					{ panel_id: 'panel_chart_1', rect: { col: 5, row: 0, col_span: 3, row_span: 1 } }
				]
			});
			expect(result.isError).toBe(true);
			const payload = resultPayload(result) as {
				error: string;
				gridColumns: number;
				gridRows: number;
			};
			expect(payload.error).toBe('out_of_bounds');
			expect(payload.gridColumns).toBe(6);
			expect(payload.gridRows).toBe(4);
		});
	});

	describe('apply_layout_template', () => {
		it('AC3/AC4: schema enumerates registered template names', () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLayoutTools(deps), 'apply_layout_template');
			const schema = spec.inputSchema as { properties: { template_name: { enum: string[] } } };
			expect(schema.properties.template_name.enum).toEqual(deps.templates.names());
		});

		it('AC9: an unknown template fails with the registered templates listed', async () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLayoutTools(deps), 'apply_layout_template');
			const result = await spec.execute({ template_name: 'not_a_template', panel_ids: [] });
			expect(result.isError).toBe(true);
			const payload = resultPayload(result) as { error: string; registeredTemplates: string[] };
			expect(payload.error).toBe('unknown_layout_template');
			expect(payload.registeredTemplates).toEqual(deps.templates.names());
		});
	});

	describe('split_panel', () => {
		it('AC4: accepts a panel id and a horizontal or vertical direction', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({
				kind: 'chart',
				rect: { col: 0, row: 0, col_span: 4, row_span: 4 }
			});
			const spec = tool(buildLayoutTools(deps), 'split_panel');
			const result = await spec.execute({ panel_id: 'panel_chart_1', direction: 'vertical' });
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
			const payload = resultPayload(result) as { affected_ids: string[] };
			expect(payload.affected_ids).toEqual(['panel_chart_1', 'panel_chart_2']);
		});

		it('rejects an invalid direction rather than passing it through', async () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLayoutTools(deps), 'split_panel');
			const result = await spec.execute({ panel_id: 'panel_chart_1', direction: 'diagonal' });
			expect(result.isError).toBe(true);
		});
	});

	describe('maximize_panel', () => {
		it('AC2: description states it consumes no revision and returns no mutation envelope', () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLayoutTools(deps), 'maximize_panel');
			expect(spec.description).toMatch(/no revision/i);
			expect(spec.description).toMatch(/no mutation envelope/i);
		});

		it('AC2: schema carries no expected_revision or idempotency_key field', () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLayoutTools(deps), 'maximize_panel');
			const schema = spec.inputSchema as { properties: Record<string, unknown> };
			expect(schema.properties.expected_revision).toBeUndefined();
			expect(schema.properties.idempotency_key).toBeUndefined();
		});

		it('AC4: maximizing renders only that panel at the full grid, and clearing restores the layout', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({
				kind: 'chart',
				rect: { col: 0, row: 0, col_span: 2, row_span: 2 }
			});
			await tool(lifecycle, 'create_panel').execute({
				kind: 'alerts',
				rect: { col: 2, row: 0, col_span: 1, row_span: 1 }
			});
			const spec = tool(buildLayoutTools(deps), 'maximize_panel');

			const before = resultPayload(await spec.execute({})) as { rendered_rects: unknown[] };
			expect(before.rendered_rects.length).toBe(2);

			const maximized = resultPayload(await spec.execute({ panel_id: 'panel_chart_1' })) as {
				maximized_panel_id: string;
				rendered_rects: { panel_id: string; rect: { col_span: number; row_span: number } }[];
			};
			expect(maximized.maximized_panel_id).toBe('panel_chart_1');
			expect(maximized.rendered_rects).toEqual([
				{ panel_id: 'panel_chart_1', rect: { col: 0, row: 0, col_span: 6, row_span: 4 } }
			]);

			const cleared = resultPayload(await spec.execute({})) as {
				maximized_panel_id: string | null;
				rendered_rects: unknown[];
			};
			expect(cleared.maximized_panel_id).toBeNull();
			expect(cleared.rendered_rects.length, 'restoring must render every visible panel again').toBe(
				2
			);
		});

		it('AC9: maximizing an unknown panel id fails rather than silently no-oping', async () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLayoutTools(deps), 'maximize_panel');
			const result = await spec.execute({ panel_id: 'does_not_exist' });
			expect(result.isError, `expected failure, got ${JSON.stringify(result)}`).toBe(true);
			const payload = resultPayload(result) as { error: string };
			expect(payload.error).toBe('unknown_panel');
		});
	});

	describe('reset_layout', () => {
		// hotfix/panel-system: agent-invokable parity with the header's Reset
		// control -- both call the resetLayout use case (currently a
		// throwing stub; this tool test is red until it's implemented).
		it('is registered among the layout tools', () => {
			const deps = createPanelToolTestHarness();
			expect(() => tool(buildLayoutTools(deps), 'reset_layout')).not.toThrow();
		});

		it('replaces the current panel arrangement with the default seed', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({
				kind: 'chart',
				rect: { col: 0, row: 0, col_span: 6, row_span: 4 }
			});
			const spec = tool(buildLayoutTools(deps), 'reset_layout');

			const result = await spec.execute({});
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
			const payload = resultPayload(result) as { affected_ids: string[] };
			expect(
				payload.affected_ids.length,
				'expected the default seed named as affected'
			).toBe(DEFAULT_SEED_PANELS.length);
		});
	});
});
