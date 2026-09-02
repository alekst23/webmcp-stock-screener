// Saving a pinned screener run's results into a watchlist, as an operation
// the workbench registry owns (T-1014-7). Reads the run through
// PinnedRunStore.getRun only -- that port has no execute/refresh member at
// all (screener/ports.ts's own comment on PinnedRunStore), so "never
// re-executes the screener" (AC5) is structural here, not a runtime check
// this module has to remember to make.
//
// Application layer: use case over the watchlist domain plus EPIC-1006's
// operation registry. No I/O of its own beyond the injected PinnedRunStore.
import type { IdSequencer, ResourceId } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { MutationDraft } from '../../application/revisionService';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { PinnedRunStore, RunNotAvailable } from '../../../screener/ports';
import type { ScreenerRun } from '../../../screener/run';
import { addMembers, asStaticBase, readWatchlist, writeWatchlist } from '../domain/watchlist';
import type { Watchlist, WatchlistMember } from '../domain/watchlist';

export const WATCHLIST_SAVE_RESULTS_KIND = 'watchlist.save_results';

export interface SaveResultsToWatchlistInput {
	watchlistId: ResourceId;
	runId: ResourceId;
	// Omit to save every matched instrument; present selects a subset.
	instrumentIds?: string[];
	// Required, and must be explicitly true, to save into a dynamic
	// watchlist -- converts it to static first (AC8).
	convertDynamic?: boolean;
}

export interface SaveResultsDeps {
	runs: PinnedRunStore;
}

function isRunAvailable(run: ScreenerRun | RunNotAvailable): run is ScreenerRun {
	return !('available' in run);
}

function resolveRun(
	input: SaveResultsToWatchlistInput,
	deps: SaveResultsDeps
): ScreenerRun | string[] {
	const result = deps.runs.getRun(input.runId);
	if (!isRunAvailable(result)) {
		return [`run_id: ${result.message}`];
	}
	return result;
}

// Selected IDs not present in the run's matches are named rather than
// silently dropped -- a wrong ID reaching a watchlist unnoticed is worse
// than a rejected call the agent can correct in one turn.
function selectionIssues(input: SaveResultsToWatchlistInput, run: ScreenerRun): string[] {
	if (input.instrumentIds === undefined) {
		return [];
	}
	if (
		!Array.isArray(input.instrumentIds) ||
		input.instrumentIds.some((id) => typeof id !== 'string')
	) {
		return ['instrument_ids: expected an array of instrument IDs.'];
	}
	const matched = new Set(run.matches.map((m) => m.instrumentId));
	const unknown = input.instrumentIds.filter((id) => !matched.has(id));
	return unknown.length > 0
		? [`instrument_ids: not present in run "${run.runId}"'s results: ${unknown.join(', ')}.`]
		: [];
}

function watchlistIssues(
	input: SaveResultsToWatchlistInput,
	watchlist: Watchlist | null
): string[] {
	if (!watchlist) {
		return [`watchlist_id: "${input.watchlistId}" is not a watchlist in this workspace.`];
	}
	if (watchlist.kind === 'dynamic' && input.convertDynamic !== true) {
		return [
			`watchlist_id: "${watchlist.watchlistId}" is dynamic -- its membership is defined by ` +
				`screener "${watchlist.screenerId}", not a saved list. Pass convert_dynamic=true to ` +
				'convert it to a static watchlist seeded with these results.'
		];
	}
	return [];
}

function validateSaveResults(
	input: SaveResultsToWatchlistInput,
	doc: WorkspaceDocument,
	deps: SaveResultsDeps
): string[] {
	if (typeof input.watchlistId !== 'string' || input.watchlistId.length === 0) {
		return ['watchlist_id: required.'];
	}
	const watchlist = readWatchlist(doc, input.watchlistId);
	const issues = watchlistIssues(input, watchlist);
	if (issues.length > 0) {
		return issues;
	}
	const run = resolveRun(input, deps);
	if (Array.isArray(run)) {
		return run;
	}
	return selectionIssues(input, run);
}

