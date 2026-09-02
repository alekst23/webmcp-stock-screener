// BacktestApiPort over T-1014-6's HTTP API (backend/api/routes/backtest.py).
// Mirrors similarity/infra/httpSimilarityApi.ts's shape: a thin fetch
// wrapper, transport failures wrapped rather than leaked. Unlike that
// module, there is no camelCase wire-shape reconstruction to do for a
// completed result -- see domain/apiPort.ts's note on why `result` is
// passed through as the backend's own JSON.
import {
	BacktestApiError,
	type BacktestApiPort,
	type BacktestNotFoundReason,
	type BacktestResultsOutcome,
	type BacktestStartResult,
	type BacktestStartWireRequest
} from '../domain/apiPort';

export interface HttpBacktestApiConfig {
	baseUrl: string;
	fetchImpl?: typeof fetch;
}

async function toApiError(response: Response): Promise<BacktestApiError> {
	let message = `Request failed with ${response.status} ${response.statusText}`;
	let notFoundReason: BacktestNotFoundReason | undefined;
	try {
		const body = await response.json();
		const detail = body?.detail;
		if (typeof detail === 'object' && detail !== null) {
			message = typeof detail.message === 'string' ? detail.message : message;
			if (detail.reason === 'unknown' || detail.reason === 'evicted') {
				notFoundReason = detail.reason;
			}
		} else if (typeof detail === 'string') {
			message = detail;
		}
	} catch {
		// Body wasn't JSON; keep the status-line message.
	}
	if (response.status === 404) {
		return new BacktestApiError('not_found', message, { notFoundReason });
	}
	if (response.status === 422) {
		return new BacktestApiError('validation', message);
	}
	return new BacktestApiError('source_unavailable', message);
}

export function createHttpBacktestApi(config: HttpBacktestApiConfig): BacktestApiPort {
	const doFetch = config.fetchImpl ?? fetch;

	async function request(path: string, init?: RequestInit): Promise<unknown> {
		let response: Response;
		try {
			response = await doFetch(`${config.baseUrl}${path}`, init);
		} catch (err) {
			throw new BacktestApiError('source_unavailable', 'The backtest API could not be reached.', {
				cause: err
			});
		}
		if (!response.ok) {
			throw await toApiError(response);
		}
		try {
			return await response.json();
		} catch (err) {
			throw new BacktestApiError(
				'malformed_response',
				'The backtest API returned a body that could not be read.',
				{ cause: err }
			);
		}
	}

	return {
		async start(payload: BacktestStartWireRequest): Promise<BacktestStartResult> {
			const body = (await request('/api/backtests', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			})) as { backtest_id: string; status: BacktestStartResult['status'] };
			return { backtestId: body.backtest_id, status: body.status };
		},

		async getResults(
			backtestId: string,
			offset?: number,
			limit?: number
		): Promise<BacktestResultsOutcome> {
			const params = new URLSearchParams();
			if (offset !== undefined) {
				params.set('offset', String(offset));
			}
			if (limit !== undefined) {
				params.set('limit', String(limit));
			}
			const query = params.toString();
			const body = (await request(
				`/api/backtests/${encodeURIComponent(backtestId)}${query ? `?${query}` : ''}`
			)) as {
				backtest_id: string;
				status: 'running' | 'completed' | 'failed';
				progress?: { started_at: string; elapsed_seconds: number; message: string } | null;
				error?: string | null;
				result?: Record<string, unknown> | null;
			};
			if (body.status === 'running') {
				const progress = body.progress;
				return {
					status: 'running',
					backtestId: body.backtest_id,
					progress: {
						startedAt: progress?.started_at ?? '',
						elapsedSeconds: progress?.elapsed_seconds ?? 0,
						message: progress?.message ?? 'Evaluation in progress.'
					}
				};
			}
			if (body.status === 'failed') {
				return {
					status: 'failed',
					backtestId: body.backtest_id,
					error: body.error ?? 'Backtest failed.'
				};
			}
			return { status: 'completed', backtestId: body.backtest_id, result: body.result ?? {} };
		}
	};
}
