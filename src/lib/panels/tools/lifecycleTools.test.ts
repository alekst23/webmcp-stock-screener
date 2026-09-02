import { describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../webmcp/types';
import { buildLifecycleTools } from './lifecycleTools';
import { createPanelToolTestHarness, resultPayload } from './testSupport';

function tool(tools: ToolSpec[], name: string): ToolSpec {
	const found = tools.find((t) => t.name === name);
	if (!found) {
		throw new Error(`tool "${name}" not found among ${tools.map((t) => t.name).join(', ')}`);
	}
	return found;
}

describe('lifecycleTools', () => {
	describe('create_panel', () => {
		it('AC1: description states what it does and returns', () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLifecycleTools(deps), 'create_panel');
			expect(spec.description).toMatch(/creates/i);
			expect(spec.description, 'must say what it returns').toMatch(/returns/i);
		});

		it('AC3: schema enumerates registered kinds, source types, and renderer types', () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLifecycleTools(deps), 'create_panel');
			const schema = spec.inputSchema as {
				properties: { kind: { enum: string[] }; renderer: { enum: (string | null)[] } };
			};
			expect(schema.properties.kind.enum, 'kind enum must match the registry').toEqual(
				deps.kinds.names()
			);
			expect(schema.properties.renderer.enum).toEqual([
				...deps.sourceRenderer.rendererTypeNames(),
				null
			]);
		});

		it('AC11: succeeds with no browser and no document.modelContext, returning a mutation envelope', async () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLifecycleTools(deps), 'create_panel');
			const result = await spec.execute({ kind: 'chart' });
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
			const payload = resultPayload(result) as { change_id: string; affected_ids: string[] };
			expect(payload.affected_ids).toEqual(['panel_chart_1']);
		});

		it('AC9: an unknown kind fails with the registered kinds listed', async () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLifecycleTools(deps), 'create_panel');
			const result = await spec.execute({ kind: 'not_a_kind' });
			expect(result.isError, `expected failure, got ${JSON.stringify(result)}`).toBe(true);
			const payload = resultPayload(result) as { error: string; registeredKinds: string[] };
			expect(payload.error).toBe('unknown_panel_kind');
			expect(payload.registeredKinds).toEqual(deps.kinds.names());
		});

		it('AC10: a revision conflict is distinguishable from a validation failure', async () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLifecycleTools(deps), 'create_panel');
			const result = await spec.execute({ kind: 'chart', expected_revision: 99 });
			expect(result.isError).toBe(true);
			const payload = resultPayload(result) as {
				error: string;
				expected_revision: number;
				current_revision: number;
			};
			expect(payload.error).toBe('revision_conflict');
			expect(payload.expected_revision).toBe(99);
			expect(payload.current_revision).toBe(0);
		});

		it('AC10: a replayed idempotency key with a different request is a distinguishable conflict', async () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLifecycleTools(deps), 'create_panel');
			await spec.execute({ kind: 'chart', idempotency_key: 'k1' });
			const result = await spec.execute({ kind: 'alerts', idempotency_key: 'k1' });
			expect(result.isError).toBe(true);
			const payload = resultPayload(result) as { error: string; idempotency_key: string };
			expect(payload.error).toBe('idempotency_conflict');
			expect(payload.idempotency_key).toBe('k1');
		});

		it('AC9: a bad explicit placement reports the occupying panel', async () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLifecycleTools(deps), 'create_panel');
			await spec.execute({ kind: 'chart', rect: { col: 0, row: 0, col_span: 2, row_span: 2 } });
			const result = await spec.execute({
				kind: 'alerts',
				rect: { col: 0, row: 0, col_span: 1, row_span: 1 }
			});
			expect(result.isError).toBe(true);
			const payload = resultPayload(result) as { error: string; occupiedBy: string };
			expect(payload.error).toBe('overlap');
			expect(payload.occupiedBy).toBe('panel_chart_1');
		});
	});

	describe('duplicate_panel', () => {
		it('AC7: accepts a single panel id and an optional symbol override', async () => {
			const deps = createPanelToolTestHarness();
			const tools = buildLifecycleTools(deps);
			await tool(tools, 'create_panel').execute({ kind: 'chart' });
			const result = await tool(tools, 'duplicate_panel').execute({
				panel_id: 'panel_chart_1',
				symbol_override: 'ACME'
			});
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
			const payload = resultPayload(result) as { affected_ids: string[] };
			expect(payload.affected_ids).toEqual(['panel_chart_2']);
		});

		it('AC8: an unknown panel id fails rather than accepting a positional reference', async () => {
			const deps = createPanelToolTestHarness();
			const spec = tool(buildLifecycleTools(deps), 'duplicate_panel');
			const result = await spec.execute({ panel_id: 'does_not_exist' });
			expect(result.isError).toBe(true);
			const payload = resultPayload(result) as { error: string };
			expect(payload.error).toBe('unknown_panel');
		});
	});

	describe('remove_panel', () => {
		it('AC7: removes by stable id and returns the mutation envelope', async () => {
			const deps = createPanelToolTestHarness();
			const tools = buildLifecycleTools(deps);
			await tool(tools, 'create_panel').execute({ kind: 'chart' });
			const result = await tool(tools, 'remove_panel').execute({ panel_id: 'panel_chart_1' });
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
			const payload = resultPayload(result) as { affected_ids: string[] };
			expect(payload.affected_ids).toEqual(['panel_chart_1']);
		});
	});
});
