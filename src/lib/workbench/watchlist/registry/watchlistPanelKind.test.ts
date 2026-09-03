// T-1015-12: registration-level tests for the real watchlist panel kind.
// Mirrors resultsTablePanelKind.test.ts's own harness/test shape -- a
// standalone PanelUseCaseDeps, not panels/application/testSupport.ts's
// createPanelTestHarness(), which seeds the PLACEHOLDER 'watchlist' kind via
// registerDefaultPanelKinds.
import { afterEach, describe, expect, it } from 'vitest';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createRevisionService } from '../../application/revisionService';
import { createIdSequencer } from '../../domain/ids';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { createLayoutTemplateRegistry } from '../../../panels/domain/layoutTemplates';
import { createPanelRegistry } from '../../../panels/registry/panelKindRegistry';
import { registerDefaultPanelKinds } from '../../../panels/registry/defaultPanelKinds';
import { createSourceRendererRegistry } from '../../../panels/registry/sourceRendererRegistry';
import type { PanelUseCaseDeps } from '../../../panels/application';
import {
	createWatchlistPanelKindDefinition,
	registerWatchlistPanelKind
} from './watchlistPanelKind';
import {
	getWatchlistPanelRuntimeDeps,
	resetWatchlistPanelRuntimeDeps
} from './watchlistPanelContext';

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
	resetWatchlistPanelRuntimeDeps();
});

describe('createWatchlistPanelKindDefinition', () => {
	it("declares the kind exactly as defaultPanelKinds.ts's own placeholder spec did", () => {
		const definition = createWatchlistPanelKindDefinition({ useCaseDeps: harness() });
		expect(definition.kind).toBe('watchlist');
		expect(definition.defaultTitle).toBe('Watchlist');
		expect(definition.defaultSize).toEqual({ colSpan: 2, rowSpan: 2 });
		expect(definition.minSize).toEqual({ colSpan: 1, rowSpan: 1 });
		expect(definition.linkChannels).toEqual(['symbol', 'result_selection']);
		expect(definition.bindingTypes).toEqual(['watchlist', 'symbol_list']);
		expect(definition.defaultRenderer).toBeNull();
	});

	it('defaultConfig matches the placeholder shape (sortBy: symbol)', () => {
		const definition = createWatchlistPanelKindDefinition({ useCaseDeps: harness() });
		expect(definition.defaultConfig()).toEqual({ sortBy: 'symbol' });
	});

	it('validateConfig accepts the default config', () => {
		const definition = createWatchlistPanelKindDefinition({ useCaseDeps: harness() });
		const result = definition.validateConfig(definition.defaultConfig());
		expect(
			result.ok,
			`expected the default config to validate, got ${JSON.stringify(result)}`
		).toBe(true);
	});

	it('validateConfig rejects an unrecognized field', () => {
		const definition = createWatchlistPanelKindDefinition({ useCaseDeps: harness() });
		const result = definition.validateConfig({ sortBy: 'symbol', bogus: true });
		expect(result.ok, 'an unrecognized field must be rejected').toBe(false);
	});

	it('component() resolves to a real, invocable component loader', async () => {
		const definition = createWatchlistPanelKindDefinition({ useCaseDeps: harness() });
		const loaded = await definition.component();
		expect(typeof loaded, 'a Svelte component compiles to a function').toBe('function');
	});

	it('sets the watchlist panel runtime deps singleton at registration time, before component() is called', () => {
		const deps = harness();
		createWatchlistPanelKindDefinition({ useCaseDeps: deps });
		const configured = getWatchlistPanelRuntimeDeps();
		expect(configured.useCaseDeps).toBe(deps);
	});
});

describe('registerWatchlistPanelKind', () => {
	it('registers the real definition into the given registry', () => {
		const registry = createPanelRegistry();
		registerWatchlistPanelKind(registry, { useCaseDeps: harness() });
		expect(registry.has('watchlist')).toBe(true);
		expect(registry.require('watchlist').bindingTypes).toEqual(['watchlist', 'symbol_list']);
	});

	it("overwrites the placeholder default registration, per registerDefaultPanelKinds' precedence rule", async () => {
		const registry = createPanelRegistry();
		// The real definition registered first (composition-root order), then
		// the placeholder -- the placeholder must step aside, never override.
		registerWatchlistPanelKind(registry, { useCaseDeps: harness() });
		registerDefaultPanelKinds(registry);

		const definition = registry.require('watchlist');
		const loaded = await definition.component();
		expect(
			typeof loaded,
			'the real component() resolves to a Svelte component function, unlike the placeholder marker object'
		).toBe('function');
	});
});
