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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPanelShellRuntime, registerPanelTools } from './registerPanelTools';
import { readPanelState, bindPanelSource, createPanel } from '../application';
import { defaultWireResultsTableConfig } from '../../results/application/tableConfigWire';
import { getResultsPanelRuntimeDeps } from '../../results/panel/resultsPanelContext';
import { mintResultId } from '../../results/domain/page';
import { testRun } from '../../results/testSupport';
import { readChartState } from '../../workbench/chart/domain/chartState';

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

	// T-1015-12: watchlist, alert_draft and similar_opportunities are also
	// real kinds now (registered before registerDefaultPanelKinds, same as
	// results_table) -- alert_draft is a brand-new kind with no placeholder
	// counterpart at all, so the registry's name list grows to nine (the
	// original eight plus alert_draft); 'alerts' (plural) is untouched and
	// stays a placeholder, per this ticket's own scope note.
	it('registers watchlist, alert_draft and similar_opportunities as real kinds too, alongside the remaining placeholders', () => {
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
				'symbol_details',
				'alert_draft'
			].sort()
		);
		expect(deps.sourceRenderer.rendererTypeNames().sort()).toEqual(
			['table', 'chart_grid', 'heatmap', 'scatter_plot'].sort()
		);
	});

	// hotfix/empty-grid-canvas: the default seed is now just filter_builder
	// (see spec.md's amended "Seed a new workspace with the default layout");
	// results_table is still fully addable via create_panel.
	it('still seeds a brand-new workspace with filter_builder, and results_table remains addable', () => {
		const { deps } = createDefaultPanelShellRuntime();
		const doc = deps.repository.get(deps.workspaceId);
		expect(doc, 'the seeded workspace document must exist').not.toBeNull();
		const state = readPanelState(doc!);
		expect(state.panels).toHaveLength(1);
		expect(state.panels[0]!.kind).toBe('filter_builder');

		createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'results_table',
			rect: { col: 2, row: 0, colSpan: 2, rowSpan: 2 }
		});
		const resultsPanel = readPanelState(deps.repository.get(deps.workspaceId)!).panels.find(
			(p) => p.kind === 'results_table'
		);
		expect(resultsPanel, 'expected an addable results_table panel').toBeDefined();
	});

	// Bug fix (see git history): 'chart' used to be registered only as a
	// placeholder (defaultPanelKinds.ts) with a placeholder 'chart_grid'
	// renderer/'instrument' entry never even declared
	// (defaultSourceRendererTypes.ts) -- these prove the real registration.
	it('registers the real chart kind and the real chart_grid renderer/instrument source, not the placeholders', () => {
		const { deps } = createDefaultPanelShellRuntime();
		const kind = deps.kinds.require('chart');
		expect(kind.bindingTypes, 'the real kind only accepts the real instrument source type').toEqual(
			['instrument']
		);
		expect(kind.defaultRenderer).toBe('chart_grid');

		const renderer = deps.sourceRenderer.requireRendererType('chart_grid');
		expect(
			renderer.acceptedSourceTypes,
			'the real chart_grid renderer only accepts an instrument source, unlike the placeholder'
		).toEqual(['instrument']);
		expect(deps.sourceRenderer.requireSourceType('instrument')).toBeDefined();
	});

	it('bind_panel_source accepts a resolved instrument on a chart panel and rejects a bare ticker', () => {
		const { deps } = createDefaultPanelShellRuntime();
		// hotfix/empty-grid-canvas: chart is no longer part of the default seed
		// (just filter_builder is) -- add one explicitly.
		createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 2, row: 0, colSpan: 2, rowSpan: 2 }
		});
		const seededDoc = deps.repository.get(deps.workspaceId)!;
		const panelId = readPanelState(seededDoc).panels.find((p) => p.kind === 'chart')!.id;

		const accepted = deps.sourceRenderer.validateSource({
			source: {
				type: 'instrument',
				ref: {
					instrument: {
						instrument_id: 'inst:XNAS:AAPL',
						symbol: 'AAPL',
						exchange: 'XNAS',
						asset_type: 'equity'
					}
				}
			},
			panelKind: 'chart',
			renderer: 'chart_grid'
		});
		expect(
			accepted.ok,
			`expected a resolved instrument to be accepted, got ${JSON.stringify(accepted)}`
		).toBe(true);

		const envelope = bindPanelSource(deps, {
			context: { actor: 'agent' },
			panelId,
			source: {
				type: 'instrument',
				ref: {
					instrument: {
						instrument_id: 'inst:XNAS:AAPL',
						symbol: 'AAPL',
						exchange: 'XNAS',
						asset_type: 'equity'
					}
				}
			}
		});
		expect(envelope.affectedIds).toEqual([panelId]);

		// The deep half of this bug fix (see git history): bind_panel_source
		// used to only ever set panel.source -- readChartData/ChartPanelBody.svelte
		// read the instrument off the chart extension instead
		// (ChartState.config.instrument), which nothing populated, so a chart
		// panel kept refusing "no instrument bound" even after a fully
		// successful bind. This proves the real chart source type's
		// applyBinding hook (chartPanelKind.ts) actually closes that gap.
		const chartState = readChartState(deps.repository.get(deps.workspaceId)!, panelId);
		expect(
			chartState.config.instrument?.instrumentId,
			"expected bind_panel_source to also populate the chart extension's own instrument, not just panel.source"
		).toBe('inst:XNAS:AAPL');

		const rejected = deps.sourceRenderer.validateSource({
			source: { type: 'instrument', ref: { instrument: 'AAPL' } },
			panelKind: 'chart',
			renderer: 'chart_grid'
		});
		expect(rejected.ok, 'a bare ticker must never be accepted as an instrument reference').toBe(
			false
		);
	});

	it('closes the real panel kind and the real renderer contract over the same PinnedRunStore', () => {
		const { deps } = createDefaultPanelShellRuntime();
		const { runs } = getResultsPanelRuntimeDeps();

		const run = testRun('run_1', 3);
		runs.putRun(run);

		// hotfix/empty-grid-canvas: the default seed is now just filter_builder,
		// leaving most of the grid free -- add a results_table panel explicitly.
		createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'results_table',
			rect: { col: 2, row: 0, colSpan: 2, rowSpan: 2 }
		});
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

// T-1010-8 AC1/AC8, narrowed by TOOLS_OFF_MVP_SURFACE (registerPanelTools.ts):
// registerPanelTools() registers only docs/architecture/tool-surface-mvp.md's
// served subset of the fifteen panel tools and two Results tools --
// create_panel, remove_panel, set_panel_layout, get_screener_results -- with
// the rest (duplicate_panel, apply_layout_template, split_panel,
// maximize_panel, reset_layout, bind_panel_source, set_panel_renderer,
// configure_chart_grid, configure_panel_view, link_panels, unlink_panels,
// set_panel_selection, explain_result) filtered out at this registration
// boundary, not removed from their own modules -- each still has its own
// full-roster test (panelTools.test.ts, resultsTools.test.ts, etc.).
describe('registerPanelTools', () => {
	it('registers exactly the MVP subset of panel and Results tools', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		try {
			await registerPanelTools();
			const names = registerTool.mock.calls.map(([tool]) => tool.name as string);
			expect(names.sort()).toEqual(
				['create_panel', 'remove_panel', 'set_panel_layout', 'get_screener_results'].sort()
			);
			expect(names).not.toContain('duplicate_panel');
			expect(names).not.toContain('explain_result');
			expect(names).not.toContain('bind_panel_source');
			expect(names).not.toContain('configure_results_table');
			expect(names).not.toContain('select_result');
			expect(names).not.toContain('table');
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
