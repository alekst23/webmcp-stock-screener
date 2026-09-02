import { describe, expect, it } from 'vitest';
import { createPanelRegistry } from './panelKindRegistry';
import { registerDefaultPanelKinds } from './defaultPanelKinds';
import { GRID_COLUMNS, GRID_ROWS } from '../domain/grid';
import type { PanelLinkChannel } from '../domain/channels';

const EXPECTED_KINDS = [
	'filter_builder',
	'chart',
	'study_library',
	'results_table',
	'similar_opportunities',
	'watchlist',
	'alerts',
	'symbol_details'
];

// The default kind -> link channel matrix, reproduced exactly from
// docs/design/panel-system/technical.md, so this test fails the moment the
// registration drifts from the design doc.
const EXPECTED_CHANNELS: Record<string, PanelLinkChannel[]> = {
	filter_builder: ['filters'],
	chart: ['symbol', 'timeframe', 'result_selection', 'crosshair'],
	study_library: ['symbol'],
	results_table: ['symbol', 'result_selection', 'filters'],
	similar_opportunities: ['symbol', 'timeframe', 'result_selection'],
	watchlist: ['symbol', 'result_selection'],
	alerts: ['symbol'],
	symbol_details: ['symbol']
};

describe('registerDefaultPanelKinds', () => {
	it('registers all eight kinds from the tool spec', () => {
		const registry = createPanelRegistry();
		registerDefaultPanelKinds(registry);

		const names = registry.names().sort();
		expect(names, `expected exactly the eight spec kinds, got ${JSON.stringify(names)}`).toEqual(
			[...EXPECTED_KINDS].sort()
		);
	});

	it('gives every kind the exact link channels from the technical design matrix', () => {
		const registry = createPanelRegistry();
		registerDefaultPanelKinds(registry);

		for (const kind of EXPECTED_KINDS) {
			const definition = registry.require(kind);
			expect(
				definition.linkChannels,
				`expected ${kind}'s link channels to match the matrix, got ${JSON.stringify(definition.linkChannels)}`
			).toEqual(EXPECTED_CHANNELS[kind]);
		}
	});

	it('gives every kind a default size and minimum size that fit inside the fixed grid', () => {
		const registry = createPanelRegistry();
		registerDefaultPanelKinds(registry);

		for (const kind of EXPECTED_KINDS) {
			const definition = registry.require(kind);
			expect(
				definition.defaultSize.colSpan,
				`expected ${kind}'s defaultSize.colSpan within the grid`
			).toBeLessThanOrEqual(GRID_COLUMNS);
			expect(
				definition.defaultSize.rowSpan,
				`expected ${kind}'s defaultSize.rowSpan within the grid`
			).toBeLessThanOrEqual(GRID_ROWS);
			expect(
				definition.minSize.colSpan,
				`expected ${kind}'s minSize.colSpan no larger than its defaultSize.colSpan`
			).toBeLessThanOrEqual(definition.defaultSize.colSpan);
			expect(
				definition.minSize.rowSpan,
				`expected ${kind}'s minSize.rowSpan no larger than its defaultSize.rowSpan`
			).toBeLessThanOrEqual(definition.defaultSize.rowSpan);
		}
	});

	it('gives every kind a real, non-empty config schema', () => {
		const registry = createPanelRegistry();
		registerDefaultPanelKinds(registry);

		for (const kind of EXPECTED_KINDS) {
			const definition = registry.require(kind);
			const schema = definition.configSchema as { type?: string; properties?: object };
			expect(schema.type, `expected ${kind}'s configSchema to declare type "object"`).toBe(
				'object'
			);
			expect(
				schema.properties,
				`expected ${kind}'s configSchema to declare properties`
			).toBeTruthy();
		}
	});

	it('leaves filter_builder with no binding types since it is not data-bound', () => {
		const registry = createPanelRegistry();
		registerDefaultPanelKinds(registry);

		expect(
			registry.require('filter_builder').bindingTypes,
			'expected filter_builder to declare no binding types'
		).toEqual([]);
	});

	it('gives every data-bound kind at least one binding type', () => {
		const registry = createPanelRegistry();
		registerDefaultPanelKinds(registry);

		for (const kind of EXPECTED_KINDS) {
			if (kind === 'filter_builder') {
				continue;
			}
			const definition = registry.require(kind);
			expect(
				definition.bindingTypes.length,
				`expected ${kind} to declare at least one binding type`
			).toBeGreaterThan(0);
		}
	});

	it('provides a component loader that never resolves a Svelte component from domain/registry code', async () => {
		const registry = createPanelRegistry();
		registerDefaultPanelKinds(registry);

		const chart = registry.require('chart');
		const body = await chart.component();
		expect(body, 'expected a placeholder marker object, not a component').toEqual({
			placeholderKind: 'chart'
		});
	});

	it('rejects an unrecognized config field via the provisional validator', () => {
		const registry = createPanelRegistry();
		registerDefaultPanelKinds(registry);

		const result = registry.require('alerts').validateConfig({ notARealField: true });
		expect(result.ok, 'expected an unrecognized field to be rejected').toBe(false);
		if (!result.ok) {
			expect(result.errors[0]?.field, 'expected the error to name the rejected field').toBe(
				'notARealField'
			);
		}
	});

	it("accepts each kind's own defaultConfig() through its own validateConfig()", () => {
		const registry = createPanelRegistry();
		registerDefaultPanelKinds(registry);

		for (const kind of EXPECTED_KINDS) {
			const definition = registry.require(kind);
			const result = definition.validateConfig(definition.defaultConfig());
			expect(
				result.ok,
				`expected ${kind}'s defaultConfig() to pass its own validateConfig(), got ${JSON.stringify(result)}`
			).toBe(true);
		}
	});
});
