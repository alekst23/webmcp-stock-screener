// T-1010-8: unit coverage for the two directly-registered tools --
// resolution (panel -> run/config/selection), error shaping, and the
// `available` precondition predicate. resultsTools.e2e.test.ts covers the
// full configure -> read -> select -> explain sequence and the round-trip
// (AC6, AC7); this file is narrower, one behavior at a time.
import { describe, expect, it } from 'vitest';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import {
	createLayoutTemplateRegistry,
	registerDefaultLayoutTemplates
} from '../../panels/domain/layoutTemplates';
import { createPanelRegistry } from '../../panels/registry/panelKindRegistry';
import { registerDefaultPanelKinds } from '../../panels/registry/defaultPanelKinds';
import { createSourceRendererRegistry } from '../../panels/registry/sourceRendererRegistry';
import {
	bindPanelSource,
	configurePanelView,
	createPanel,
	setPanelSelection,
	type PanelUseCaseDeps
} from '../../panels/application';
import { registerResultsTableRendererContract } from './tableRendererContract';
import { buildResultsTools, type ResultsToolDeps } from './resultsTools';
import { mintResultId } from '../domain/page';
import { testPinnedRunStore, testRun } from '../testSupport';
import type { PinnedRunStore } from '../../screener/ports';

function ctx(overrides: Partial<{ expectedRevision: number; idempotencyKey: string }> = {}) {
	return { actor: 'agent' as const, ...overrides };
}

const CLOSE_COLUMN_WIRE = {
	id: 'column_1',
	identity: { source: 'catalog_field', field_id: 'field.price.close' },
	label: 'Close',
	value_type: 'number'
};

function createHarness(runs: PinnedRunStore): ResultsToolDeps {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const clock = { now: () => '2026-01-01T00:00:00.000Z' };
	const ids = createIdSequencer();

	const kinds = createPanelRegistry();
	registerDefaultPanelKinds(kinds);

	const sourceRenderer = createSourceRendererRegistry();
	registerResultsTableRendererContract(sourceRenderer, { runs });

	const templates = createLayoutTemplateRegistry();
	registerDefaultLayoutTemplates(templates);

	const revisions = createRevisionService({
		repository,
		clock,
		ids,
		idempotency: createIdempotencyCache()
	});

	const deps: PanelUseCaseDeps = {
		workspaceId: 'workspace_1',
		repository,
		revisions,
		history: createChangeHistory(),
		clock,
		ids,
		kinds,
		sourceRenderer,
		templates
	};
	return { ...deps, runs };
}

function createBoundPanel(deps: ResultsToolDeps, runId: string): string {
	const envelope = createPanel(deps, {
		context: ctx(),
		kind: 'results_table',
		source: { type: 'screener_results', ref: { run_id: runId } }
	});
	return envelope.affectedIds[0]!;
}

async function textOf(result: { content: { type: 'text'; text: string }[] }): Promise<unknown> {
	return JSON.parse(result.content[0]!.text);
}

describe('get_screener_results', () => {
	it('rejects a missing panel_id without touching the store', async () => {
		const deps = createHarness(testPinnedRunStore());
		const [getScreenerResultsSpec] = buildResultsTools(deps);
		const result = await getScreenerResultsSpec!.execute({});
		expect(result.isError, 'panel_id is required').toBe(true);
	});

	it('names the unknown panel when panel_id does not resolve', async () => {
		const deps = createHarness(testPinnedRunStore());
		const [getScreenerResultsSpec] = buildResultsTools(deps);
		const result = await getScreenerResultsSpec!.execute({ panel_id: 'panel_missing' });
		expect(result.isError).toBe(true);
		const body = (await textOf(result)) as { error: string; message?: string };
		expect(body.error).toBe('unknown_panel');
	});

	it('names an unbound panel, telling the caller to bind_panel_source first', async () => {
		const deps = createHarness(testPinnedRunStore());
		const envelope = createPanel(deps, { context: ctx(), kind: 'results_table' });
		const panelId = envelope.affectedIds[0]!;

		const [getScreenerResultsSpec] = buildResultsTools(deps);
		const result = await getScreenerResultsSpec!.execute({ panel_id: panelId });
		expect(result.isError).toBe(true);
		const body = (await textOf(result)) as { error: string; message: string };
		expect(body.error).toBe('unbound_panel');
		expect(body.message).toContain('bind_panel_source');
	});

	it('names the run and says to re-run the screener when the run has expired', async () => {
		const deps = createHarness(testPinnedRunStore());
		const panelId = createBoundPanel(deps, 'run_missing');

		const [getScreenerResultsSpec] = buildResultsTools(deps);
		const result = await getScreenerResultsSpec!.execute({ panel_id: panelId });
		expect(result.isError).toBe(true);
		const body = (await textOf(result)) as { message: string; run_id: string };
		expect(body.run_id).toBe('run_missing');
		expect(body.message).toContain('run_missing');
		expect(body.message.toLowerCase()).toContain('run the screener again');
	});

	it('returns a page projected through the panel-configured columns, plus the current selection', async () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		const panelId = createBoundPanel(deps, 'run_1');
		configurePanelView(deps, {
			context: ctx(),
			panelId,
			config: { columns: [CLOSE_COLUMN_WIRE] }
		});
		const resultId = mintResultId('run_1', 1);
		setPanelSelection(deps, { context: { actor: 'human' }, panelId, selectedIds: [resultId] });

		const [getScreenerResultsSpec] = buildResultsTools(deps);
		const result = await getScreenerResultsSpec!.execute({ panel_id: panelId });
		expect(result.isError).toBeFalsy();
		const body = (await textOf(result)) as {
			run_id: string;
			rows: { columns: Record<string, unknown> }[];
			selected_result_ids: string[];
		};
		expect(body.run_id).toBe('run_1');
		expect(body.rows).toHaveLength(3);
		expect(body.rows[0]!.columns['column_1']).toBeDefined();
		expect(body.selected_result_ids).toEqual([resultId]);
	});

	it('rejects a page size over the maximum, naming the maximum', async () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		const panelId = createBoundPanel(deps, 'run_1');

		const [getScreenerResultsSpec] = buildResultsTools(deps);
		const result = await getScreenerResultsSpec!.execute({ panel_id: panelId, page_size: 500 });
		expect(result.isError).toBe(true);
		const body = (await textOf(result)) as { error: string; max: number };
		expect(body.error).toBe('page_size_exceeded');
		expect(body.max).toBe(200);
	});
});

