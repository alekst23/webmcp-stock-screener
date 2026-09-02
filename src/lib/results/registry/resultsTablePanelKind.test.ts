// T-1010-7: registration-level tests for the real results_table panel kind.
// Deliberately builds its own minimal PanelUseCaseDeps rather than
// panels/application/testSupport.ts's createPanelTestHarness(), which always
// seeds the placeholder 'results_table' kind via registerDefaultPanelKinds --
// the same reason tableRendererContract.test.ts avoids that harness for its
// own registration tests.
import { afterEach, describe, expect, it } from 'vitest';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import { createLayoutTemplateRegistry } from '../../panels/domain/layoutTemplates';
import { createPanelRegistry } from '../../panels/registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../../panels/registry/sourceRendererRegistry';
import type { PanelUseCaseDeps } from '../../panels/application';
import { defaultWireResultsTableConfig } from '../application/tableConfigWire';
import { testPinnedRunStore, testRun } from '../testSupport';
import {
	createResultsTablePanelKindDefinition,
	registerResultsTablePanelKind
} from './resultsTablePanelKind';
import {
	getResultsPanelRuntimeDeps,
	resetResultsPanelRuntimeDeps
} from '../panel/resultsPanelContext';

const CLOSE_COLUMN_WIRE = {
	id: 'column_1',
	identity: { source: 'catalog_field', field_id: 'field.price.close' },
	label: 'Close',
	value_type: 'number'
};

function harness(): PanelUseCaseDeps {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const clock = { now: () => '2026-01-01T00:00:00.000Z' };
	const ids = createIdSequencer();
	return {
		workspaceId: 'workspace_1',
		repository,
		revisions: createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		}),
		history: createChangeHistory(),
		clock,
		ids,
		kinds: createPanelRegistry(),
		sourceRenderer: createSourceRendererRegistry(),
		templates: createLayoutTemplateRegistry()
	};
}

afterEach(() => {
	resetResultsPanelRuntimeDeps();
});

describe('createResultsTablePanelKindDefinition', () => {
	it('declares the kind exactly as the design matrix specifies', () => {
		const runs = testPinnedRunStore();
		const definition = createResultsTablePanelKindDefinition({ useCaseDeps: harness(), runs });
		expect(definition.kind).toBe('results_table');
		expect(definition.defaultTitle).toBe('Results');
		expect(definition.defaultSize).toEqual({ colSpan: 4, rowSpan: 2 });
		expect(definition.minSize).toEqual({ colSpan: 2, rowSpan: 1 });
		expect(definition.linkChannels).toEqual(['symbol', 'result_selection', 'filters']);
		expect(definition.bindingTypes).toEqual(['screener_results', 'watchlist', 'panel_reference']);
		expect(definition.defaultRenderer).toBe('table');
	});

	it('defaultConfig matches the real wire default -- not the placeholder shape', () => {
		const runs = testPinnedRunStore();
		const definition = createResultsTablePanelKindDefinition({ useCaseDeps: harness(), runs });
		expect(definition.defaultConfig()).toEqual(defaultWireResultsTableConfig());
	});

	it('the default config validates successfully against the real rules', () => {
		const runs = testPinnedRunStore();
		const definition = createResultsTablePanelKindDefinition({ useCaseDeps: harness(), runs });
		const result = definition.validateConfig(definition.defaultConfig());
		expect(
			result.ok,
			`expected the default config to validate, got ${JSON.stringify(result)}`
		).toBe(true);
	});

	it('validateConfig rejects a column referencing an unknown catalog field', () => {
		const runs = testPinnedRunStore();
		const definition = createResultsTablePanelKindDefinition({ useCaseDeps: harness(), runs });
		const result = definition.validateConfig({
			...defaultWireResultsTableConfig(),
			columns: [
				{
					id: 'column_1',
					identity: { source: 'catalog_field', field_id: 'field.does_not_exist' },
					label: 'Bogus',
					value_type: 'number'
				}
			]
		});
		expect(result.ok, 'an unknown catalog field must be rejected').toBe(false);
	});

	it('validateConfig accepts a column referencing a real catalog field', () => {
		const runs = testPinnedRunStore();
		const definition = createResultsTablePanelKindDefinition({ useCaseDeps: harness(), runs });
		const result = definition.validateConfig({
			...defaultWireResultsTableConfig(),
			columns: [CLOSE_COLUMN_WIRE]
		});
		expect(result.ok, `expected acceptance, got ${JSON.stringify(result)}`).toBe(true);
	});

	it('component() resolves to a real, invocable component loader', async () => {
		const runs = testPinnedRunStore();
		const definition = createResultsTablePanelKindDefinition({ useCaseDeps: harness(), runs });
		const loaded = await definition.component();
		expect(typeof loaded, 'a Svelte component compiles to a function').toBe('function');
	});

	it('sets the results panel runtime deps singleton at registration time, before component() is called', () => {
		const deps = harness();
		const runs = testPinnedRunStore(testRun('run_1', 1));
		createResultsTablePanelKindDefinition({ useCaseDeps: deps, runs });
		const configured = getResultsPanelRuntimeDeps();
		expect(configured.useCaseDeps).toBe(deps);
		expect(configured.runs).toBe(runs);
	});
});

describe('registerResultsTablePanelKind', () => {
	it('registers the real definition into the given registry', () => {
		const registry = createPanelRegistry();
		registerResultsTablePanelKind(registry, { useCaseDeps: harness(), runs: testPinnedRunStore() });
		expect(registry.has('results_table')).toBe(true);
		expect(registry.require('results_table').defaultRenderer).toBe('table');
	});
});
