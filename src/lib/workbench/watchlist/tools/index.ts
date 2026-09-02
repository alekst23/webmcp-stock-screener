// The watchlist surface assembled: two tools, two operations. Mirrors
// chart/tools/index.ts's shape -- constructed exactly once per call, with
// each tool factory carrying its own `ensure*` call for its operation so
// both remain usable standalone.
import type { ToolSpec } from '../../../webmcp/types';
import type { IdSequencer } from '../../domain/ids';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { ChangeHistory } from '../../application/changeHistory';
import type { OperationRegistry } from '../../application/operationRegistry';
import type { RevisionService } from '../../application/revisionService';
import type { PinnedRunStore } from '../../../screener/ports';
import {
	ensureUpsertWatchlistOperation,
	WATCHLIST_UPSERT_KIND
} from '../application/upsertWatchlist';
import {
	ensureSaveResultsToWatchlistOperation,
	WATCHLIST_SAVE_RESULTS_KIND
} from '../application/saveResultsToWatchlist';
import { buildUpsertWatchlistTool } from './upsertWatchlist';
import { buildSaveResultsToWatchlistTool } from './saveResultsToWatchlist';

export interface WatchlistToolsDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	clock: Clock;
	ids: IdSequencer;
	runs: PinnedRunStore;
}

// The two kinds every watchlist mutation goes through. Named as a list so a
// caller can assert the surface is complete without knowing where each one
// is defined.
export const WATCHLIST_OPERATION_KINDS: readonly string[] = [
	WATCHLIST_UPSERT_KIND,
	WATCHLIST_SAVE_RESULTS_KIND
];

// Guarded on `get` rather than blind: the registry rejects a duplicate kind
// outright, so a second call would throw instead of being a no-op. This
// makes registering the watchlist surface twice -- a remount, a test
// rebuilding deps against a shared registry -- safe.
export function registerWatchlistOperations(deps: WatchlistToolsDeps): void {
	ensureUpsertWatchlistOperation(deps.registry, { clock: deps.clock });
	ensureSaveResultsToWatchlistOperation(deps.registry, { clock: deps.clock, runs: deps.runs });
}

export function buildWatchlistTools(deps: WatchlistToolsDeps): ToolSpec[] {
	registerWatchlistOperations(deps);
	return [buildUpsertWatchlistTool(deps), buildSaveResultsToWatchlistTool(deps)];
}