// The instrument IDs this call would attempt to add: the whole run's
// matches, or a validated subset of them.
export function selectedInstrumentIds(
	input: SaveResultsToWatchlistInput,
	run: ScreenerRun
): string[] {
	return input.instrumentIds ?? run.matches.map((m) => m.instrumentId);
}

function toRunMembers(instrumentIds: string[], run: ScreenerRun, now: string): WatchlistMember[] {
	return instrumentIds.map((instrumentId) => ({
		instrumentId,
		addedAt: now,
		source: {
			kind: 'run',
			runId: run.runId,
			runCreatedAt: run.createdAt,
			provenance: run.provenance
		}
	}));
}

function applySaveResults(
	input: SaveResultsToWatchlistInput,
	doc: WorkspaceDocument,
	deps: SaveResultsDeps,
	now: string
): MutationDraft {
	const watchlist = readWatchlist(doc, input.watchlistId) as Watchlist;
	const run = deps.runs.getRun(input.runId) as ScreenerRun;
	const selected = selectedInstrumentIds(input, run);
	const base = asStaticBase(watchlist);
	const {
		watchlist: updated,
		addedCount,
		alreadyPresentCount
	} = addMembers(base, toRunMembers(selected, run, now));
	const stamped = { ...updated, updatedAt: now };
	const document = writeWatchlist(doc, stamped);
	const warnings =
		watchlist.kind === 'dynamic'
			? [
					`Converted dynamic watchlist ${watchlist.watchlistId} to static; it is no longer ` +
						`defined by screener ${watchlist.screenerId}.`
				]
			: [];
	return {
		document,
		affectedIds: [watchlist.watchlistId],
		diffSummary:
			`Saved ${addedCount} of ${selected.length} instrument(s) from run ${run.runId} to ` +
			`watchlist ${watchlist.watchlistId} (${alreadyPresentCount} already present).`,
		warnings,
		inverse: {
			document: doc,
			affectedIds: [watchlist.watchlistId],
			diffSummary: `Reverted watchlist ${watchlist.watchlistId} to its prior state.`
		}
	};
}

export const SAVE_RESULTS_TO_WATCHLIST_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		watchlist_id: { type: 'string', description: 'The target watchlist.' },
		run_id: { type: 'string', description: 'The pinned run whose results are being saved.' },
		instrument_ids: {
			type: 'array',
			items: { type: 'string' },
			description: "Optional subset of the run's matched instruments. Omit to save all of them."
		},
		convert_dynamic: {
			type: 'boolean',
			description:
				'Required (and must be true) to save into a dynamic watchlist. Converts it to static, ' +
				'seeded with these results.'
		},
		expected_revision: { type: 'number' },
		idempotency_key: { type: 'string' }
	},
	required: ['watchlist_id', 'run_id']
};

export function createSaveResultsToWatchlistOperation(
	deps: SaveResultsDeps & { clock: Clock }
): OperationDefinition<SaveResultsToWatchlistInput> {
	return {
		kind: WATCHLIST_SAVE_RESULTS_KIND,
		inputSchema: SAVE_RESULTS_TO_WATCHLIST_SCHEMA,
		validate: (input, doc) => validateSaveResults(input, doc, deps),
		describe: (input) => `Save results from run ${input.runId} to watchlist ${input.watchlistId}.`,
		apply: (input, doc) => applySaveResults(input, doc, deps, deps.clock.now())
	};
}

// Idempotent so a tool factory can guarantee its operation exists without
// fighting a composition root that registered it first.
export function ensureSaveResultsToWatchlistOperation(
	registry: OperationRegistry,
	deps: SaveResultsDeps & { clock: Clock }
): void {
	if (!registry.get(WATCHLIST_SAVE_RESULTS_KIND)) {
		registry.register(createSaveResultsToWatchlistOperation(deps));
	}
}
