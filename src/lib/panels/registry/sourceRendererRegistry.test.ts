import { describe, expect, it } from 'vitest';
import {
	createSourceRendererRegistry,
	RendererTypeConflictError,
	SourceTypeConflictError,
	UnknownRendererTypeError,
	UnknownSourceTypeError,
	type ConfigValidation,
	type RendererTypeDefinition,
	type SourceTypeDefinition
} from './sourceRendererRegistry';

// A fictional source type and renderer type defined entirely in this test
// file -- registering and exercising them must require no edit to any file
// in this ticket. This is the AC16 extensibility evidence for the
// source/renderer registry (mirrored for the panel-kind registry in
// panelKindRegistry.test.ts).
function makeFringeSignalSource(): SourceTypeDefinition {
	return {
		name: 'fringe_signal',
		refSchema: { type: 'object', properties: { signal_id: { type: 'string' } } },
		validateRef: (ref: unknown): ConfigValidation<Record<string, unknown>> => {
			if (
				typeof ref !== 'object' ||
				ref === null ||
				typeof (ref as { signal_id?: unknown }).signal_id !== 'string'
			) {
				return { ok: false, errors: [{ field: 'signal_id', reason: 'is required' }] };
			}
			return { ok: true, value: ref as Record<string, unknown> };
		},
		isCompatible: ({ renderer }) => renderer === null || renderer === 'sparkbars',
		compatibilityDescription: 'Accepted only by the sparkbars renderer.'
	};
}

function makeSparkbarsRenderer(): RendererTypeDefinition {
	return {
		name: 'sparkbars',
		configSchema: { type: 'object', properties: { barCount: { type: 'number' } } },
		validateConfig: (input: unknown): ConfigValidation<Record<string, unknown>> => {
			if (typeof input !== 'object' || input === null) {
				return { ok: false, errors: [{ field: '$', reason: 'must be an object' }] };
			}
			return { ok: true, value: input as Record<string, unknown> };
		},
		defaultConfig: () => ({ barCount: 12 }),
		acceptedSourceTypes: ['fringe_signal']
	};
}

function makeMinimalSource(name: string, acceptEverything = true): SourceTypeDefinition {
	return {
		name,
		refSchema: { type: 'object', properties: {} },
		validateRef: () => ({ ok: true, value: {} }),
		isCompatible: () => acceptEverything,
		compatibilityDescription: `Test source type "${name}".`
	};
}

function makeMinimalRenderer(
	name: string,
	acceptedSourceTypes: string[] = []
): RendererTypeDefinition {
	return {
		name,
		configSchema: { type: 'object', properties: { label: { type: 'string' } } },
		validateConfig: () => ({ ok: true, value: {} }),
		defaultConfig: () => ({}),
		acceptedSourceTypes
	};
}

describe('createSourceRendererRegistry: isolation', () => {
	it('never touches the module-global registry, a sibling instance, or the panel-kind registry', async () => {
		const { sourceRendererRegistry: globalRegistry } = await import('./sourceRendererRegistry');
		const registryA = createSourceRendererRegistry();
		const registryB = createSourceRendererRegistry();

		registryA.registerSourceType(makeMinimalSource('isolated_source'));
		registryA.registerRendererType(makeMinimalRenderer('isolated_renderer'));

		expect(
			registryA.getSourceType('isolated_source'),
			'expected registryA to have its own source registration'
		).toBeDefined();
		expect(
			registryB.getSourceType('isolated_source'),
			'expected a sibling isolated registry to be unaffected'
		).toBeUndefined();
		expect(
			globalRegistry.getSourceType('isolated_source'),
			'expected the module-global registry to be unaffected by an isolated registry'
		).toBeUndefined();
	});
});

