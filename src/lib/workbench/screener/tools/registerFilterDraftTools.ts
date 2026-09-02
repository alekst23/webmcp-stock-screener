// Composition root for the derive_filters_from_setup tool (T-1014-3):
// wires real infrastructure to buildDeriveFiltersFromSetupTool and
// registers it against document.modelContext. Mirrors
// chart/tools/registerChartTools.ts's shape exactly: gated off and not
// called from app startup until T-1014-11 does whole-surface integration,
// same as every sibling "new surface" composition root.
import { ensureModelContext } from '../../../webmcp/bridge';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { operationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createIdSequencer } from '../../domain/ids';
import type { IdSequencer } from '../../domain/ids';
import type { WorkspaceDocument } from '../../domain/workspace';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { filterDraftIdSeed } from '../domain/filterDraft';
import {
	buildDeriveFiltersFromSetupTool,
	type DeriveFiltersFromSetupDeps
} from './deriveFiltersFromSetup';

export const FILTER_DRAFT_TOOLS_ENABLED = false;

// Draft ids share the workspace-wide 'filter' sequence with plain filter
// node ids (see filterDraft.ts), so a reloaded workspace's sequencer must be
// seeded from the draft extension the same way chart's own composition root
// seeds from captured setups.
export function createFilterDraftIdSequencer(doc: WorkspaceDocument | null): IdSequencer {
	return createIdSequencer(doc ? filterDraftIdSeed(doc) : {});
}

export function createDefaultFilterDraftDeps(): DeriveFiltersFromSetupDeps {
	const repository = createLocalWorkspaceRepository();
	const clock = { now: () => new Date().toISOString() };
	const activeId = repository.getActiveId();
	const ids = createFilterDraftIdSequencer(activeId ? repository.get(activeId) : null);
	return {
		repository,
		revisions: createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		}),
		history: createChangeHistory(),
		registry: operationRegistry,
		clock,
		ids
	};
}

export async function registerFilterDraftTools(
	deps: DeriveFiltersFromSetupDeps = createDefaultFilterDraftDeps()
): Promise<void> {
	if (!FILTER_DRAFT_TOOLS_ENABLED) {
		return;
	}
	const mc = ensureModelContext();
	const spec = buildDeriveFiltersFromSetupTool(deps);
	await mc.registerTool({
		name: spec.name,
		description: spec.description,
		inputSchema: spec.inputSchema,
		execute: spec.execute
	});
}
