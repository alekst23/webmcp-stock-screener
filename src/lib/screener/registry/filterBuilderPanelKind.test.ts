// T-0027-1: registration-level tests for the real filter_builder panel kind.
// Mirrors results/registry/resultsTablePanelKind.test.ts's own pattern --
// a minimal, hand-built PanelUseCaseDeps rather than
// panels/application/testSupport.ts's createPanelTestHarness(), which always
// seeds the placeholder 'filter_builder' kind via registerDefaultPanelKinds.
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
import {
	createFilterBuilderPanelKindDefinition,
	registerFilterBuilderPanelKind
} from './filterBuilderPanelKind';
import {
	getFilterBuilderPanelRuntimeDeps,
	resetFilterBuilderPanelRuntimeDeps
} from '../panel/filterBuilderPanelContext';

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
	resetFilterBuilderPanelRuntimeDeps();
});

describe('createFilterBuilderPanelKindDefinition', () => {
	it('declares the kind exactly as the design matrix specifies', () => {
		const definition = createFilterBuilderPanelKindDefinition({ useCaseDeps: harness() });
		expect(definition.kind).toBe('filter_builder');
		expect(definition.defaultTitle).toBe('Filter Builder');
		expect(definition.defaultSize).toEqual({ colSpan: 2, rowSpan: 4 });
		expect(definition.minSize).toEqual({ colSpan: 1, rowSpan: 2 });
		expect(definition.linkChannels).toEqual(['filters']);
		expect(definition.bindingTypes).toEqual([]);
		expect(definition.defaultRenderer).toBeNull();
	});

	it('the default config validates successfully', () => {
		const definition = createFilterBuilderPanelKindDefinition({ useCaseDeps: harness() });
		const result = definition.validateConfig(definition.defaultConfig());
		expect(result.ok, `expected the default config to validate, got ${JSON.stringify(result)}`).toBe(
			true
		);
	});

	it('validateConfig rejects an unrecognized field', () => {
		const definition = createFilterBuilderPanelKindDefinition({ useCaseDeps: harness() });
		const result = definition.validateConfig({ bogus: true });
		expect(result.ok, 'an unrecognized config field must be rejected').toBe(false);
	});

	it('component() resolves to a real, invocable component loader', async () => {
		const definition = createFilterBuilderPanelKindDefinition({ useCaseDeps: harness() });
		const loaded = await definition.component();
		expect(typeof loaded, 'a Svelte component compiles to a function').toBe('function');
	});

	it('sets the filter builder panel runtime deps singleton at registration time, before component() is called', () => {
		const deps = harness();
		createFilterBuilderPanelKindDefinition({ useCaseDeps: deps });
		const configured = getFilterBuilderPanelRuntimeDeps();
		expect(configured.useCaseDeps).toBe(deps);
	});
});

describe('registerFilterBuilderPanelKind', () => {
	it('registers the real definition into the given registry', () => {
		const registry = createPanelRegistry();
		registerFilterBuilderPanelKind(registry, { useCaseDeps: harness() });
		expect(registry.has('filter_builder')).toBe(true);
		expect(registry.require('filter_builder').defaultRenderer).toBeNull();
	});
});
