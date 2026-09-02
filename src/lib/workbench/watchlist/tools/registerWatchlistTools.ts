// Composition root for the watchlist surface: wires real infrastructure to
// buildWatchlistTools and registers the two watchlist tools against
// document.modelContext. Mirrors chart/tools/registerChartTools.ts's and
// similarity/tools/registerSimilarityTools.ts's shape exactly -- same
// flagged-off, not-called-from-app-startup pattern every sibling "new
// surface" composition root uses. Not called from app startup by this
// ticket; T-1014-11 (register followup tool surface) wires this in,
// including sharing the real PinnedRunStore instance
// registerPanelTools.ts's runtime already holds -- a fresh, empty store
// built here is only a usable default for standalone use and tests.
import { ensureModelContext } from '../../../webmcp/bridge';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { operationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createIdSequencer } from '../../domain/ids';
import type { IdSequencer } from '../../domain/ids';
import type { WorkspaceDocument } from '../../domain/workspace';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { createPinnedRunStore } from '../../../screener/runStore';
import { watchlistIdSeed } from '../domain/watchlist';
import { buildWatchlistTools, type WatchlistToolsDeps } from './index';

export const WATCHLIST_TOOLS_ENABLED = false;

export function createWatchlistIdSequencer(doc: WorkspaceDocument | null): IdSequencer {
	return createIdSequencer(doc ? watchlistIdSeed(doc) : {});
}

export function createDefaultWatchlistDeps(): WatchlistToolsDeps {
	const repository = createLocalWorkspaceRepository();
	const clock = { now: () => new Date().toISOString() };
	const activeId = repository.getActiveId();
	const ids = createWatchlistIdSequencer(activeId ? repository.get(activeId) : null);
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
		ids,
		runs: createPinnedRunStore()
	};
}

export async function registerWatchlistTools(
	deps: WatchlistToolsDeps = createDefaultWatchlistDeps()
): Promise<void> {
	if (!WATCHLIST_TOOLS_ENABLED) {
		return;
	}
	const mc = ensureModelContext();
	for (const spec of buildWatchlistTools(deps)) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
}
