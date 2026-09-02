// T-1010-7: the composition root (createDefaultPanelShellRuntime) now
// registers the real results_table panel kind and the real table renderer
// contract before falling back to the placeholder defaults -- these tests
// assert that wiring actually took, not just that nothing throws.
//
// createDefaultPanelShellRuntime() always uses the real localStorage-backed
// WorkspaceRepository (it takes no injectable deps), so localStorage is
// cleared before every test: otherwise the second test in this file would
// find the first test's already-seeded workspace still active and never
// exercise seedDefaultWorkspace's justCreated path at all.
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultPanelShellRuntime } from './registerPanelTools';
import { readPanelState, bindPanelSource } from '../application';
import { defaultWireResultsTableConfig } from '../../results/application/tableConfigWire';
import { getResultsPanelRuntimeDeps } from '../../results/panel/resultsPanelContext';
import { mintResultId } from '../../results/domain/page';
import { testRun } from '../../results/testSupport';

beforeEach(() => {
	localStorage.clear();
});

describe('createDefaultPanelShellRuntime', () => {
	it('registers the real results_table kind, not the placeholder', () => {
		const { deps } = createDefaultPanelShellRuntime();
		const kind = deps.kinds.require('results_table');
		expect(
			kind.defaultConfig(),
			'the real kind default is the wire ResultsTableConfig shape'
		).toEqual(defaultWireResultsTableConfig());
		expect(kind.defaultRenderer).toBe('table');
	});

	it('registers the real table renderer contract, with a validateSelection hook the placeholder never had', () => {
		const { deps } = createDefaultPanelShellRuntime();
		const table = deps.sourceRenderer.requireRendererType('table');
		expect(
			table.validateSelection,
			'only the real contract (T-1010-6) defines validateSelection'
		).toBeTypeOf('function');
		expect(deps.sourceRenderer.requireSourceType('screener_results')).toBeDefined();
	});

	it('still registers the other seven placeholder kinds and three placeholder source/renderer types', () => {
		const { deps } = createDefaultPanelShellRuntime();
		expect(deps.kinds.names().sort()).toEqual(
			[
				'filter_builder',
				'chart',
				'study_library',
				'results_table',
				'similar_opportunities',
				'watchlist',
				'alerts',
				'symbol_details'
			].sort()
		);
		expect(deps.sourceRenderer.rendererTypeNames().sort()).toEqual(
			['table', 'chart_grid', 'heatmap', 'scatter_plot'].sort()
		);
	});

	it('still seeds a brand-new workspace with its three default panels, one of them results_table', () => {
		const { deps } = createDefaultPanelShellRuntime();
		const doc = deps.repository.get(deps.workspaceId);
		expect(doc, 'the seeded workspace document must exist').not.toBeNull();
		const state = readPanelState(doc!);
		expect(state.panels).toHaveLength(3);
		const resultsPanel = state.panels.find((p) => p.kind === 'results_table');
		expect(resultsPanel, 'expected a seeded results_table panel').toBeDefined();
	});

	it('closes the real panel kind and the real renderer contract over the same PinnedRunStore', () => {
		const { deps } = createDefaultPanelShellRuntime();
		const { runs } = getResultsPanelRuntimeDeps();

		const run = testRun('run_1', 3);
		runs.putRun(run);

		// The default-seeded workspace already fills the whole grid (three
		// panels, one full-height column each) -- reuse the seeded
		// results_table panel rather than creating a second one, which would
		// have nowhere left to auto-place.
		const seededDoc = deps.repository.get(deps.workspaceId)!;
		const panelId = readPanelState(seededDoc).panels.find((p) => p.kind === 'results_table')!.id;
		bindPanelSource(deps, {
			context: { actor: 'agent' },
			panelId,
			source: { type: 'screener_results', ref: { run_id: 'run_1' } }
		});

		const panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels.find(
			(p) => p.id === panelId
		)!;
		const validate = deps.sourceRenderer.requireRendererType('table').validateSelection!;
		const resultId = mintResultId('run_1', 1);
		const result = validate({ selectedIds: [resultId], panel, deps });
		expect(
			result.ok,
			`expected the renderer's validateSelection to recognize a real result id from the same store, got ${JSON.stringify(result)}`
		).toBe(true);
	});
});
