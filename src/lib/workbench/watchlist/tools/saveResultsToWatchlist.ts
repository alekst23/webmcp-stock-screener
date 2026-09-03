// The `save_results_to_watchlist` tool: add a pinned run's instruments (or a
// selected subset) to a watchlist. Every mutation runs through the
// registered `watchlist.save_results` operation, so revision guarding,
// idempotency replay and the undo token come from EPIC-1006 rather than
// from here. This module only translates between the wire's snake_case and
// the operation's input, turns typed errors into tool failures, and reports
// how many of the requested instruments were newly added versus already
// present.
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
import type { IdSequencer, ResourceId } from '../../domain/ids';
import { toWireEnvelope } from '../../domain/mutation';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { ChangeHistory } from '../../application/changeHistory';
import { applyOperations } from '../../application/operationRegistry';
import type { OperationRegistry } from '../../application/operationRegistry';
import type { RevisionService } from '../../application/revisionService';
import type { PinnedRunStore } from '../../../screener/ports';
import { addMembers, asStaticBase, readWatchlist, toWireWatchlist } from '../domain/watchlist';
import type { StaticWatchlist, Watchlist, WatchlistMember } from '../domain/watchlist';
import {
	ensureSaveResultsToWatchlistOperation,
	SAVE_RESULTS_TO_WATCHLIST_SCHEMA,
	selectedInstrumentIds,
	WATCHLIST_SAVE_RESULTS_KIND
} from '../application/saveResultsToWatchlist';
import type { SaveResultsToWatchlistInput } from '../application/saveResultsToWatchlist';

export const SAVE_RESULTS_TO_WATCHLIST_TOOL_NAME = 'save_results_to_watchlist';

export interface SaveResultsToWatchlistDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	clock: Clock;
	ids: IdSequencer;
	runs: PinnedRunStore;
}

interface WireInput {
	workspace_id?: string;
	watchlist_id: ResourceId;
	run_id: ResourceId;
	instrument_ids?: string[];
	convert_dynamic?: boolean;
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

function toOperationInput(input: WireInput): SaveResultsToWatchlistInput {
	return {
		watchlistId: input.watchlist_id,
		runId: input.run_id,
		...(input.instrument_ids !== undefined ? { instrumentIds: input.instrument_ids } : {}),
		...(input.convert_dynamic !== undefined ? { convertDynamic: input.convert_dynamic } : {})
	};
}

// How many of this call's own attempted instruments were newly added versus
// already present, computed against the watchlist's state immediately
// before this call -- not by re-reading state after the commit, which would
// misreport on an idempotency replay (nothing happened a second time, so a
// replay's honest answer is "0 added", not a repeat of the first call's
// numbers). Uses the same addMembers/asStaticBase logic the real mutation
// applies, as a dry run, so the two can never disagree about what counts as
// "already present".
const EMPTY_STATIC: StaticWatchlist = {
	watchlistId: '',
	name: '',
	kind: 'static',
	members: [],
	createdAt: '',
	updatedAt: ''
};

function countAgainstSnapshot(
	before: Watchlist | null,
	selected: string[]
): { addedCount: number; alreadyPresentCount: number } {
	const base = before ? asStaticBase(before) : EMPTY_STATIC;
	const dryRun: WatchlistMember[] = selected.map((instrumentId) => ({
		instrumentId,
		addedAt: '',
		source: { kind: 'manual' }
	}));
	const { addedCount, alreadyPresentCount } = addMembers(base, dryRun);
	return { addedCount, alreadyPresentCount };
}

function saveResultsToWatchlist(deps: SaveResultsToWatchlistDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as WireInput;
		const workspaceId = input.workspace_id ?? deps.repository.getActiveId();
		if (!workspaceId) {
			return notFound('No active workspace.');
		}
		const beforeDoc = deps.repository.get(workspaceId);
		const beforeWatchlist = beforeDoc ? readWatchlist(beforeDoc, input.watchlist_id) : null;
		try {
			const envelope = applyOperations(
				[{ kind: WATCHLIST_SAVE_RESULTS_KIND, input: toOperationInput(input) }],
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
			const watchlistId = envelope.affectedIds.find((id) => isResourceId(id, 'watchlist')) ?? '';
			const watchlist = doc ? readWatchlist(doc, watchlistId) : null;
			const run = deps.runs.getRun(input.run_id);
			const selected = !('available' in run)
				? selectedInstrumentIds(toOperationInput(input), run)
				: [];
			const counts = countAgainstSnapshot(beforeWatchlist, selected);
			return ok({
				...toWireEnvelope(envelope),
				watchlist: watchlist ? toWireWatchlist(watchlist) : null,
				added_count: counts.addedCount,
				already_present_count: counts.alreadyPresentCount
			});
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const DESCRIPTION =
	"Save a pinned screener run's results into a watchlist, without re-running the screener -- the " +
	'saved membership matches the pinned run exactly. Omit instrument_ids to save every matched ' +
	'instrument, or supply a subset to save only those. Membership is deduplicated by instrument ' +
	'ID; the response reports how many were newly added versus already present. Saving into a ' +
	'dynamic watchlist requires convert_dynamic=true, which converts it to static, seeded with ' +
	'these results. Returns the mutation envelope plus the watchlist.';

// Registers its own operation when the caller's registry does not already
// carry it, so the tool is usable on its own; a composition root that
// registers the watchlist operations up front still wins.
export function buildSaveResultsToWatchlistTool(deps: SaveResultsToWatchlistDeps): ToolSpec {
	ensureSaveResultsToWatchlistOperation(deps.registry, { clock: deps.clock, runs: deps.runs });
	return {
		name: SAVE_RESULTS_TO_WATCHLIST_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: SAVE_RESULTS_TO_WATCHLIST_SCHEMA,
		available: () => true,
		execute: saveResultsToWatchlist(deps)
	};
}
