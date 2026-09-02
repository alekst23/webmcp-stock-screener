import { beforeEach, describe, expect, it } from 'vitest';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import type { OperationDefinition } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { createInMemoryChartSeries } from '../infra/inMemoryChartSeries';
import {
	buildChartRendererDefinition,
	buildChartTools,
	CHART_OPERATION_KINDS,
	CHART_RENDERER_NAME,
	CHART_SOURCE_TYPE,
	registerChartOperations,
	registerChartPanelContract,
	type ChartToolsDeps
} from './index';
import type {
	PanelContractRegistry,
	RendererTypeDefinition,
	SourceTypeDefinition
} from './chartRendererContract';

const NOW = '2026-09-02T20:00:00.000Z';
const clock: Clock = { now: () => NOW };

function deps(): ChartToolsDeps {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const ids = createIdSequencer();
	return {
		repository,
		revisions: createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		}),
		history: createChangeHistory(),
		registry: createOperationRegistry(),
		clock,
		ids,
		series: createInMemoryChartSeries({ clock, series: [] })
	};
}

function recordingRegistry() {
	const sources: SourceTypeDefinition[] = [];
	const renderers: RendererTypeDefinition[] = [];
	const registry: PanelContractRegistry = {
		registerSourceType: (definition) => void sources.push(definition),
		registerRendererType: (definition) => void renderers.push(definition)
	};
	return { registry, sources, renderers };
}

describe('buildChartTools', () => {
	let chartDeps: ChartToolsDeps;

	beforeEach(() => {
		chartDeps = deps();
	});

	it('returns exactly the three directly-registered chart tools', () => {
		const tools = buildChartTools(chartDeps);
		expect(tools.map((tool) => tool.name)).toEqual([
			'get_chart_data',
			'add_chart_annotation',
			'capture_chart_setup'
		]);
	});

	it('gives every tool a description and a schema, and makes it available', () => {
		for (const tool of buildChartTools(chartDeps)) {
			expect(tool.description.length, `${tool.name} has no description`).toBeGreaterThan(0);
			expect(tool.inputSchema, `${tool.name} has no input schema`).toBeTruthy();
			expect(tool.available({} as never), `${tool.name} is not available`).toBe(true);
		}
	});

	it('registers all five chart operations', () => {
		buildChartTools(chartDeps);
		expect(chartDeps.registry.kinds().sort()).toEqual([...CHART_OPERATION_KINDS].sort());
	});

	it('names the five operations under the chart namespace', () => {
		expect(CHART_OPERATION_KINDS).toEqual([
			'chart.bind_source',
			'chart.configure_view',
			'chart.edit_studies',
			'chart.add_annotation',
			'chart.capture_setup'
		]);
	});

	// AC7: the tool factories each carry an `ensure*` call for their own
	// operation so they work standalone. Registering up front has to win, or
	// the composition root's definition -- the one carrying the real clock and
	// catalog -- would be silently replaced by a lower layer's.
	it('constructs no operation a second time inside a tool factory', () => {
		registerChartOperations(chartDeps);
		const before = new Map<string, OperationDefinition | null>(
			CHART_OPERATION_KINDS.map((kind) => [kind, chartDeps.registry.get(kind)])
		);
		buildChartTools(chartDeps);
		for (const kind of CHART_OPERATION_KINDS) {
			expect(chartDeps.registry.get(kind), `${kind} was reconstructed`).toBe(before.get(kind));
		}
	});

	it('can be built twice against one registry without a duplicate-kind error', () => {
		buildChartTools(chartDeps);
		expect(() => buildChartTools(chartDeps)).not.toThrow();
		expect(chartDeps.registry.kinds()).toHaveLength(CHART_OPERATION_KINDS.length);
	});

	it('builds three distinct tool instances per call rather than sharing one', () => {
		const first = buildChartTools(chartDeps);
		const second = buildChartTools(chartDeps);
		expect(first[0]).not.toBe(second[0]);
		expect(new Set(first.map((tool) => tool.name)).size).toBe(3);
	});
});

