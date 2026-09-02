// T-1010-8 AC6/AC7: the full sequence an agent actually drives --
// configure (EPIC-1007's configure_panel_view) -> read a page
// (get_screener_results) -> select (EPIC-1007's set_panel_selection) ->
// explain (explain_result) -- against a run fixture, plus the round trip
// AC7 asks for: an agent-driven configuration change is visible on the
// next read (standing in for "the rendered panel", the same way
// renderState.test.ts exercises panel rendering logic without mounting
// Svelte), and a panel-driven (human actor) selection is visible to a
// subsequent get_screener_results/explain_result call.
//
// AC6's "no screener execution occurred at any point" is asserted two
// ways: structurally (PinnedRunStore has no execute/refresh member reachable
// from any code this test calls -- ports.ts's own comment) and empirically,
// via createSpyPinnedRunStore's call counters staying at the single seed
// putRun() this test performs itself.
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
	createPanel,
	configurePanelView,
	readPanelState,
	setPanelSelection
} from '../../panels/application';
import { registerResultsTableRendererContract } from './tableRendererContract';
import { buildResultsTools, type ResultsToolDeps } from './resultsTools';
import { getScreenerResults } from '../application/getScreenerResults';
import { parseWireResultsTableConfig } from '../application/tableConfigWire';
import { defaultResultsTableConfig } from '../domain/projection';
import { mintResultId } from '../domain/page';
import { createSpyPinnedRunStore, testPinnedRunStore, testRun } from '../testSupport';

const CLOSE_COLUMN_WIRE = {
	id: 'column_close',
	identity: { source: 'catalog_field', field_id: 'field.price.close' },
	label: 'Close',
	value_type: 'number'
};

function createHarness() {
	const spy = createSpyPinnedRunStore(testPinnedRunStore(testRun('run_1', 3)));

	const repository = createLocalWorkspaceRepository(memoryStorage());
	const clock = { now: () => '2026-01-01T00:00:00.000Z' };
	const ids = createIdSequencer();

	const kinds = createPanelRegistry();
	registerDefaultPanelKinds(kinds);

	const sourceRenderer = createSourceRendererRegistry();
	registerResultsTableRendererContract(sourceRenderer, { runs: spy });

	const templates = createLayoutTemplateRegistry();
	registerDefaultLayoutTemplates(templates);

	const revisions = createRevisionService({
		repository,
		clock,
		ids,
		idempotency: createIdempotencyCache()
	});

	const deps: ResultsToolDeps = {
		workspaceId: 'workspace_1',
		repository,
		revisions,
		history: createChangeHistory(),
		clock,
		ids,
		kinds,
		sourceRenderer,
		templates,
		runs: spy
	};
	return { deps, spy };
}

async function textOf(result: { content: { type: 'text'; text: string }[] }): Promise<unknown> {
	return JSON.parse(result.content[0]!.text);
}

