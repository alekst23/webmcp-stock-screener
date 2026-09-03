// `backtest_screener` (T-1014-6): starts a historical evaluation of one
// specific screener revision against T-1014-5's Python engine and returns a
// stable backtest_id immediately, without waiting for the evaluation
// (AC1). Pinning, idempotency and expected_revision mirror run_screener's
// own module (webmcp/screener/runScreener.ts) closely -- see this file's
// Solution Approach ("Mutation envelope and idempotency") for exactly which
// parts are ported rather than imported and why.
//
// backtest_screener does not mutate the workspace document -- there is no
// new WorkspaceDocument field to write, the same reason run_screener
// bypasses RevisionService.commit. AC11 still requires the common mutation
// envelope, so it is built by hand (buildEnvelope/toWireEnvelope) with
// newRevision echoing the current, unchanged revision and undoToken null --
// there is nothing to undo.

import { fail, ok } from '../../../webmcp/toolResult';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import {
	readOptionalNumber,
	readOptionalString,
	readString,
	resolveWorkspaceId,
	toErrorResult
} from '../../../webmcp/screener/support';
import type { ScreenerDefinition } from '../../../screener/definition';
import { readScreener } from '../../../screener/state';
import { fingerprintRequest } from '../../application/idempotency';
import { buildEnvelope, toWireEnvelope } from '../../domain/mutation';
import { OperationValidationError, RevisionConflictError } from '../../domain/errors';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { WorkspaceRepository } from '../../domain/ports';
import type { IdSequencer } from '../../domain/ids';
import { translateFilterNode, translateUniverse } from '../domain/translateScreener';
import type { BacktestApiPort, BacktestRebalance } from '../domain/apiPort';

export const BACKTEST_SCREENER_TOOL_NAME = 'backtest_screener';

const REBALANCE_VALUES: readonly BacktestRebalance[] = ['daily', 'weekly', 'monthly'];

export interface BacktestScreenerDeps {
	repository: WorkspaceRepository;
	ids: IdSequencer;
	api: BacktestApiPort;
}