describe('registerSourceType / registerRendererType: conflicts', () => {
	it('reports a conflict rather than silently replacing a duplicate source type', () => {
		const registry = createSourceRendererRegistry();
		registry.registerSourceType(makeMinimalSource('watchlist'));

		expect(
			() => registry.registerSourceType(makeMinimalSource('watchlist', false)),
			'expected a second registration under the same source type name to throw'
		).toThrow(SourceTypeConflictError);

		expect(
			registry.getSourceType('watchlist')?.isCompatible({ panelKind: 'chart', renderer: null }),
			'expected the original registration to survive the rejected duplicate'
		).toBe(true);
	});

	it('reports a conflict rather than silently replacing a duplicate renderer type', () => {
		const registry = createSourceRendererRegistry();
		registry.registerRendererType(makeMinimalRenderer('table', ['watchlist']));

		expect(
			() => registry.registerRendererType(makeMinimalRenderer('table', [])),
			'expected a second registration under the same renderer type name to throw'
		).toThrow(RendererTypeConflictError);

		expect(
			registry.getRendererType('table')?.acceptedSourceTypes,
			'expected the original registration to survive the rejected duplicate'
		).toEqual(['watchlist']);
	});
});

describe('requireSourceType / requireRendererType: unknown name lookup', () => {
	it('requireSourceType throws UnknownSourceTypeError listing every registered source type', () => {
		const registry = createSourceRendererRegistry();
		registry.registerSourceType(makeMinimalSource('watchlist'));
		registry.registerSourceType(makeMinimalSource('symbol_list'));

		let caught: unknown;
		try {
			registry.requireSourceType('does_not_exist');
		} catch (error) {
			caught = error;
		}

		expect(caught, 'expected requireSourceType to throw for an unregistered name').toBeInstanceOf(
			UnknownSourceTypeError
		);
		const error = caught as UnknownSourceTypeError;
		expect(error.sourceType, 'expected the error to name the requested source type').toBe(
			'does_not_exist'
		);
		expect(
			error.registeredTypes,
			`expected every registered source type listed, got ${JSON.stringify(error.registeredTypes)}`
		).toEqual(expect.arrayContaining(['watchlist', 'symbol_list']));
	});

	it('requireRendererType throws UnknownRendererTypeError listing every registered renderer type', () => {
		const registry = createSourceRendererRegistry();
		registry.registerRendererType(makeMinimalRenderer('table'));

		let caught: unknown;
		try {
			registry.requireRendererType('does_not_exist');
		} catch (error) {
			caught = error;
		}

		expect(caught, 'expected requireRendererType to throw for an unregistered name').toBeInstanceOf(
			UnknownRendererTypeError
		);
		const error = caught as UnknownRendererTypeError;
		expect(error.renderer, 'expected the error to name the requested renderer').toBe(
			'does_not_exist'
		);
		expect(
			error.registeredTypes,
			`expected every registered renderer type listed, got ${JSON.stringify(error.registeredTypes)}`
		).toEqual(['table']);
	});
});