describe('T-1010-8 end-to-end: configure -> read -> select -> explain', () => {
	it('drives the whole sequence against a run fixture with no screener execution', async () => {
		const { deps, spy } = createHarness();
		const seededPutCalls = spy.putRunCalls;

		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'results_table',
			source: { type: 'screener_results', ref: { run_id: 'run_1' } }
		});
		const panelId = created.affectedIds[0]!;

		// 1. Configure, via EPIC-1007's own configure_panel_view use case.
		const configureEnvelope = configurePanelView(deps, {
			context: { actor: 'agent' },
			panelId,
			config: { columns: [CLOSE_COLUMN_WIRE] }
		});
		expect(configureEnvelope.newRevision).toBeGreaterThan(0);

		const [getScreenerResultsSpec, explainResultSpec] = buildResultsTools(deps);

		// 2. Read a page.
		const pageResult = await getScreenerResultsSpec!.execute({ panel_id: panelId });
		expect(pageResult.isError, JSON.stringify(pageResult)).toBeFalsy();
		const page = (await textOf(pageResult)) as {
			run_id: string;
			total: number;
			rows: { result_id: string; instrument_id: string; columns: Record<string, unknown> }[];
		};
		expect(page.run_id).toBe('run_1');
		expect(page.total).toBe(3);
		expect(page.rows[0]!.columns['column_close']).toBeDefined();

		// 3. Select, via EPIC-1007's own set_panel_selection use case.
		const targetResultId = page.rows[0]!.result_id;
		const selectionEnvelope = setPanelSelection(deps, {
			context: { actor: 'agent' },
			panelId,
			selectedIds: [targetResultId]
		});
		expect(selectionEnvelope.affectedIds).toContain(panelId);

		// 4. Explain -- no instrument_id, resolved from the selection just made.
		const explainResultResult = await explainResultSpec!.execute({ panel_id: panelId });
		expect(explainResultResult.isError, JSON.stringify(explainResultResult)).toBeFalsy();
		const explanation = (await textOf(explainResultResult)) as {
			instrument_id: string;
			run_id: string;
		};
		expect(explanation.instrument_id).toBe(page.rows[0]!.instrument_id);
		expect(explanation.run_id).toBe('run_1');

		// No screener execution occurred at any point: the only putRun() call
		// is this test's own fixture seed, made before any tool ran.
		expect(spy.putRunCalls).toBe(seededPutCalls);
	});
});

describe('T-1010-8 AC7: round trip', () => {
	it('an agent-driven configure_panel_view change is visible on the next read', async () => {
		const { deps } = createHarness();
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'results_table',
			source: { type: 'screener_results', ref: { run_id: 'run_1' } }
		});
		const panelId = created.affectedIds[0]!;

		const [getScreenerResultsSpec] = buildResultsTools(deps);
		const before = (await textOf(await getScreenerResultsSpec!.execute({ panel_id: panelId }))) as {
			rows: { columns: Record<string, unknown> }[];
		};
		expect(before.rows[0]!.columns['column_close']).toBeUndefined();

		configurePanelView(deps, {
			context: { actor: 'agent' },
			panelId,
			config: { columns: [CLOSE_COLUMN_WIRE] }
		});

		// Models "visible in the rendered panel": the exact same resolution
		// ResultsTablePanel.svelte performs -- parse the panel's current
		// stored config, then call getScreenerResults over the same store --
		// re-read fresh, never a cached page surviving a configuration change.
		const storedPanel = readPanelState(deps.repository.get(deps.workspaceId)!).panels.find(
			(p) => p.id === panelId
		)!;
		const parsed = parseWireResultsTableConfig(storedPanel.config);
		const rendered = getScreenerResults(deps.runs, {
			runId: 'run_1',
			tableConfig: parsed.ok ? parsed.config : defaultResultsTableConfig()
		});
		expect('rows' in rendered && rendered.rows[0]!.columns['column_close']).toBeDefined();

		const after = (await textOf(await getScreenerResultsSpec!.execute({ panel_id: panelId }))) as {
			rows: { columns: Record<string, unknown> }[];
		};
		expect(after.rows[0]!.columns['column_close']).toBeDefined();
	});

	it('a panel-driven (human) selection is visible to get_screener_results and explain_result', async () => {
		const { deps } = createHarness();
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'results_table',
			source: { type: 'screener_results', ref: { run_id: 'run_1' } }
		});
		const panelId = created.affectedIds[0]!;
		const resultId = mintResultId('run_1', 2);

		// Simulates ResultsTablePanel.svelte's own toggleRow: the same
		// setPanelSelection call, with actor 'human'.
		setPanelSelection(deps, { context: { actor: 'human' }, panelId, selectedIds: [resultId] });

		const [getScreenerResultsSpec, explainResultSpec] = buildResultsTools(deps);

		const page = (await textOf(await getScreenerResultsSpec!.execute({ panel_id: panelId }))) as {
			selected_result_ids: string[];
		};
		expect(page.selected_result_ids).toEqual([resultId]);

		const explanation = (await textOf(await explainResultSpec!.execute({ panel_id: panelId }))) as {
			instrument_id: string;
		};
		expect(explanation.instrument_id).toBe('inst_2');
	});
});
