import { describe, expect, it } from 'vitest';
import { BacktestApiError } from '../domain/apiPort';
import { createHttpBacktestApi } from './httpBacktestApi';

interface FetchCall {
	url: string;
	method: string;
	body: Record<string, unknown> | null;
}

function stubFetch(handler: (call: FetchCall) => Promise<Response> | Response) {
	const calls: FetchCall[] = [];
	const impl = (async (url: string, init?: RequestInit) => {
		const call: FetchCall = {
			url: String(url),
			method: init?.method ?? 'GET',
			body: init?.body ? JSON.parse(String(init.body)) : null
		};
		calls.push(call);
		return handler(call);
	}) as unknown as typeof fetch;
	return { impl, calls };
}

function jsonResponse(payload: unknown, init?: { status?: number; statusText?: string }): Response {
	return {
		ok: (init?.status ?? 200) < 400,
		status: init?.status ?? 200,
		statusText: init?.statusText ?? 'OK',
		json: async () => payload
	} as Response;
}

const START_REQUEST = {
	screener_id: 'scr_1',
	revision: 1,
	filter_tree: {
		node_id: 'root',
		kind: 'group' as const,
		op: 'and' as const,
		children: [],
		enabled: true
	},
	universe: {
		universe_id: 'u1',
		label: 'l',
		tickers: null,
		min_price: null,
		min_avg_volume: null,
		min_market_cap: null,
		excluded_tickers: []
	},
	from_date: '2024-01-01',
	to_date: '2024-06-01',
	horizons: [5]
};

describe('createHttpBacktestApi.start', () => {
	it('posts to /api/backtests and returns the backtest_id/status', async () => {
		const { impl, calls } = stubFetch(() =>
			jsonResponse({ backtest_id: 'backtest_1', status: 'running' })
		);
		const api = createHttpBacktestApi({ baseUrl: 'http://x', fetchImpl: impl });

		const result = await api.start(START_REQUEST);

		expect(result).toEqual({ backtestId: 'backtest_1', status: 'running' });
		expect(calls[0]?.method).toBe('POST');
		expect(calls[0]?.url).toBe('http://x/api/backtests');
		expect(calls[0]?.body).toEqual(START_REQUEST);
	});

	it('wraps a transport failure as source_unavailable', async () => {
		const impl = (async () => {
			throw new Error('network down');
		}) as unknown as typeof fetch;
		const api = createHttpBacktestApi({ baseUrl: 'http://x', fetchImpl: impl });

		await expect(api.start(START_REQUEST)).rejects.toMatchObject({
			reason: 'source_unavailable'
		});
	});

	it('maps a 422 response to a validation error', async () => {
		const { impl } = stubFetch(() =>
			jsonResponse(
				{ detail: { message: 'backtest_screener requires at least one horizon.' } },
				{ status: 422 }
			)
		);
		const api = createHttpBacktestApi({ baseUrl: 'http://x', fetchImpl: impl });

		await expect(api.start(START_REQUEST)).rejects.toMatchObject({
			reason: 'validation',
			message: 'backtest_screener requires at least one horizon.'
		});
	});
});

describe('createHttpBacktestApi.getResults', () => {
	it('parses a running result', async () => {
		const { impl } = stubFetch(() =>
			jsonResponse({
				backtest_id: 'backtest_1',
				status: 'running',
				progress: { started_at: '2024-01-01T00:00:00Z', elapsed_seconds: 1.5, message: 'go' }
			})
		);
		const api = createHttpBacktestApi({ baseUrl: 'http://x', fetchImpl: impl });

		const outcome = await api.getResults('backtest_1');

		expect(outcome).toEqual({
			status: 'running',
			backtestId: 'backtest_1',
			progress: { startedAt: '2024-01-01T00:00:00Z', elapsedSeconds: 1.5, message: 'go' }
		});
	});

	it('parses a failed result', async () => {
		const { impl } = stubFetch(() =>
			jsonResponse({ backtest_id: 'backtest_1', status: 'failed', error: 'not enough history' })
		);
		const api = createHttpBacktestApi({ baseUrl: 'http://x', fetchImpl: impl });

		const outcome = await api.getResults('backtest_1');

		expect(outcome).toEqual({
			status: 'failed',
			backtestId: 'backtest_1',
			error: 'not enough history'
		});
	});

	it('parses a completed result and passes the result payload through unmodified', async () => {
		const resultPayload = { revision: 1, match_frequency: [], warnings: [] };
		const { impl } = stubFetch(() =>
			jsonResponse({ backtest_id: 'backtest_1', status: 'completed', result: resultPayload })
		);
		const api = createHttpBacktestApi({ baseUrl: 'http://x', fetchImpl: impl });

		const outcome = await api.getResults('backtest_1');

		expect(outcome).toEqual({
			status: 'completed',
			backtestId: 'backtest_1',
			result: resultPayload
		});
	});

	it('sends offset/limit as query params', async () => {
		const { impl, calls } = stubFetch(() =>
			jsonResponse({ backtest_id: 'backtest_1', status: 'completed', result: {} })
		);
		const api = createHttpBacktestApi({ baseUrl: 'http://x', fetchImpl: impl });

		await api.getResults('backtest_1', 10, 5);

		expect(calls[0]?.url).toBe('http://x/api/backtests/backtest_1?offset=10&limit=5');
	});

	it('maps a 404 to a not_found BacktestApiError carrying the evicted/unknown reason', async () => {
		const { impl } = stubFetch(() =>
			jsonResponse(
				{ detail: { message: 'Backtest backtest_1 is no longer retained.', reason: 'evicted' } },
				{ status: 404 }
			)
		);
		const api = createHttpBacktestApi({ baseUrl: 'http://x', fetchImpl: impl });

		let caught: unknown;
		try {
			await api.getResults('backtest_1');
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeInstanceOf(BacktestApiError);
		expect((caught as BacktestApiError).reason).toBe('not_found');
		expect((caught as BacktestApiError).notFoundReason).toBe('evicted');
	});
});
