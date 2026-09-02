// The browser-to-backend port for T-1014-6's backtest HTTP API
// (backend/api/routes/backtest.py). Mirrors similarity/domain/apiPort.ts's
// shape: one narrow port, implemented once in infra, consumed by both
// backtest tools.
import type { WireError } from '../../domain/errors';
import type { WireFilterNode, WireUniverseSpec } from './translateScreener';

export type BacktestRebalance = 'daily' | 'weekly' | 'monthly';

export interface BacktestStartWireRequest {
	screener_id: string;
	revision: number;
	filter_tree: WireFilterNode;
	universe: WireUniverseSpec;
	from_date: string;
	to_date: string;
	horizons: number[];
	rebalance?: BacktestRebalance;
}

export type BacktestJobStatus = 'running' | 'completed' | 'failed';

export interface BacktestStartResult {
	backtestId: string;
	status: BacktestJobStatus;
}

export interface BacktestProgress {
	startedAt: string;
	elapsedSeconds: number;
	message: string;
}

// `result` is left as the backend's own (already snake_case) JSON object
// rather than reconstructed into a camelCase TS entity -- there is no
// other TS consumer of backtest results to serve (visualizing them in a
// panel is explicitly out of scope), so get_backtest_results's job is to
// pass through the pinned engine's own output, not to re-model it.
export type BacktestResultsOutcome =
	| { status: 'running'; backtestId: string; progress: BacktestProgress }
	| { status: 'failed'; backtestId: string; error: string }
	| { status: 'completed'; backtestId: string; result: Record<string, unknown> };

export type BacktestApiErrorReason =
	'not_found' | 'validation' | 'source_unavailable' | 'malformed_response';

export type BacktestNotFoundReason = 'unknown' | 'evicted';

// The API layer's own failure type -- a raw transport exception never
// escapes this port, matching SimilarityApiError's convention.
export class BacktestApiError extends Error {
	readonly reason: BacktestApiErrorReason;
	// Only meaningful when reason === 'not_found': distinguishes an id that
	// never existed from one that existed and was reclaimed (AC8), mirroring
	// RunNotAvailable's own 'unknown' | 'evicted' split on the TS side.
	readonly notFoundReason?: BacktestNotFoundReason;

	constructor(
		reason: BacktestApiErrorReason,
		message: string,
		options?: { cause?: unknown; notFoundReason?: BacktestNotFoundReason }
	) {
		super(message, { cause: options?.cause });
		this.name = 'BacktestApiError';
		this.reason = reason;
		this.notFoundReason = options?.notFoundReason;
	}

	toWireError(): WireError {
		return {
			error: `backtest_api_${this.reason}`,
			message: this.message,
			reason: this.reason,
			...(this.notFoundReason ? { not_found_reason: this.notFoundReason } : {})
		};
	}
}

export interface BacktestApiPort {
	// Returns as soon as the backend has minted a backtest_id -- never waits
	// for the evaluation itself (AC1).
	start(request: BacktestStartWireRequest): Promise<BacktestStartResult>;
	// Reads a backtest's current stored status/results -- never starts or
	// re-starts an evaluation (AC5, AC8).
	getResults(backtestId: string, offset?: number, limit?: number): Promise<BacktestResultsOutcome>;
}
