// T-1015-12: registration-level tests for the real alert_draft panel kind --
// a brand-new kind (no placeholder counterpart), so there is no "replaces the
// placeholder" precedence to exercise here, unlike watchlistPanelKind.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createRevisionService } from '../../application/revisionService';
import { createIdSequencer } from '../../domain/ids';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { createLayoutTemplateRegistry } from '../../../panels/domain/layoutTemplates';
import { createPanelRegistry } from '../../../panels/registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../../../panels/registry/sourceRendererRegistry';
import type { PanelUseCaseDeps } from '../../../panels/application';
import {
	createAlertDraftPanelKindDefinition,
	registerAlertDraftPanelKind
} from './alertDraftPanelKind';
import {
	getAlertDraftPanelRuntimeDeps,
	resetAlertDraftPanelRuntimeDeps
} from './alertDraftPanelContext';

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
	resetAlertDraftPanelRuntimeDeps();
});

describe('createAlertDraftPanelKindDefinition', () => {
	it("is a distinct kind from defaultPanelKinds.ts's 'alerts' (plural) placeholder", () => {
		const definition = createAlertDraftPanelKindDefinition({ useCaseDeps: harness() });
		expect(definition.kind).toBe('alert_draft');
		expect(definition.kind).not.toBe('alerts');
	});

	it('declares a compact card footprint bounded by its own minSize', () => {
		const definition = createAlertDraftPanelKindDefinition({ useCaseDeps: harness() });
		expect(definition.defaultSize).toEqual({ colSpan: 2, rowSpan: 1 });
		expect(definition.minSize).toEqual({ colSpan: 1, rowSpan: 1 });
	});

	it('accepts an empty config and rejects any unrecognized field', () => {
		const definition = createAlertDraftPanelKindDefinition({ useCaseDeps: harness() });
		expect(definition.defaultConfig()).toEqual({});
		expect(definition.validateConfig({}).ok).toBe(true);
		const rejected = definition.validateConfig({ bogus: true });
		expect(rejected.ok, 'an unrecognized field must be rejected').toBe(false);
	});

	it('component() resolves to a real, invocable component loader', async () => {
		const definition = createAlertDraftPanelKindDefinition({ useCaseDeps: harness() });
		const loaded = await definition.component();
		expect(typeof loaded, 'a Svelte component compiles to a function').toBe('function');
	});

	it('sets the alert-draft panel runtime deps singleton at registration time, before component() is called', () => {
		const deps = harness();
		createAlertDraftPanelKindDefinition({ useCaseDeps: deps });
		const configured = getAlertDraftPanelRuntimeDeps();
		expect(configured.useCaseDeps).toBe(deps);
	});
});

describe('registerAlertDraftPanelKind', () => {
	it('registers the real definition into the given registry', () => {
		const registry = createPanelRegistry();
		registerAlertDraftPanelKind(registry, { useCaseDeps: harness() });
		expect(registry.has('alert_draft')).toBe(true);
		expect(registry.require('alert_draft').defaultTitle).toBe('Alert Draft');
	});
});