describe('validateSource', () => {
	it('returns a validated PanelSourceRef for a compatible, well-formed source', () => {
		const registry = createSourceRendererRegistry();
		registry.registerRendererType(makeSparkbarsRenderer());
		registry.registerSourceType(makeFringeSignalSource());

		const result = registry.validateSource({
			source: { type: 'fringe_signal', ref: { signal_id: 'sig_1' } },
			panelKind: 'chart',
			renderer: 'sparkbars'
		});

		expect(result.ok, `expected ok validation, got ${JSON.stringify(result)}`).toBe(true);
		if (result.ok) {
			expect(result.value, 'expected the validated source ref to carry the type and ref').toEqual({
				type: 'fringe_signal',
				ref: { signal_id: 'sig_1' }
			});
		}
	});

	it('rejects an incompatible source type and lists the accepted source types', () => {
		const registry = createSourceRendererRegistry();
		registry.registerRendererType(makeSparkbarsRenderer());
		registry.registerRendererType(makeMinimalRenderer('table', ['watchlist']));
		registry.registerSourceType(makeFringeSignalSource());
		registry.registerSourceType(makeMinimalSource('watchlist'));

		const result = registry.validateSource({
			source: { type: 'fringe_signal', ref: { signal_id: 'sig_1' } },
			panelKind: 'results_table',
			renderer: 'table'
		});

		expect(result.ok, 'expected an incompatible source type to be rejected').toBe(false);
		if (!result.ok) {
			expect(
				result.acceptedSourceTypes,
				`expected only compatible source types listed, got ${JSON.stringify(result.acceptedSourceTypes)}`
			).toEqual(['watchlist']);
			expect(result.errors[0]?.field, 'expected the error to name the source type field').toBe(
				'source.type'
			);
		}
	});

	it('rejects an unknown source type and still lists what is accepted', () => {
		const registry = createSourceRendererRegistry();
		registry.registerRendererType(makeMinimalRenderer('table', ['watchlist']));
		registry.registerSourceType(makeMinimalSource('watchlist'));

		const result = registry.validateSource({
			source: { type: 'not_registered', ref: {} },
			panelKind: 'results_table',
			renderer: 'table'
		});

		expect(result.ok, 'expected an unregistered source type to be rejected').toBe(false);
		if (!result.ok) {
			expect(result.errors[0]?.reason, 'expected the error to name the unknown type').toContain(
				'not_registered'
			);
			expect(
				result.acceptedSourceTypes,
				'expected the accepted list even when the requested type is unknown'
			).toEqual(['watchlist']);
		}
	});

	it('rejects a malformed source reference before checking compatibility', () => {
		const registry = createSourceRendererRegistry();
		registry.registerRendererType(makeMinimalRenderer('table', ['watchlist']));
		registry.registerSourceType(makeMinimalSource('watchlist'));

		const result = registry.validateSource({
			source: 'not-an-object',
			panelKind: 'results_table',
			renderer: 'table'
		});

		expect(result.ok, 'expected a malformed source to be rejected').toBe(false);
	});

	it('propagates validateRef errors for a compatible but invalid ref', () => {
		const registry = createSourceRendererRegistry();
		registry.registerRendererType(makeSparkbarsRenderer());
		registry.registerSourceType(makeFringeSignalSource());

		const result = registry.validateSource({
			source: { type: 'fringe_signal', ref: {} },
			panelKind: 'chart',
			renderer: 'sparkbars'
		});

		expect(result.ok, 'expected a ref missing its required field to be rejected').toBe(false);
		if (!result.ok) {
			expect(result.errors[0]?.field, 'expected the validateRef error field to propagate').toBe(
				'signal_id'
			);
		}
	});
});

describe('validateRendererConfig', () => {
	it('returns validated configuration for accepted input, matching the kind registry error shape', () => {
		const registry = createSourceRendererRegistry();
		registry.registerRendererType(makeSparkbarsRenderer());

		const result = registry.validateRendererConfig('sparkbars', { barCount: 20 });
		expect(result.ok, `expected ok validation, got ${JSON.stringify(result)}`).toBe(true);
	});

	it('throws UnknownRendererTypeError for an unregistered renderer name', () => {
		const registry = createSourceRendererRegistry();
		expect(
			() => registry.validateRendererConfig('does_not_exist', {}),
			'expected validation against an unregistered renderer to throw'
		).toThrow(UnknownRendererTypeError);
	});
});

