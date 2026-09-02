// Tests for T-1014-10's `export_results` ToolSpec: wire input parsing/
// validation and the wire shape returned to a caller. Orchestration is
// covered by application/exportResults.test.ts; these tests exercise the
// wire boundary only.
import { describe, expect, it } from 'vitest';
import { createSpyPinnedRunStore, testPinnedRunStore, testRun } from '../../../results/testSupport';
import { buildExportResultsTool, type ExportResultsDeps } from './exportResultsTool';

async function textOf(result: { content: { type: 'text'; text: string }[] }): Promise<any> {
	return JSON.parse(result.content[0]!.text);
}

function harness(overrides: Partial<ExportResultsDeps> = {}): ExportResultsDeps {
	return { runs: testPinnedRunStore(testRun('run_1', 3)), ...overrides };
}

describe('export_results: input validation', () => {
	it('rejects a missing run_id', async () => {
		const tool = buildExportResultsTool(harness());
		const result = await tool.execute({});
		expect(result.isError).toBe(true);
	});

	it('rejects a malformed table_config', async () => {
		const tool = buildExportResultsTool(harness());
		const result = await tool.execute({ run_id: 'run_1', table_config: 'not-an-object' });
		expect(result.isError).toBe(true);
		const body = await textOf(result);
		expect(body.error).toBe('invalid_table_config');
	});

	it('rejects a non-string-array "columns"', async () => {
		const tool = buildExportResultsTool(harness());
		const result = await tool.execute({ run_id: 'run_1', columns: [1, 2] });
		expect(result.isError).toBe(true);
	});
});

describe('export_results: happy path (AC1, AC2, AC3, AC8)', () => {
	it('returns the run, provenance, filter tree, ranking and a stable export id', async () => {
		const tool = buildExportResultsTool(harness());
		const result = await tool.execute({ run_id: 'run_1' });
		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		const body = await textOf(result);
		expect(body.run_id).toBe('run_1');
		expect(body.export_id).toMatch(/^export_\d+$/);
		expect(body.provenance).toHaveProperty('as_of');
		expect(body.filter_tree).toBeDefined();
		expect(Array.isArray(body.rows)).toBe(true);
		expect(body.rows).toHaveLength(3);
	});
});

describe('export_results: unknown or expired run (AC5)', () => {
	it('rejects an unknown run_id, naming it, and never touches the store to cover for it', async () => {
		const store = testPinnedRunStore();
		const spy = createSpyPinnedRunStore(store);
		const tool = buildExportResultsTool(harness({ runs: spy }));
		const result = await tool.execute({ run_id: 'run_missing' });
		expect(result.isError).toBe(true);
		const body = await textOf(result);
		expect(body.run_id).toBe('run_missing');
		expect(body.error).toBe('unknown');
		expect(spy.putRunCalls, 'an unknown run must never be covered by a fresh execution').toBe(0);
	});
});

describe('export_results: column selection (AC6)', () => {
	it('rejects a requested column absent from table_config, naming it', async () => {
		const tool = buildExportResultsTool(harness());
		const result = await tool.execute({
			run_id: 'run_1',
			table_config: {
				columns: [
					{
						id: 'column_price',
						identity: { source: 'catalog_field', field_id: 'field.price' },
						label: 'Price',
						value_type: 'number'
					}
				]
			},
			columns: ['column_missing']
		});
		expect(result.isError).toBe(true);
		const body = await textOf(result);
		expect(body.error).toBe('unknown_columns');
		expect(body.column_ids).toEqual(['column_missing']);
	});

	it('scopes the export to the requested column subset without changing provenance', async () => {
		const tool = buildExportResultsTool(harness());
		const result = await tool.execute({
			run_id: 'run_1',
			table_config: {
				columns: [
					{
						id: 'column_price',
						identity: { source: 'catalog_field', field_id: 'field.price' },
						label: 'Price',
						value_type: 'number'
					}
				]
			},
			columns: ['column_price']
		});
		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		const body = await textOf(result);
		expect(body.columns.map((c: { id: string }) => c.id)).toEqual(['column_price']);
		expect(body.provenance).toHaveProperty('as_of');
	});
});

describe('export_results: bounded (AC7)', () => {
	it('accepts a limit and reports selection metadata', async () => {
		const tool = buildExportResultsTool(
			harness({ runs: testPinnedRunStore(testRun('run_1', 10)) })
		);
		const result = await tool.execute({ run_id: 'run_1', limit: 4 });
		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		const body = await textOf(result);
		expect(body.rows).toHaveLength(4);
		expect(body.selection.bounded).toBe(true);
		expect(body.selection.total_available).toBe(10);
		expect(body.selection.next_cursor).not.toBeNull();
	});
});

describe('export_results: read-only (AC9, AC10)', () => {
	it('the response carries no mutation-envelope fields', async () => {
		const tool = buildExportResultsTool(harness());
		const result = await tool.execute({ run_id: 'run_1' });
		const body = await textOf(result);
		expect('change_id' in body).toBe(false);
		expect('new_revision' in body).toBe(false);
		expect('undo_token' in body).toBe(false);
	});
});
