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