describe('migrateConfig', () => {
	it('carries recognized fields over and drops+reports the rest', () => {
		const registry = createSourceRendererRegistry();
		registry.registerRendererType(makeMinimalRenderer('old_renderer'));
		registry.registerRendererType({
			name: 'new_renderer',
			configSchema: {
				type: 'object',
				properties: { label: { type: 'string' }, count: { type: 'number' } }
			},
			validateConfig: () => ({ ok: true, value: {} }),
			defaultConfig: () => ({ label: '', count: 0 }),
			acceptedSourceTypes: []
		});

		const migration = registry.migrateConfig({
			from: 'old_renderer',
			to: 'new_renderer',
			config: { label: 'kept', legacyOnly: 'dropped-me' }
		});

		expect(migration.config, 'expected the recognized field to carry over').toEqual({
			label: 'kept'
		});
		expect(migration.dropped, 'expected the unrecognized field to be reported as dropped').toEqual([
			'legacyOnly'
		]);
	});

	it('reports every field dropped when the new renderer recognizes none of them', () => {
		const registry = createSourceRendererRegistry();
		registry.registerRendererType(makeMinimalRenderer('bare_renderer'));
		// makeMinimalRenderer's schema declares only "label".
		const migration = registry.migrateConfig({
			from: null,
			to: 'bare_renderer',
			config: { unrelatedA: 1, unrelatedB: 2 }
		});

		expect(migration.config, 'expected no fields to carry over').toEqual({});
		expect(
			migration.dropped,
			`expected both fields dropped, got ${JSON.stringify(migration.dropped)}`
		).toEqual(expect.arrayContaining(['unrelatedA', 'unrelatedB']));
	});
});

describe('renderersAcceptingSource', () => {
	it('lists every renderer whose acceptedSourceTypes includes the given source type', () => {
		const registry = createSourceRendererRegistry();
		registry.registerRendererType(makeMinimalRenderer('table', ['watchlist', 'symbol_list']));
		registry.registerRendererType(makeMinimalRenderer('heatmap', ['watchlist']));
		registry.registerRendererType(makeMinimalRenderer('scatter_plot', ['symbol_list']));

		const accepting = registry.renderersAcceptingSource('watchlist');
		expect(
			accepting,
			`expected table and heatmap to accept watchlist, got ${JSON.stringify(accepting)}`
		).toEqual(expect.arrayContaining(['table', 'heatmap']));
		expect(accepting, 'expected scatter_plot not to accept watchlist').not.toContain(
			'scatter_plot'
		);
	});
});

describe('AC16 extensibility: a fictional source and renderer type plug in without editing this file', () => {
	it('supports lookup, list, validateSource, validateRendererConfig, migrateConfig, and compatibility', () => {
		const registry = createSourceRendererRegistry();
		const source = makeFringeSignalSource();
		const renderer = makeSparkbarsRenderer();

		registry.registerRendererType(renderer);
		registry.registerSourceType(source);

		expect(
			registry.getSourceType('fringe_signal'),
			'expected lookup to find the fictional source'
		).toBe(source);
		expect(
			registry.getRendererType('sparkbars'),
			'expected lookup to find the fictional renderer'
		).toBe(renderer);
		expect(
			registry.sourceTypeNames(),
			'expected the fictional source type in the name list'
		).toContain('fringe_signal');
		expect(
			registry.rendererTypeNames(),
			'expected the fictional renderer type in the name list'
		).toContain('sparkbars');

		const validated = registry.validateSource({
			source: { type: 'fringe_signal', ref: { signal_id: 'sig_9' } },
			panelKind: 'chart',
			renderer: 'sparkbars'
		});
		expect(validated.ok, 'expected the fictional source to validate against its own renderer').toBe(
			true
		);

		const configValidation = registry.validateRendererConfig('sparkbars', { barCount: 5 });
		expect(configValidation.ok, 'expected the fictional renderer config to validate').toBe(true);

		const migration = registry.migrateConfig({
			from: null,
			to: 'sparkbars',
			config: { barCount: 5, unknownField: true }
		});
		expect(migration.config, 'expected the recognized field to carry over').toEqual({
			barCount: 5
		});
		expect(migration.dropped, 'expected the unrecognized field to be dropped').toEqual([
			'unknownField'
		]);

		expect(
			registry.renderersAcceptingSource('fringe_signal'),
			'expected sparkbars to accept fringe_signal'
		).toEqual(['sparkbars']);
	});
});
