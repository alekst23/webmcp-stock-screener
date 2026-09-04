// Test harness every use case test builds fresh: an in-memory repository,
// a fixed clock, a new IdSequencer, and freshly-seeded registries -- never
// the module-global default registries, so tests never see another test's
// registrations.
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import type { Clock } from '../../workbench/domain/ports';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import {
	createLayoutTemplateRegistry,
	registerDefaultLayoutTemplates
} from '../domain/layoutTemplates';
import { createPanelRegistry } from '../registry/panelKindRegistry';
import { registerDefaultPanelKinds } from '../registry/defaultPanelKinds';
import { createSourceRendererRegistry } from '../registry/sourceRendererRegistry';
import { registerDefaultSourceRendererTypes } from '../registry/defaultSourceRendererTypes';
import type { PanelUseCaseDeps } from './support';

export interface PanelTestHarness extends PanelUseCaseDeps {
	clockValue: string;
	setClock(iso: string): void;
}

export function createPanelTestHarness(workspaceId = 'workspace_1'): PanelTestHarness {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const state = { now: '2026-01-01T00:00:00.000Z' };
	const clock: Clock = { now: () => state.now };
	const ids = createIdSequencer();

	const kinds = createPanelRegistry();
	registerDefaultPanelKinds(kinds);
	// hotfix/panel-system: DEFAULT_SEED_PANELS (domain/defaultLayout.ts) seeds
	// an 'alert_draft' panel, but that kind has no placeholder counterpart in
	// defaultPanelKinds.ts -- unlike 'watchlist'/'similar_opportunities', it
	// didn't exist yet when that placeholder registry was written, and its
	// real registration (workbench/alerts/registry/alertDraftPanelKind.ts)
	// only ever runs from the full production composition root
	// (registerPanelTools.ts), which this lightweight use-case-level harness
	// deliberately doesn't pull in. A minimal placeholder here keeps
	// resetLayout/seedDefaultWorkspace testable against this harness without
	// coupling application/testSupport.ts to the workbench/alerts feature.
	kinds.register(
		{
			kind: 'alert_draft',
			defaultTitle: 'Alert Draft',
			defaultSize: { colSpan: 2, rowSpan: 1 },
			minSize: { colSpan: 1, rowSpan: 1 },
			defaultConfig: () => ({}),
			validateConfig: (input: unknown) => {
				if (typeof input !== 'object' || input === null || Array.isArray(input)) {
					return { ok: false, errors: [{ field: 'config', reason: 'must be an object' }] };
				}
				const errors = Object.keys(input as Record<string, unknown>).map((key) => ({
					field: key,
					reason: 'not a recognized configuration field'
				}));
				return errors.length > 0 ? { ok: false, errors } : { ok: true, value: {} };
			},
			configSchema: { type: 'object', properties: {} },
			linkChannels: [],
			bindingTypes: [],
			defaultRenderer: null,
			component: async () => ({ placeholderKind: 'alert_draft' })
		},
		{ placeholder: true }
	);

	const sourceRenderer = createSourceRendererRegistry();
	registerDefaultSourceRendererTypes(sourceRenderer);

	const templates = createLayoutTemplateRegistry();
	registerDefaultLayoutTemplates(templates);

	const revisions = createRevisionService({
		repository,
		clock,
		ids,
		idempotency: createIdempotencyCache()
	});

	return {
		workspaceId,
		repository,
		revisions,
		history: createChangeHistory(),
		clock,
		ids,
		kinds,
		sourceRenderer,
		templates,
		get clockValue() {
			return state.now;
		},
		setClock(iso: string) {
			state.now = iso;
		}
	};
}
