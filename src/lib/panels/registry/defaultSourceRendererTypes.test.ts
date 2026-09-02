import { describe, expect, it } from 'vitest';
import { createSourceRendererRegistry } from './sourceRendererRegistry';
import { registerDefaultSourceRendererTypes } from './defaultSourceRendererTypes';

const EXPECTED_SOURCE_TYPES = ['screener_results', 'watchlist', 'symbol_list', 'panel_reference'];
const EXPECTED_RENDERER_TYPES = ['table', 'chart_grid', 'heatmap', 'scatter_plot'];

describe('registerDefaultSourceRendererTypes', () => {
	it('registers the four source types and four renderer types named in the tool spec', () => {
		const registry = createSourceRendererRegistry();
		registerDefaultSourceRendererTypes(registry);

		expect(
			registry.sourceTypeNames().sort(),
			`expected exactly the four spec source types, got ${JSON.stringify(registry.sourceTypeNames())}`
		).toEqual([...EXPECTED_SOURCE_TYPES].sort());
		expect(
			registry.rendererTypeNames().sort(),
			`expected exactly the four spec renderer types, got ${JSON.stringify(registry.rendererTypeNames())}`
		).toEqual([...EXPECTED_RENDERER_TYPES].sort());
	});

	it("chart_grid's config schema covers rows, columns, item count, pagination, shared studies, and chart settings", () => {
		const registry = createSourceRendererRegistry();
		registerDefaultSourceRendererTypes(registry);

		const chartGrid = registry.requireRendererType('chart_grid');
		const properties = (chartGrid.configSchema as { properties: Record<string, unknown> })
			.properties;

		for (const field of [
			'rows',
			'columns',
			'itemCount',
			'page',
			'pageSize',
			'sharedStudies',
			'chartSettings'
		]) {
			expect(
				properties[field],
				`expected chart_grid's configSchema to declare "${field}", got keys ${JSON.stringify(Object.keys(properties))}`
			).toBeDefined();
		}
	});

	it('gives every renderer type real, non-empty accepted source types', () => {
		const registry = createSourceRendererRegistry();
		registerDefaultSourceRendererTypes(registry);

		for (const name of EXPECTED_RENDERER_TYPES) {
			const renderer = registry.requireRendererType(name);
			expect(
				renderer.acceptedSourceTypes.length,
				`expected ${name} to declare at least one accepted source type`
			).toBeGreaterThan(0);
		}
	});

	it('validates screener_results against a compatible renderer via the real compatibility rule', () => {
		const registry = createSourceRendererRegistry();
		registerDefaultSourceRendererTypes(registry);

		const result = registry.validateSource({
			source: { type: 'screener_results', ref: { run_id: 'run_1' } },
			panelKind: 'results_table',
			renderer: 'table'
		});

		expect(
			result.ok,
			`expected screener_results to validate against table, got ${JSON.stringify(result)}`
		).toBe(true);
	});

	it('rejects panel_reference against scatter_plot and lists the renderers that do accept it', () => {
		const registry = createSourceRendererRegistry();
		registerDefaultSourceRendererTypes(registry);

		const result = registry.validateSource({
			source: { type: 'panel_reference', ref: { panel_id: 'panel_chart_1' } },
			panelKind: 'chart',
			renderer: 'scatter_plot'
		});

		expect(result.ok, 'expected panel_reference to be rejected by scatter_plot').toBe(false);
		expect(
			registry.renderersAcceptingSource('panel_reference'),
			'expected only chart_grid to accept panel_reference among the shipped renderers'
		).toEqual(['chart_grid']);
	});

	it('validates a symbol_list ref requiring the symbols field', () => {
		const registry = createSourceRendererRegistry();
		registerDefaultSourceRendererTypes(registry);

		const missing = registry.requireSourceType('symbol_list').validateRef({});
		expect(missing.ok, 'expected a symbol_list ref with no symbols to be rejected').toBe(false);

		const present = registry.requireSourceType('symbol_list').validateRef({ symbols: ['AAPL'] });
		expect(
			present.ok,
			`expected a well-formed symbol_list ref to validate, got ${JSON.stringify(present)}`
		).toBe(true);
	});

	it('migrates config from table to chart_grid, keeping recognized fields and reporting the rest as dropped', () => {
		const registry = createSourceRendererRegistry();
		registerDefaultSourceRendererTypes(registry);

		const migration = registry.migrateConfig({
			from: 'table',
			to: 'chart_grid',
			config: { sortBy: 'symbol', sortDirection: 'asc', pageSize: 20 }
		});

		expect(
			migration.config,
			'expected pageSize to carry over since chart_grid recognizes it'
		).toEqual({ pageSize: 20 });
		expect(
			migration.dropped,
			`expected table-only fields dropped, got ${JSON.stringify(migration.dropped)}`
		).toEqual(expect.arrayContaining(['sortBy', 'sortDirection']));
	});

	it("accepts each renderer's own defaultConfig() through its own validateConfig()", () => {
		const registry = createSourceRendererRegistry();
		registerDefaultSourceRendererTypes(registry);

		for (const name of EXPECTED_RENDERER_TYPES) {
			const renderer = registry.requireRendererType(name);
			const result = renderer.validateConfig(renderer.defaultConfig());
			expect(
				result.ok,
				`expected ${name}'s defaultConfig() to pass its own validateConfig(), got ${JSON.stringify(result)}`
			).toBe(true);
		}
	});

	// T-1010-7: a sibling epic's real renderer/source contract, registered
	// first into the same registry, must not be clobbered or rejected as a
	// duplicate -- this is what lets a composition root register the real
	// 'table'/'screener_results' contract and then still call this function
	// for the remaining three placeholder pairs.
	it('skips a renderer type that was already registered, rather than throwing a conflict', () => {
		const registry = createSourceRendererRegistry();
		registry.registerRendererType({
			name: 'table',
			configSchema: { type: 'object', properties: {} },
			validateConfig: () => ({ ok: true, value: {} }),
			defaultConfig: () => ({}),
			acceptedSourceTypes: ['screener_results']
		});

		expect(() => registerDefaultSourceRendererTypes(registry)).not.toThrow();

		expect(
			registry.requireRendererType('table').acceptedSourceTypes,
			'the already-registered real renderer type must survive, not be overwritten'
		).toEqual(['screener_results']);
		expect(registry.rendererTypeNames().sort()).toEqual([...EXPECTED_RENDERER_TYPES].sort());
	});

	it('skips a source type that was already registered, rather than throwing a conflict', () => {
		const registry = createSourceRendererRegistry();
		registry.registerSourceType({
			name: 'screener_results',
			refSchema: { type: 'object', properties: {} },
			validateRef: () => ({ ok: true, value: {} }),
			isCompatible: () => true,
			compatibilityDescription: 'real contract stand-in'
		});

		expect(() => registerDefaultSourceRendererTypes(registry)).not.toThrow();

		expect(
			registry.getSourceType('screener_results')?.compatibilityDescription,
			'the already-registered real source type must survive, not be overwritten'
		).toBe('real contract stand-in');
		expect(registry.sourceTypeNames().sort()).toEqual([...EXPECTED_SOURCE_TYPES].sort());
	});
});
