// `get_backtest_results` (T-1014-6): reads a backtest's stored status and
// results by id, without ever re-executing it (AC5, AC8). Read-only with
// respect to workspace state (AC12): no mutation envelope, no
// expected_revision, no idempotency_key, no undo_token -- mirrors
// export_results.ts's (T-1014-10) own "nothing here to undo" precedent
// exactly. The only call this tool makes is BacktestApiPort.getResults,
// which has no method capable of starting an evaluation -- the same
// structural absence PinnedRunStore relies on for run_screener's own
// no-silent-rerun guarantee.
import { fail, ok } from '../../../webmcp/tools';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import { BacktestApiError, type BacktestApiPort } from '../domain/apiPort';

export const GET_BACKTEST_RESULTS_TOOL_NAME = 'get_backtest_results';

export interface GetBacktestResultsDeps {
	api: BacktestApiPort;
}

interface WireInput {
	backtest_id?: unknown;
	offset?: unknown;
	limit?: unknown;
}

function toErrorResult(err: unknown): ToolResult {
	if (err instanceof BacktestApiError) {
		return fail(err.message, err.toWireError());
	}
	return fail(err instanceof Error ? err.message : String(err));
}

async function execute(deps: GetBacktestResultsDeps, rawInput: unknown): Promise<ToolResult> {
	const input = (rawInput ?? {}) as WireInput;
	const backtestId = typeof input.backtest_id === 'string' ? input.backtest_id : '';
	if (!backtestId) {
		return fail('get_backtest_results requires a non-empty "backtest_id".', {
			error: 'invalid_input'
		});
	}
	const offset = typeof input.offset === 'number' ? input.offset : undefined;
	const limit = typeof input.limit === 'number' ? input.limit : undefined;

	try {
		const outcome = await deps.api.getResults(backtestId, offset, limit);
		if (outcome.status === 'running') {
			return ok({
				backtest_id: outcome.backtestId,
				status: 'running',
				progress: {
					started_at: outcome.progress.startedAt,
					elapsed_seconds: outcome.progress.elapsedSeconds,
					message: outcome.progress.message
				}
			});
		}
		if (outcome.status === 'failed') {
			return ok({ backtest_id: outcome.backtestId, status: 'failed', error: outcome.error });
		}
		return ok({
			backtest_id: outcome.backtestId,
			status: 'completed',
			result: outcome.result
		});
	} catch (err) {
		return toErrorResult(err);
	}
}

const DESCRIPTION =
	"Reads a backtest's stored status and results by backtest_id, as returned by backtest_screener. " +
	'Never re-executes the backtest -- reading a completed backtest repeatedly returns the exact ' +
	'same stored results. A still-running backtest returns an in-progress status with progress ' +
	'information, never partial results presented as final. A failed backtest returns a failed ' +
	'status with the reason. An unknown or expired backtest_id is rejected saying so; nothing is ' +
	'started to cover for a missing result. A completed result states the screener revision it was ' +
	'computed against, the universe, the date range covered, the horizons, the rebalance frequency, ' +
	'the survivorship assumption, the calculation-engine version, and the market-data provenance ' +
	'envelope, alongside match frequency over time (paginated via offset/limit, bounded and totaled), ' +
	'forward-return distributions per horizon, drawdown statistics, and any warnings the engine ' +
	'produced (lookahead handling, truncated coverage, insufficient history, zero matches). ' +
	'Read-only: never mutates workspace state.';

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		backtest_id: { type: 'string' },
		offset: {
			type: 'integer',
			minimum: 0,
			description: 'match_frequency page offset. Defaults to 0.'
		},
		limit: {
			type: 'integer',
			minimum: 1,
			description: 'match_frequency page size. Server-bounded.'
		}
	},
	required: ['backtest_id']
};

export function createGetBacktestResultsTool(deps: GetBacktestResultsDeps): ToolSpec {
	return {
		name: GET_BACKTEST_RESULTS_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: INPUT_SCHEMA,
		available: () => true,
		execute: (input) => execute(deps, input)
	};
}