describe('explain_result', () => {
	it('explains an explicit instrument_id', async () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		const panelId = createBoundPanel(deps, 'run_1');

		const [, explainResultSpec] = buildResultsTools(deps);
		const result = await explainResultSpec!.execute({ panel_id: panelId, instrument_id: 'inst_1' });
		expect(result.isError).toBeFalsy();
		const body = (await textOf(result)) as { instrument_id: string; run_id: string };
		expect(body.instrument_id).toBe('inst_1');
		expect(body.run_id).toBe('run_1');
	});

	it('falls back to the panel selection when instrument_id is omitted', async () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		const panelId = createBoundPanel(deps, 'run_1');
		setPanelSelection(deps, {
			context: { actor: 'human' },
			panelId,
			selectedIds: [mintResultId('run_1', 2)]
		});

		const [, explainResultSpec] = buildResultsTools(deps);
		const result = await explainResultSpec!.execute({ panel_id: panelId });
		expect(result.isError).toBeFalsy();
		const body = (await textOf(result)) as { instrument_id: string };
		expect(body.instrument_id).toBe('inst_2');
	});

	it('requires instrument_id when there is no selection to fall back to', async () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		const panelId = createBoundPanel(deps, 'run_1');

		const [, explainResultSpec] = buildResultsTools(deps);
		const result = await explainResultSpec!.execute({ panel_id: panelId });
		expect(result.isError).toBe(true);
		const body = (await textOf(result)) as { error?: string; message?: string };
		expect(JSON.stringify(body)).toContain('instrument_id');
	});

	it('names the instrument and run for an instrument outside the universe', async () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 1)));
		const panelId = createBoundPanel(deps, 'run_1');

		const [, explainResultSpec] = buildResultsTools(deps);
		const result = await explainResultSpec!.execute({
			panel_id: panelId,
			instrument_id: 'inst_never_evaluated'
		});
		expect(result.isError).toBe(true);
		const body = (await textOf(result)) as { error: string; instrument_id: string };
		expect(body.error).toBe('not_in_universe');
		expect(body.instrument_id).toBe('inst_never_evaluated');
	});
});

describe('available()', () => {
	it('is false when no panel is bound to an available run', () => {
		const deps = createHarness(testPinnedRunStore());
		createPanel(deps, { context: ctx(), kind: 'results_table' });
		const [getScreenerResultsSpec] = buildResultsTools(deps);
		expect(getScreenerResultsSpec!.available({} as never)).toBe(false);
	});

	it('is true once a panel is bound to an available run', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 1)));
		const envelope = createPanel(deps, { context: ctx(), kind: 'results_table' });
		bindPanelSource(deps, {
			context: ctx(),
			panelId: envelope.affectedIds[0]!,
			source: { type: 'screener_results', ref: { run_id: 'run_1' } }
		});
		const [getScreenerResultsSpec, explainResultSpec] = buildResultsTools(deps);
		expect(getScreenerResultsSpec!.available({} as never)).toBe(true);
		expect(explainResultSpec!.available({} as never)).toBe(true);
	});

	it('is false once the bound run is evicted', () => {
		const runs = testPinnedRunStore(testRun('run_1', 1));
		const deps = createHarness(runs);
		const envelope = createPanel(deps, { context: ctx(), kind: 'results_table' });
		bindPanelSource(deps, {
			context: ctx(),
			panelId: envelope.affectedIds[0]!,
			source: { type: 'screener_results', ref: { run_id: 'run_unknown' } }
		});
		const [getScreenerResultsSpec] = buildResultsTools(deps);
		expect(getScreenerResultsSpec!.available({} as never)).toBe(false);
	});
});

describe('input schemas', () => {
	it('declares panel_id as required, with types and descriptions on every property', () => {
		const deps = createHarness(testPinnedRunStore());
		for (const spec of buildResultsTools(deps)) {
			const schema = spec.inputSchema as {
				type: string;
				required: string[];
				properties: Record<string, { type: unknown; description?: string }>;
			};
			expect(schema.type).toBe('object');
			expect(schema.required).toContain('panel_id');
			for (const [name, propSchema] of Object.entries(schema.properties)) {
				expect(propSchema.type, `${spec.name}.${name} should declare a type`).toBeDefined();
				expect(
					propSchema.description,
					`${spec.name}.${name} should declare a description`
				).toBeTruthy();
			}
		}
	});

	it('names get_screener_results and explain_result exactly', () => {
		const deps = createHarness(testPinnedRunStore());
		const names = buildResultsTools(deps).map((spec) => spec.name);
		expect(names).toEqual(['get_screener_results', 'explain_result']);
	});
});
