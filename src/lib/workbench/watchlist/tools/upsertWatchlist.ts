// The `upsert_watchlist` tool: create or update a static or dynamic
// watchlist. Every mutation runs through the registered `watchlist.upsert`
// operation rather than a parallel write path, so revision guarding,
// idempotency replay and the undo token come from EPIC-1006 rather than
// from here. This module only translates between the wire's snake_case and
// the operation's input, and turns typed errors into tool failures.
import { fail, ok } from '../../../webmcp/toolResult';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import {
	IdempotencyConflictError,
	OperationValidationError,
	RevisionConflictError,
	StorageWriteError,
	UndoTokenError
} from '../../domain/errors';
import { isResourceId } from '../../domain/ids';
import type { IdSequencer } from '../../domain/ids';
import { toWireEnvelope } from '../../domain/mutation';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { ChangeHistory } from '../../application/changeHistory';
import { applyOperations } from '../../application/operationRegistry';
import type { OperationRegistry } from '../../application/operationRegistry';
import type { RevisionService } from '../../application/revisionService';
import { readWatchlist, toWireWatchlist } from '../domain/watchlist';
import type { WatchlistKind } from '../domain/watchlist';
import {
	ensureUpsertWatchlistOperation,
	UPSERT_WATCHLIST_SCHEMA,
	WATCHLIST_UPSERT_KIND
} from '../application/upsertWatchlist';
import type { UpsertWatchlistInput } from '../application/upsertWatchlist';

export const UPSERT_WATCHLIST_TOOL_NAME = 'upsert_watchlist';

export interface UpsertWatchlistDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	clock: Clock;
	ids: IdSequencer;
}

interface WireInput {
	workspace_id?: string;
	watchlist_id?: string;
	name?: string;
	kind: WatchlistKind;
	instrument_ids?: string[];
	screener_id?: string;
	screener_revision?: number;
	expected_revision?: number;
	idempotency_key?: string;
}

function toErrorResult(err: unknown): ToolResult {
	if (
		err instanceof RevisionConflictError ||
		err instanceof IdempotencyConflictError ||
		err instanceof UndoTokenError ||
		err instanceof OperationValidationError ||
		err instanceof StorageWriteError
	) {
		return fail(err.message, err.toWireError());
	}
	return fail(err instanceof Error ? err.message : String(err));
}

function notFound(message: string): ToolResult {
	return fail(message, { error: 'not_found', message });
}

function toOperationInput(input: WireInput): UpsertWatchlistInput {
	return {
		...(input.watchlist_id !== undefined ? { watchlistId: input.watchlist_id } : {}),
		...(input.name !== undefined ? { name: input.name } : {}),
		kind: input.kind,
		...(input.instrument_ids !== undefined ? { instrumentIds: input.instrument_ids } : {}),
		...(input.screener_id !== undefined ? { screenerId: input.screener_id } : {}),
		...(input.screener_revision !== undefined ? { screenerRevision: input.screener_revision } : {})
	};
}

function upsertWatchlist(deps: UpsertWatchlistDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as WireInput;
		const workspaceId = input.workspace_id ?? deps.repository.getActiveId();
		if (!workspaceId) {
			return notFound('No active workspace.');
		}
		try {
			const envelope = applyOperations(
				[{ kind: WATCHLIST_UPSERT_KIND, input: toOperationInput(input) }],
				{
					expectedRevision: input.expected_revision,
					idempotencyKey: input.idempotency_key,
					actor: 'agent'
				},
				{
					registry: deps.registry,
					workspaceId,
					history: deps.history,
					revisionService: deps.revisions,
					clock: deps.clock,
					ids: deps.ids
				}
			);
			const doc = deps.repository.get(workspaceId);
			// By kind, not by position: affected_ids also carries nothing else on
			// this operation, but matching addChartAnnotation.ts's discipline
			// keeps every tool in this surface consistent about how it recovers
			// the resource its own mutation just touched.
			const watchlistId = envelope.affectedIds.find((id) => isResourceId(id, 'watchlist')) ?? '';
			const watchlist = doc ? readWatchlist(doc, watchlistId) : null;
			return ok({
				...toWireEnvelope(envelope),
				watchlist: watchlist ? toWireWatchlist(watchlist) : null
			});
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const DESCRIPTION =
	'Create or update a watchlist. Omit watchlist_id to create; supply it to update that watchlist ' +
	'in place, keeping its ID. A static watchlist holds a fixed instrument_ids membership; a ' +
	'dynamic one is defined by a screener_id (and optional screener_revision) instead, and has no ' +
	'membership list of its own. On an update, name and instrument_ids/screener fields are only ' +
	'changed when supplied -- omit a field to leave it as is. Use save_results_to_watchlist to add ' +
	"a pinned run's results to an existing watchlist. Returns the mutation envelope plus the " +
	'watchlist.';

// Registers its own operation when the caller's registry does not already
// carry it, so the tool is usable on its own; a composition root that
// registers the watchlist operations up front still wins.
export function buildUpsertWatchlistTool(deps: UpsertWatchlistDeps): ToolSpec {
	ensureUpsertWatchlistOperation(deps.registry, { clock: deps.clock });
	return {
		name: UPSERT_WATCHLIST_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: UPSERT_WATCHLIST_SCHEMA,
		available: () => true,
		execute: upsertWatchlist(deps)
	};
}
