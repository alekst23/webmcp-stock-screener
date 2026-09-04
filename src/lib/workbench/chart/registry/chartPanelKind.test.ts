// Bug fix (see git history): 'chart' was only ever registered as a
// placeholder panel kind (defaultPanelKinds.ts) with a placeholder
// 'chart_grid' renderer (defaultSourceRendererTypes.ts), even though
// chart/tools/ already carries a fully-built real chart engine. These tests
// prove the real registration this module adds: the real source/renderer
// contract validates as chart's own logic (chartSource.ts/chartView.ts)
// says it should, and the real panel kind delegates to it instead of a
// second, permissive placeholder validator.
import { afterEach, describe, expect, it } from 'vitest';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createRevisionService } from '../../application/revisionService';
import { createIdSequencer } from '../../domain/ids';
import { emptyWorkspace } from '../../domain/workspace';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { createLayoutTemplateRegistry } from '../../../panels/domain/layoutTemplates';
import { createPanelRegistry } from '../../../panels/registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../../../panels/registry/sourceRendererRegistry';
import type { PanelUseCaseDeps } from '../../../panels/application';
import { readChartState } from '../domain/chartState';
import { createInMemoryChartSeries } from '../infra/inMemoryChartSeries';
import {
	CHART_PANEL_KIND,
	CHART_RENDERER_NAME,
	CHART_SOURCE_TYPE
} from '../tools/chartRendererContract';
import {
	createChartPanelKindDefinition,
	registerChartPanelKind,
	registerChartSourceRenderer
} from './chartPanelKind';
import { getChartPanelRuntimeDeps, resetChartPanelRuntimeDeps } from './chartPanelContext';

const CLOCK = { now: () => '2026-01-01T00:00:00.000Z' };

const VALID_INSTRUMENT = {
	instrument_id: 'inst:XNAS:AAPL',
	symbol: 'AAPL',
	exchange: 'XNAS',
	asset_type: 'equity'
};

function harness(): PanelUseCaseDeps {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const ids = createIdSequencer();
	return {
		workspaceId: 'workspace_1',
		repository,
		revisions: createRevisionService({
			repository,
			clock: CLOCK,
			ids,
			idempotency: createIdempotencyCache()
		}),
		history: createChangeHistory(),
		clock: CLOCK,
		ids,
		kinds: createPanelRegistry(),
		sourceRenderer: createSourceRendererRegistry(),
		templates: createLayoutTemplateRegistry()
	};
}

afterEach(() => {
	resetChartPanelRuntimeDeps();
});

describe('registerChartSourceRenderer', () => {
	it("registers the real 'instrument' source type, accepting a resolved instrument ref", () => {
		const registry = createSourceRendererRegistry();
		registerChartSourceRenderer(registry, { clock: CLOCK });

		const validation = registry.validateSource({
			source: { type: CHART_SOURCE_TYPE, ref: { instrument: VALID_INSTRUMENT } },
			panelKind: CHART_PANEL_KIND,
			renderer: CHART_RENDERER_NAME
		});
		expect(
			validation.ok,
			`expected a valid ref to be accepted, got ${JSON.stringify(validation)}`
		).toBe(true);
	});

	it('rejects a source naming a bare ticker instead of a resolved instrument', () => {
		const registry = createSourceRendererRegistry();
		registerChartSourceRenderer(registry, { clock: CLOCK });

		const validation = registry.validateSource({
			source: { type: CHART_SOURCE_TYPE, ref: { instrument: 'AAPL' } },
			panelKind: CHART_PANEL_KIND,
			renderer: CHART_RENDERER_NAME
		});
		expect(validation.ok, 'a bare ticker must never be accepted as an instrument reference').toBe(
			false
		);
	});

	it("registers the real 'chart_grid' renderer, accepting only the 'instrument' source type", () => {
		const registry = createSourceRendererRegistry();
		registerChartSourceRenderer(registry, { clock: CLOCK });

		const renderer = registry.requireRendererType(CHART_RENDERER_NAME);
		expect(renderer.acceptedSourceTypes).toEqual([CHART_SOURCE_TYPE]);

		// The placeholder renderer used to accept screener_results/watchlist/
		// symbol_list/panel_reference -- the real one must not.
		const rejected = registry.validateSource({
			source: { type: 'screener_results', ref: { run_id: 'run_1' } },
			panelKind: CHART_PANEL_KIND,
			renderer: CHART_RENDERER_NAME
		});
		expect(rejected.ok, 'the real chart_grid renderer must reject a screener_results source').toBe(
			false
		);
	});

	it("validates the renderer's view config through the real validator, not a permissive placeholder", () => {
		const registry = createSourceRendererRegistry();
		registerChartSourceRenderer(registry, { clock: CLOCK });

		const rejected = registry.validateRendererConfig(CHART_RENDERER_NAME, {
			candle_type: 'not_a_real_candle_type'
		});
		expect(rejected.ok, 'an invalid candle_type must be rejected by the real validator').toBe(
			false
		);
	});

	// Bug fix (see git history): without applyBinding, bind_panel_source
	// stored a chart's source ref onto panel.source but never touched the
	// chart extension readChartData/ChartPanelBody.svelte actually read --
	// see bindPanelSource.test.ts for the generic documentPatch wiring this
	// relies on; this proves the chart-specific adapter itself.
	it('applyBinding writes the resolved instrument into the chart extension via the real apply logic', () => {
		const registry = createSourceRendererRegistry();
		registerChartSourceRenderer(registry, { clock: CLOCK });
		const sourceType = registry.getSourceType(CHART_SOURCE_TYPE)!;
		expect(
			sourceType.applyBinding,
			'expected the chart source type to define applyBinding'
		).toBeTypeOf('function');

		const doc = emptyWorkspace('workspace_1', 'Test', CLOCK.now());
		const updated = sourceType.applyBinding!(doc, 'panel_chart_1', {
			instrument: VALID_INSTRUMENT
		});

		const state = readChartState(updated, 'panel_chart_1');
		expect(state.config.instrument?.instrumentId).toBe(VALID_INSTRUMENT.instrument_id);
		expect(state.config.instrument?.symbol).toBe(VALID_INSTRUMENT.symbol);
	});
});