interface WireInput {
	workspace_id?: unknown;
	screener_id?: unknown;
	screener_revision?: unknown;
	from_date?: unknown;
	to_date?: unknown;
	horizons?: unknown;
	rebalance?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

// Ported from runScreener.ts's own resolveScreenerRevision rather than
// imported: that function is not exported, and duplicating ~20 lines here
// is cheaper than widening runScreener.ts's surface for one more caller
// (this ticket's Solution Approach makes this call explicitly).
function resolveScreenerRevision(
	repository: WorkspaceRepository,
	workspaceId: string,
	current: ScreenerDefinition,
	screenerId: string,
	requestedRevision: number | undefined
): ScreenerDefinition {
	if (requestedRevision === undefined || current.revision === requestedRevision) {
		return current;
	}
	for (const saved of repository.listRevisions(workspaceId)) {
		const snapshot = repository.getRevision(workspaceId, saved.revision);
		const screener = snapshot ? readScreener(snapshot, screenerId) : null;
		if (screener && screener.revision === requestedRevision) {
			return screener;
		}
	}
	throw new OperationValidationError([
		`Screener revision ${requestedRevision} for screener "${screenerId}" is no longer retained.`
	]);
}

function readHorizons(value: unknown): number[] | null {
	if (!Array.isArray(value) || value.length === 0) {
		return null;
	}
	const horizons = value.filter(
		(item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0
	);
	return horizons.length === value.length ? horizons : null;
}

function readRebalance(value: unknown): BacktestRebalance | undefined {
	return typeof value === 'string' && (REBALANCE_VALUES as readonly string[]).includes(value)
		? (value as BacktestRebalance)
		: undefined;
}

// Replays a repeated idempotency_key onto the original backtest_id (AC11)
// without a second HTTP call -- run_screener's own createRunReplayCache
// pattern, private here for the same reason that one is private there: the
// cached value here (a ToolResult carrying a backtest_id) is not a
// MutationEnvelope, so WorkbenchDeps.idempotency's typed cache does not fit.
export interface BacktestReplayCache {
	lookup(key: string, fingerprint: string): ToolResult | null;
	remember(key: string, fingerprint: string, result: ToolResult): void;
}

export function createBacktestReplayCache(): BacktestReplayCache {
	const entries = new Map<string, { fingerprint: string; result: ToolResult }>();
	return {
		lookup(key, fingerprint) {
			const entry = entries.get(key);
			if (!entry) {
				return null;
			}
			// A mismatched fingerprint under a reused key is a caller bug, not
			// a retry -- reported the same way as everywhere else this pattern
			// appears, via toErrorResult below at the call site.
			return entry.fingerprint === fingerprint ? entry.result : null;
		},
		remember(key, fingerprint, result) {
			entries.set(key, { fingerprint, result });
		}
	};
}

async function execute(
	deps: BacktestScreenerDeps,
	replayCache: BacktestReplayCache,
	rawInput: unknown
): Promise<ToolResult> {
	const input = (rawInput ?? {}) as WireInput;

	const workspaceId = resolveWorkspaceId(deps, input);
	if (!workspaceId) {
		return fail('No active workspace.', { error: 'not_found' });
	}
	const screenerId = readString(input.screener_id);
	if (!screenerId) {
		return fail('backtest_screener requires a non-empty "screener_id".', {
			error: 'invalid_input'
		});
	}
	const fromDate = readOptionalString(input.from_date);
	const toDate = readOptionalString(input.to_date);
	if (!fromDate || !toDate) {
		return fail('backtest_screener requires "from_date" and "to_date".', {
			error: 'invalid_input'
		});
	}
	const horizons = readHorizons(input.horizons);
	if (!horizons) {
		return fail('backtest_screener requires a non-empty array of positive integer "horizons".', {
			error: 'invalid_input'
		});
	}
	const requestedRevision = readOptionalNumber(input.screener_revision);
	const expectedRevision = readOptionalNumber(input.expected_revision);
	const idempotencyKey = readOptionalString(input.idempotency_key);
	const rebalance = readRebalance(input.rebalance);

	const fingerprint = fingerprintRequest('backtest.backtest_screener', {
		workspaceId,
		screenerId,
		screenerRevision: requestedRevision ?? null,
		expectedRevision: expectedRevision ?? null,
		fromDate,
		toDate,
		horizons,
		rebalance: rebalance ?? null
	});

	if (idempotencyKey) {
		const cached = replayCache.lookup(idempotencyKey, fingerprint);
		if (cached) {
			return cached;
		}
	}

	const doc: WorkspaceDocument | null = deps.repository.get(workspaceId);
	if (!doc) {
		return fail(`Workspace not found: ${workspaceId}`, { error: 'not_found' });
	}
	if (expectedRevision !== undefined && expectedRevision !== doc.revision) {
		const err = new RevisionConflictError(expectedRevision, doc.revision, [screenerId]);
		return fail(err.message, err.toWireError());
	}
	const currentScreener = readScreener(doc, screenerId);
	if (!currentScreener) {
		return fail(`Screener not found: ${screenerId}`, { error: 'not_found', screenerId });
	}

	let definition: ScreenerDefinition;
	try {
		definition = resolveScreenerRevision(
			deps.repository,
			workspaceId,
			currentScreener,
			screenerId,
			requestedRevision
		);
	} catch (err) {
		return toErrorResult(err);
	}

	const { universe, droppedCriteria } = translateUniverse(
		definition.universe,
		`${screenerId}_universe`,
		definition.name ?? 'Screener universe'
	);

	let started;
	try {
		started = await deps.api.start({
			screener_id: screenerId,
			revision: definition.revision,
			filter_tree: translateFilterNode(definition.filterTree),
			universe,
			from_date: fromDate,
			to_date: toDate,
			horizons,
			...(rebalance ? { rebalance } : {})
		});
	} catch (err) {
		return toErrorResult(err);
	}

	const changeId = deps.ids.next('change');
	const envelope = buildEnvelope({
		changeId,
		newRevision: doc.revision,
		affectedIds: [screenerId],
		diffSummary:
			`Started a backtest of screener "${screenerId}" (revision ${definition.revision}) ` +
			`from ${fromDate} to ${toDate}.`,
		warnings: droppedCriteria.map(
			(criterion) =>
				`Universe criterion "${criterion}" has no equivalent in the backtest engine's universe ` +
				'model and was not applied; the backtest ran against a coarser universe than the screener defines.'
		),
		undoToken: null
	});

	const result = ok({
		...toWireEnvelope(envelope),
		backtest_id: started.backtestId,
		status: started.status
	});

	if (idempotencyKey) {
		replayCache.remember(idempotencyKey, fingerprint, result);
	}
	return result;
}

const DESCRIPTION =
	'Starts a historical evaluation of one specific screener revision -- match frequency over time, ' +
	'forward-return distributions per horizon, and drawdown statistics -- against a historical date ' +
	'range and one or more forward-return horizons (in trading days). Returns a stable backtest_id ' +
	'immediately, without waiting for the evaluation to finish; read results with ' +
	'get_backtest_results. The backtest is pinned to the screener revision it started against -- ' +
	'later edits to the screener never change what it reports. Accepts an optional ' +
	'screener_revision to backtest an exact past revision (rejected if no longer retained), ' +
	'expected_revision for optimistic concurrency, and idempotency_key -- a replayed key returns the ' +
	'original backtest_id without starting a second evaluation. Returns the common mutation ' +
	'envelope alongside backtest_id and status, even though nothing in the workspace document ' +
	'itself changes.';

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		screener_id: { type: 'string' },
		screener_revision: {
			type: 'integer',
			description:
				'Optional. Backtests this exact screener revision instead of the current one; ' +
				'rejected if that revision is no longer retained.'
		},
		from_date: { type: 'string', description: 'ISO date, inclusive lower bound.' },
		to_date: { type: 'string', description: 'ISO date, inclusive upper bound.' },
		horizons: {
			type: 'array',
			items: { type: 'integer', minimum: 1 },
			minItems: 1,
			description: 'Forward-return horizons in trading days, e.g. [5, 20, 60].'
		},
		rebalance: {
			type: 'string',
			enum: REBALANCE_VALUES,
			description: 'How often the universe is re-screened over the range. Defaults to weekly.'
		},
		expected_revision: { type: 'number' },
		idempotency_key: { type: 'string' }
	},
	required: ['screener_id', 'from_date', 'to_date', 'horizons']
};

export function createBacktestScreenerTool(
	deps: BacktestScreenerDeps,
	replayCache: BacktestReplayCache = createBacktestReplayCache()
): ToolSpec {
	return {
		name: BACKTEST_SCREENER_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: INPUT_SCHEMA,
		available: () => true,
		execute: (input) => execute(deps, replayCache, input)
	};
}