describe('the chart renderer contract', () => {
	let chartDeps: ChartToolsDeps;

	beforeEach(() => {
		chartDeps = deps();
	});

	it('composes one renderer rather than leaving two partial ones', () => {
		const renderer = buildChartRendererDefinition(chartDeps);
		expect(renderer.name).toBe(CHART_RENDERER_NAME);
		expect(renderer.name).toBe('chart_grid');
		expect(renderer.acceptedSourceTypes).toEqual([CHART_SOURCE_TYPE]);
	});

	it('merges both halves of the config schema', () => {
		const renderer = buildChartRendererDefinition(chartDeps);
		const properties = (renderer.configSchema as { properties: Record<string, unknown> })
			.properties;
		expect(Object.keys(properties).sort()).toEqual([
			'candle_type',
			'price_adjustment',
			'scale',
			'session',
			'studies'
		]);
	});

	it('merges both halves of the default config', () => {
		const defaults = buildChartRendererDefinition(chartDeps).defaultConfig();
		expect(defaults).toEqual({
			candle_type: 'candlestick',
			scale: 'linear',
			session: 'regular',
			price_adjustment: 'adjusted',
			studies: []
		});
	});

	// The view half rejects keys it does not own, so an uncomposed fold would
	// have the renderer reject the very config it hands out as its default.
	it('accepts its own default config', () => {
		const renderer = buildChartRendererDefinition(chartDeps);
		expect(renderer.validateConfig(renderer.defaultConfig())).toEqual([]);
	});

	it('reports the issues of both halves from one call', () => {
		const renderer = buildChartRendererDefinition(chartDeps);
		const issues = renderer.validateConfig({
			scale: 'sideways',
			studies: [
				{
					id: 'study_1',
					catalog_item_id: 'study.nope',
					params: {},
					pane: 'sub_pane',
					order: 0,
					enabled: true
				}
			]
		});
		expect(issues.join(' ')).toContain('scale');
		expect(issues.join(' ')).toContain('study.nope');
	});

	it('still rejects a source property offered as a view property', () => {
		const renderer = buildChartRendererDefinition(chartDeps);
		expect(renderer.validateConfig({ timeframe: '1d' }).join(' ')).toContain('source property');
	});

	it('registers one source type and one renderer through a single call', () => {
		const { registry, sources, renderers } = recordingRegistry();
		registerChartPanelContract(registry, chartDeps);
		expect(sources).toHaveLength(1);
		expect(renderers).toHaveLength(1);
		expect(sources[0]?.name).toBe(CHART_SOURCE_TYPE);
		expect(renderers[0]?.name).toBe(CHART_RENDERER_NAME);
	});

	it('registers the composed renderer, not the view half alone', () => {
		const { registry, renderers } = recordingRegistry();
		registerChartPanelContract(registry, chartDeps);
		const properties = (renderers[0]!.configSchema as { properties: Record<string, unknown> })
			.properties;
		expect(Object.keys(properties)).toContain('studies');
	});

	it('accepts a chart panel drawn by the chart renderer and nothing else', () => {
		const { registry, sources } = recordingRegistry();
		registerChartPanelContract(registry, chartDeps);
		const source = sources[0]!;
		expect(source.acceptsPanel('chart', CHART_RENDERER_NAME)).toBe(true);
		expect(source.acceptsPanel('screener', CHART_RENDERER_NAME)).toBe(false);
		expect(source.acceptsPanel('chart', 'table')).toBe(false);
	});

	it('validates a source reference through the same rules the operation uses', () => {
		const { registry, sources } = recordingRegistry();
		registerChartPanelContract(registry, chartDeps);
		const issues = sources[0]!.validateReference({ instrument: { instrument_id: 'AAPL' } });
		expect(issues.length).toBeGreaterThan(0);
		expect(issues.join(' ')).toContain('instrument');
	});
});
