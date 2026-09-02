import { describe, expect, it } from 'vitest';
import type { Clock } from '../../domain/ports';
import { createChartBindSourceOperation } from '../application/chartSource';
import type { InstrumentAvailability } from '../application/chartSource';
import { defaultChartViewConfig } from '../application/chartView';
import type { InstrumentRef } from '../domain/instrument';
import {
	chartRendererTypeDefinition,
	chartSourceTypeDefinition,
	createChartSourceTypeDefinition,
	registerChartRendererContract,
	CHART_RENDERER_NAME,
	CHART_SOURCE_TYPE,
	type PanelContractRegistry,
	type RendererTypeDefinition,
	type SourceTypeDefinition
} from './chartRendererContract';

const AAPL: InstrumentRef = {
	instrumentId: 'inst:XNAS:AAPL',
	symbol: 'AAPL',
	exchange: 'XNAS',
	assetType: 'equity'
};

const clock: Clock = { now: () => '2026-06-01T00:00:00.000Z' };

function recordingRegistry(): PanelContractRegistry & {
	sources: SourceTypeDefinition[];
	renderers: RendererTypeDefinition[];
} {
	const sources: SourceTypeDefinition[] = [];
	const renderers: RendererTypeDefinition[] = [];
	return {
		sources,
		renderers,
		registerSourceType: (definition) => void sources.push(definition),
		registerRendererType: (definition) => void renderers.push(definition)
	};
}

const emptyAvailability: InstrumentAvailability = {
	isKnownInstrument: () => false,
	dataWindow: () => null
};

describe('chart renderer and source names', () => {
	it('claims the names the panel registry assigns this epic', () => {
		expect(CHART_RENDERER_NAME).toBe('chart_grid');
		expect(CHART_SOURCE_TYPE).toBe('instrument');
	});
});

describe('registerChartRendererContract', () => {
	it('registers both halves through one call', () => {
		const registry = recordingRegistry();
		registerChartRendererContract(registry);
		expect(registry.sources.map((s) => s.name)).toEqual([CHART_SOURCE_TYPE]);
		expect(registry.renderers.map((r) => r.name)).toEqual([CHART_RENDERER_NAME]);
	});

	it('passes the availability oracle through to the registered source validator', () => {
		const registry = recordingRegistry();
		registerChartRendererContract(registry, { availability: emptyAvailability, clock });
		const issues = registry.sources[0]?.validateReference({ instrument: AAPL }) ?? [];
		expect(issues[0]).toContain('is not a known instrument');
	});

	it('never mutates a workspace: the registry validates, the operations apply', () => {
		const registry = recordingRegistry();
		registerChartRendererContract(registry);
		const definition = registry.sources[0]!;
		expect(Object.keys(definition).sort()).toEqual([
			'acceptsPanel',
			'name',
			'schema',
			'validateReference'
		]);
	});
});

describe('chart source type definition', () => {
	it('accepts a chart panel drawn by the chart renderer', () => {
		expect(chartSourceTypeDefinition.acceptsPanel('chart', CHART_RENDERER_NAME)).toBe(true);
	});

	it('refuses a panel kind that is not a chart', () => {
		expect(chartSourceTypeDefinition.acceptsPanel('results_table', CHART_RENDERER_NAME)).toBe(
			false
		);
	});

	it('refuses another renderer, which has no use for an instrument reference', () => {
		expect(chartSourceTypeDefinition.acceptsPanel('chart', 'table_grid')).toBe(false);
	});

	it('validates a reference through the same rule the bind operation validates with', () => {
		const fromRegistry = chartSourceTypeDefinition.validateReference({ instrument: 'AAPL' });
		const fromOperation = createChartBindSourceOperation().validate(
			{ panelId: 'panel_chart_1', instrument: 'AAPL' } as never,
			{
				id: 'workspace_1',
				name: '',
				revision: 1,
				createdAt: '',
				updatedAt: '',
				panels: [
					{
						id: 'panel_chart_1',
						kind: 'chart',
						title: '',
						collapsed: false,
						visible: true,
						boundResourceId: null,
						config: {}
					}
				],
				layout: [],
				links: [],
				activeSymbol: null,
				activePanelId: null,
				screenerId: null,
				extensions: {}
			}
		);
		expect(fromRegistry).toEqual(fromOperation);
	});

	it('advertises a schema that names the instrument as an ID', () => {
		expect(JSON.stringify(chartSourceTypeDefinition.schema)).toContain('never by ticker');
	});

	it('is deps-free by default, so a reference validates before any oracle is wired up', () => {
		expect(createChartSourceTypeDefinition().validateReference({ instrument: AAPL })).toEqual([]);
	});
});

describe('chart renderer type definition', () => {
	it('renders only from the chart source type', () => {
		expect(chartRendererTypeDefinition.acceptedSourceTypes).toEqual([CHART_SOURCE_TYPE]);
	});

	it('hands back a complete default configuration', () => {
		expect(chartRendererTypeDefinition.defaultConfig()).toEqual(defaultChartViewConfig());
	});

	it('validates a config through the same rule the view operation validates with', () => {
		expect(chartRendererTypeDefinition.validateConfig({ candle_type: 'renko' })[0]).toContain(
			'candle_type: "renko" is not permitted'
		);
	});

	it('advertises a config schema stating that the adjustment policy moves every price', () => {
		expect(JSON.stringify(chartRendererTypeDefinition.configSchema)).toContain(
			'restates every downstream price'
		);
	});

	it('rejects a source property offered as renderer config', () => {
		expect(chartRendererTypeDefinition.validateConfig({ instrument: AAPL })[0]).toContain(
			'is a chart source property'
		);
	});
});