describe('createChartPanelKindDefinition', () => {
	function series() {
		return createInMemoryChartSeries({ clock: CLOCK, series: [] });
	}

	it('declares the kind matching defaultPanelKinds.ts layout/linking, with the real accepted source type', () => {
		const registry = createSourceRendererRegistry();
		const renderer = registerChartSourceRenderer(registry, { clock: CLOCK });
		const definition = createChartPanelKindDefinition({
			useCaseDeps: harness(),
			series: series(),
			renderer
		});

		expect(definition.kind).toBe(CHART_PANEL_KIND);
		expect(definition.defaultTitle).toBe('Chart');
		expect(definition.defaultSize).toEqual({ colSpan: 1, rowSpan: 1 });
		expect(definition.minSize).toEqual({ colSpan: 1, rowSpan: 1 });
		expect(definition.linkChannels).toEqual([
			'symbol',
			'timeframe',
			'result_selection',
			'crosshair'
		]);
		expect(definition.bindingTypes).toEqual([CHART_SOURCE_TYPE]);
		expect(definition.defaultRenderer).toBe(CHART_RENDERER_NAME);
	});

	it("defaultConfig/validateConfig delegate to the real renderer's own contract", () => {
		const registry = createSourceRendererRegistry();
		const renderer = registerChartSourceRenderer(registry, { clock: CLOCK });
		const definition = createChartPanelKindDefinition({
			useCaseDeps: harness(),
			series: series(),
			renderer
		});

		expect(definition.defaultConfig()).toEqual(renderer.defaultConfig());
		const result = definition.validateConfig({ candle_type: 'not_a_real_candle_type' });
		expect(
			result.ok,
			'an invalid config must be rejected the same way the renderer rejects it'
		).toBe(false);
	});

	it('component() resolves to a real, invocable component loader (never the placeholder marker)', async () => {
		const registry = createSourceRendererRegistry();
		const renderer = registerChartSourceRenderer(registry, { clock: CLOCK });
		const definition = createChartPanelKindDefinition({
			useCaseDeps: harness(),
			series: series(),
			renderer
		});

		const loaded = await definition.component();
		expect(typeof loaded, 'a Svelte component compiles to a function').toBe('function');
	});

	it('sets the chart panel runtime deps singleton at registration time, before component() is called', () => {
		const registry = createSourceRendererRegistry();
		const renderer = registerChartSourceRenderer(registry, { clock: CLOCK });
		const useCaseDeps = harness();
		const chartSeries = series();

		createChartPanelKindDefinition({ useCaseDeps, series: chartSeries, renderer });

		const configured = getChartPanelRuntimeDeps();
		expect(configured.useCaseDeps).toBe(useCaseDeps);
		expect(configured.series).toBe(chartSeries);
	});
});

describe('getChartPanelRuntimeDeps', () => {
	it('throws a clear error when the chart panel kind was never registered', () => {
		expect(() => getChartPanelRuntimeDeps()).toThrow(/never configured/);
	});
});

describe('registerChartPanelKind', () => {
	it('registers the real definition into the given panel registry', () => {
		const sourceRendererRegistry = createSourceRendererRegistry();
		const renderer = registerChartSourceRenderer(sourceRendererRegistry, { clock: CLOCK });
		const panelRegistry = createPanelRegistry();

		registerChartPanelKind(panelRegistry, {
			useCaseDeps: harness(),
			series: createInMemoryChartSeries({ clock: CLOCK, series: [] }),
			renderer
		});

		expect(panelRegistry.has(CHART_PANEL_KIND)).toBe(true);
		expect(panelRegistry.require(CHART_PANEL_KIND).defaultRenderer).toBe(CHART_RENDERER_NAME);
	});
});
