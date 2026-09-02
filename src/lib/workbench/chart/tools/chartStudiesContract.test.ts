import { describe, expect, it } from 'vitest';
import type { StudyInstance } from '../domain/studies';
import {
	CHART_STUDIES_CONFIG_KEY,
	chartStudiesViewContribution,
	composeRendererWithStudies,
	defaultChartStudiesConfig,
	registerChartStudiesContract,
	validateChartStudiesConfig,
	type RendererTypeDefinition
} from './chartStudiesContract';

function study(overrides: Partial<StudyInstance> = {}): StudyInstance {
	return {
		id: 'study_1',
		catalogItemId: 'study.sma',
		params: { length: 20 },
		pane: 'price_overlay',
		order: 0,
		enabled: true,
		...overrides
	};
}

// Stands in for the view/source half of the same renderer, which a sibling
// module owns; only its shape matters here.
function baseRenderer(): RendererTypeDefinition {
	return {
		name: 'chart_grid',
		configSchema: { type: 'object', properties: { timeframe: { type: 'string' } } },
		validateConfig: (config) =>
			(config as { timeframe?: unknown })?.timeframe === undefined ? ['timeframe: required.'] : [],
		defaultConfig: () => ({ timeframe: '1d' }),
		acceptedSourceTypes: ['instrument']
	};
}

describe('validateChartStudiesConfig', () => {
	it('accepts a config that sets no studies at all', () => {
		expect(validateChartStudiesConfig({ timeframe: '1d' })).toEqual([]);
	});

	it('accepts a well-formed study on the pane the catalog places it', () => {
		expect(validateChartStudiesConfig({ timeframe: '1d', studies: [study()] })).toEqual([]);
	});

	it('rejects a studies value that is not an array', () => {
		const issues = validateChartStudiesConfig({ studies: 'sma' });
		expect(issues[0]).toContain('expected an array');
	});

	it('rejects a study stored on a pane the catalog does not place it on', () => {
		const issues = validateChartStudiesConfig({ studies: [study({ pane: 'sub_pane' })] });
		expect(issues[0]).toContain('studies[0].pane');
		expect(issues[0]).toContain('price_overlay');
	});

	it('rejects a parameter outside the catalog range, naming the parameter', () => {
		const issues = validateChartStudiesConfig({ studies: [study({ params: { length: 9_999 } })] });
		expect(issues[0]).toContain('length');
		expect(issues[0]).toContain('9999');
	});

	it('rejects an unknown catalog item and points at catalog search', () => {
		const issues = validateChartStudiesConfig({
			studies: [study({ catalogItemId: 'study.nope' })]
		});
		expect(issues[0]).toContain('search_catalog');
	});

	it('checks availability against the timeframe the view half of the config carries', () => {
		const issues = validateChartStudiesConfig({ timeframe: '1h', studies: [study()] });
		expect(issues[0]).toContain('1h');
	});

	it('skips the timeframe check when the config does not carry one', () => {
		expect(validateChartStudiesConfig({ studies: [study()] })).toEqual([]);
	});

	it('rejects a study whose stored id is not a string', () => {
		const issues = validateChartStudiesConfig({
			studies: [{ ...study(), id: 7 } as unknown as StudyInstance]
		});
		expect(issues[0]).toContain('studies[0].id');
	});

	it('rejects two instances sharing an id', () => {
		const issues = validateChartStudiesConfig({
			studies: [study(), study({ catalogItemId: 'study.ema', order: 1 })]
		});
		expect(issues.some((i) => i.includes('appears more than once'))).toBe(true);
	});

	it('accepts the wire spelling of the one multi-word key', () => {
		const wire = {
			id: 'study_1',
			catalog_item_id: 'study.sma',
			params: { length: 20 },
			pane: 'price_overlay',
			order: 0,
			enabled: true
		};
		expect(validateChartStudiesConfig({ studies: [wire] })).toEqual([]);
	});
});

describe('defaultChartStudiesConfig', () => {
	it('states an empty study list rather than leaving it implied', () => {
		expect(defaultChartStudiesConfig()).toEqual({ [CHART_STUDIES_CONFIG_KEY]: [] });
	});
});

describe('chartStudiesViewContribution', () => {
	it('is a self-contained contract half naming the config key it owns', () => {
		expect(chartStudiesViewContribution.key).toBe('studies');
		expect(chartStudiesViewContribution.validateConfig({ studies: [study()] })).toEqual([]);
		expect(chartStudiesViewContribution.defaultConfig()).toEqual({ studies: [] });
	});
});

describe('composeRendererWithStudies', () => {
	it('keeps the base renderer name and accepted source types', () => {
		const composed = composeRendererWithStudies(baseRenderer());
		expect(composed.name).toBe('chart_grid');
		expect(composed.acceptedSourceTypes).toEqual(['instrument']);
	});

	it('merges both halves of the config schema', () => {
		const composed = composeRendererWithStudies(baseRenderer());
		const properties = (composed.configSchema as { properties: Record<string, unknown> })
			.properties;
		expect(Object.keys(properties).sort()).toEqual(['studies', 'timeframe']);
	});

	it('reports the issues of both halves together', () => {
		const composed = composeRendererWithStudies(baseRenderer());
		const issues = composed.validateConfig({ studies: [study({ pane: 'sub_pane' })] });
		expect(issues).toHaveLength(2);
		expect(issues[0]).toContain('timeframe');
		expect(issues[1]).toContain('pane');
	});

	it('merges both halves of the default config', () => {
		expect(composeRendererWithStudies(baseRenderer()).defaultConfig()).toEqual({
			timeframe: '1d',
			studies: []
		});
	});
});

describe('registerChartStudiesContract', () => {
	it('registers the composed renderer in a single call', () => {
		const registered: RendererTypeDefinition[] = [];
		const composed = registerChartStudiesContract(
			{ registerRenderer: (definition) => registered.push(definition) },
			baseRenderer()
		);
		expect(registered).toEqual([composed]);
		expect(registered[0]?.defaultConfig()).toEqual({ timeframe: '1d', studies: [] });
	});
});
