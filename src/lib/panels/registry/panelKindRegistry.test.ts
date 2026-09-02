import { describe, expect, it } from 'vitest';
import {
	createPanelRegistry,
	PanelKindConflictError,
	UnknownPanelKindError,
	type ConfigValidation,
	type PanelKindDefinition
} from './panelKindRegistry';
import type { GridSize } from '../domain/grid';

const SIZE: GridSize = { colSpan: 2, rowSpan: 2 };

interface FringeConfig extends Record<string, unknown> {
	threshold: number;
}

// A fictional panel kind defined entirely in this test file -- registering
// it must require no edit to panelKindRegistry.ts or defaultPanelKinds.ts.
// This is the AC16 extensibility evidence for the panel-kind registry.
function makeFringeSignalKind(): PanelKindDefinition<FringeConfig> {
	return {
		kind: 'fringe_signal',
		defaultTitle: 'Fringe Signal',
		defaultSize: SIZE,
		minSize: { colSpan: 1, rowSpan: 1 },
		defaultConfig: () => ({ threshold: 0.5 }),
		validateConfig: (input: unknown): ConfigValidation<FringeConfig> => {
			if (typeof input !== 'object' || input === null || !('threshold' in input)) {
				return { ok: false, errors: [{ field: 'threshold', reason: 'is required' }] };
			}
			const threshold = (input as Record<string, unknown>).threshold;
			if (typeof threshold !== 'number') {
				return { ok: false, errors: [{ field: 'threshold', reason: 'must be a number' }] };
			}
			return { ok: true, value: { threshold } };
		},
		configSchema: { type: 'object', properties: { threshold: { type: 'number' } } },
		linkChannels: ['symbol'],
		bindingTypes: ['symbol_list'],
		defaultRenderer: null,
		component: async () => ({ placeholderKind: 'fringe_signal' })
	};
}

function makeMinimalKind(kind: string): PanelKindDefinition {
	return {
		kind,
		defaultTitle: kind,
		defaultSize: SIZE,
		minSize: SIZE,
		defaultConfig: () => ({}),
		validateConfig: () => ({ ok: true, value: {} }),
		configSchema: { type: 'object', properties: {} },
		linkChannels: [],
		bindingTypes: [],
		defaultRenderer: null,
		component: async () => ({})
	};
}

describe('createPanelRegistry: isolation', () => {
	it('never touches the module-global registry or any other instance', async () => {
		const { panelKindRegistry: globalRegistry } = await import('./panelKindRegistry');
		const registryA = createPanelRegistry();
		const registryB = createPanelRegistry();

		registryA.register(makeMinimalKind('isolated_a'));

		expect(registryA.has('isolated_a'), 'expected registryA to have its own registration').toBe(
			true
		);
		expect(
			registryB.has('isolated_a'),
			'expected a sibling isolated registry to be unaffected'
		).toBe(false);
		expect(
			globalRegistry.has('isolated_a'),
			'expected the module-global registry to be unaffected by an isolated registry'
		).toBe(false);
	});
});

describe('PanelRegistry: registration', () => {
	it('registers a kind that can then be looked up by name', () => {
		const registry = createPanelRegistry();
		const definition = makeFringeSignalKind();

		registry.register(definition);

		expect(registry.get('fringe_signal'), 'expected lookup to find the registered kind').toBe(
			definition
		);
		expect(registry.has('fringe_signal'), 'expected has() to report true after registration').toBe(
			true
		);
	});

	it('reports a conflict rather than silently replacing a duplicate registration', () => {
		const registry = createPanelRegistry();
		registry.register(makeMinimalKind('chart'));

		expect(
			() => registry.register(makeMinimalKind('chart')),
			'expected a second registration under the same kind name to throw'
		).toThrow(PanelKindConflictError);

		const kind = registry.get('chart');
		expect(
			kind?.defaultTitle,
			'expected the original registration to survive the rejected duplicate'
		).toBe('chart');
	});

	it('lists every registered kind with its schema and link channels', () => {
		const registry = createPanelRegistry();
		registry.register(makeFringeSignalKind());
		registry.register(makeMinimalKind('other_kind'));

		const names = registry.names();
		expect(names, `expected both kinds in names(), got ${JSON.stringify(names)}`).toEqual(
			expect.arrayContaining(['fringe_signal', 'other_kind'])
		);

		const list = registry.list();
		const fringe = list.find((entry) => entry.kind === 'fringe_signal');
		expect(fringe, 'expected list() to include the fringe_signal definition').toBeDefined();
		expect(fringe?.linkChannels, 'expected list() entries to carry their link channels').toEqual([
			'symbol'
		]);
		expect(fringe?.configSchema, 'expected list() entries to carry their config schema').toEqual({
			type: 'object',
			properties: { threshold: { type: 'number' } }
		});
	});
});

describe('PanelRegistry: unknown kind lookup', () => {
	it('require() throws UnknownPanelKindError listing every registered kind', () => {
		const registry = createPanelRegistry();
		registry.register(makeMinimalKind('chart'));
		registry.register(makeMinimalKind('watchlist'));

		let caught: unknown;
		try {
			registry.require('does_not_exist');
		} catch (error) {
			caught = error;
		}

		expect(caught, 'expected require() to throw for an unregistered kind').toBeInstanceOf(
			UnknownPanelKindError
		);
		const error = caught as UnknownPanelKindError;
		expect(error.kind, 'expected the error to name the requested kind').toBe('does_not_exist');
		expect(
			error.registeredKinds,
			`expected the error to list every registered kind, got ${JSON.stringify(error.registeredKinds)}`
		).toEqual(expect.arrayContaining(['chart', 'watchlist']));
	});

	it('get() returns undefined rather than throwing for an unregistered kind', () => {
		const registry = createPanelRegistry();
		expect(
			registry.get('does_not_exist'),
			'expected get() to return undefined for an unregistered kind'
		).toBeUndefined();
	});
});

describe('PanelKindDefinition.validateConfig: error shape', () => {
	it('returns validated configuration for accepted input', () => {
		const definition = makeFringeSignalKind();
		const result = definition.validateConfig({ threshold: 0.9 });

		expect(result.ok, `expected ok validation, got ${JSON.stringify(result)}`).toBe(true);
		if (result.ok) {
			expect(result.value.threshold, 'expected the validated value to carry through').toBe(0.9);
		}
	});

	it('returns errors that each identify the rejected field and the reason', () => {
		const definition = makeFringeSignalKind();
		const result = definition.validateConfig({ threshold: 'not-a-number' });

		expect(result.ok, `expected rejected validation, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.errors, 'expected exactly one error').toHaveLength(1);
			expect(result.errors[0]?.field, 'expected the error to name the rejected field').toBe(
				'threshold'
			);
			expect(result.errors[0]?.reason, 'expected the error to explain the reason').toBe(
				'must be a number'
			);
		}
	});
});

describe('registerPanelKind / getPanelKind / listPanelKinds module wrappers', () => {
	it('delegate to the shared module-global registry', async () => {
		const { registerPanelKind, getPanelKind, listPanelKinds } = await import('./panelKindRegistry');
		const kindName = `wrapper_test_${Math.random().toString(36).slice(2)}`;

		registerPanelKind(makeMinimalKind(kindName));

		expect(
			getPanelKind(kindName),
			'expected getPanelKind to see a kind registered via registerPanelKind'
		).toBeDefined();
		expect(
			listPanelKinds().some((entry) => entry.kind === kindName),
			'expected listPanelKinds to include a kind registered via registerPanelKind'
		).toBe(true);
	});
});
