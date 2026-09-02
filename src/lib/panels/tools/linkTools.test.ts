import { describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../webmcp/types';
import { buildLifecycleTools } from './lifecycleTools';
import { buildLinkTools } from './linkTools';
import { createPanelToolTestHarness, resultPayload } from './testSupport';

function tool(tools: ToolSpec[], name: string): ToolSpec {
	const found = tools.find((t) => t.name === name);
	if (!found) {
		throw new Error(`tool "${name}" not found among ${tools.map((t) => t.name).join(', ')}`);
	}
	return found;
}

async function createTwoCharts(deps: ReturnType<typeof createPanelToolTestHarness>) {
	const lifecycle = buildLifecycleTools(deps);
	await tool(lifecycle, 'create_panel').execute({
		kind: 'chart',
		rect: { col: 0, row: 0, col_span: 2, row_span: 2 }
	});
	await tool(lifecycle, 'create_panel').execute({
		kind: 'chart',
		rect: { col: 2, row: 0, col_span: 2, row_span: 2 }
	});
}

describe('linkTools', () => {
	describe('link_panels', () => {
		it('AC5: accepts a channel and the panel ids to join', async () => {
			const deps = createPanelToolTestHarness();
			await createTwoCharts(deps);
			const spec = tool(buildLinkTools(deps), 'link_panels');
			const result = await spec.execute({
				channel: 'symbol',
				panel_ids: ['panel_chart_1', 'panel_chart_2']
			});
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
			const payload = resultPayload(result) as { affected_ids: string[] };
			expect(payload.affected_ids.sort()).toEqual(['panel_chart_1', 'panel_chart_2']);
		});

		it("AC9: an unsupported channel fails with the kind's supported channels listed", async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({
				kind: 'alerts',
				rect: { col: 0, row: 0, col_span: 1, row_span: 1 }
			});
			await tool(lifecycle, 'create_panel').execute({
				kind: 'alerts',
				rect: { col: 1, row: 0, col_span: 1, row_span: 1 }
			});
			const spec = tool(buildLinkTools(deps), 'link_panels');
			// alerts declares only the "symbol" channel.
			const result = await spec.execute({
				channel: 'crosshair',
				panel_ids: ['panel_alerts_1', 'panel_alerts_2']
			});
			expect(result.isError).toBe(true);
			const payload = resultPayload(result) as { error: string; supportedChannels: string[] };
			expect(payload.error).toBe('unsupported_channel');
			expect(payload.supportedChannels).toEqual(['symbol']);
		});

		it('rejects an unregistered channel string rather than passing it through', async () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLinkTools(deps), 'link_panels');
			const result = await spec.execute({ channel: 'not_a_channel', panel_ids: ['a', 'b'] });
			expect(result.isError).toBe(true);
		});
	});

	describe('unlink_panels', () => {
		it('AC5: accepts a channel and the panel ids to remove from that group', async () => {
			const deps = createPanelToolTestHarness();
			await createTwoCharts(deps);
			const links = buildLinkTools(deps);
			await tool(links, 'link_panels').execute({
				channel: 'symbol',
				panel_ids: ['panel_chart_1', 'panel_chart_2']
			});
			const result = await tool(links, 'unlink_panels').execute({
				channel: 'symbol',
				panel_ids: ['panel_chart_1']
			});
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
		});

		it('AC9: unlinking a panel not in the group fails', async () => {
			const deps = createPanelToolTestHarness();
			await createTwoCharts(deps);
			const spec = tool(buildLinkTools(deps), 'unlink_panels');
			const result = await spec.execute({ channel: 'symbol', panel_ids: ['panel_chart_1'] });
			expect(result.isError).toBe(true);
			const payload = resultPayload(result) as { error: string };
			expect(payload.error).toBe('not_linked');
		});
	});

	describe('set_panel_selection', () => {
		it('AC6: accepts one or more result ids, propagated to linked panels', async () => {
			const deps = createPanelToolTestHarness();
			await createTwoCharts(deps);
			const links = buildLinkTools(deps);
			await tool(links, 'link_panels').execute({
				channel: 'result_selection',
				panel_ids: ['panel_chart_1', 'panel_chart_2']
			});
			const result = await tool(links, 'set_panel_selection').execute({
				panel_id: 'panel_chart_1',
				selected_ids: ['AAPL', 'MSFT']
			});
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
			const payload = resultPayload(result) as { affected_ids: string[] };
			expect(payload.affected_ids.sort()).toEqual(['panel_chart_1', 'panel_chart_2']);
		});

		it('AC6: an empty array clears the selection', async () => {
			const deps = createPanelToolTestHarness();
			const lifecycle = buildLifecycleTools(deps);
			await tool(lifecycle, 'create_panel').execute({ kind: 'chart' });
			const spec = tool(buildLinkTools(deps), 'set_panel_selection');
			const result = await spec.execute({ panel_id: 'panel_chart_1', selected_ids: [] });
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
			const payload = resultPayload(result) as { diff_summary: string };
			expect(payload.diff_summary).toMatch(/Cleared/);
		});
	});
});
