import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../../domain/provenance';
import { ChartSeriesError, type ChartSeriesRequest } from '../domain/seriesPort';
import { createHttpChartSeries, type HttpChartSeriesConfig } from './httpChartSeries';

const CLOCK = { now: () => '2026-09-02T20:00:00.000Z' };

interface FetchCall {
	url: URL;
}

function stubFetch(handler: () => Promise<Response> | Response) {
	const calls: FetchCall[] = [];
	const impl = (async (url: string) => {
		calls.push({ url: new URL(String(url)) });
		return handler();
	}) as unknown as typeof fetch;
	return { impl, calls };
}

function jsonResponse(payload: unknown, init?: { status?: number; statusText?: string }): Response {
	return {
		ok: (init?.status ?? 200) < 400,
		status: init?.status ?? 200,
		statusText: init?.statusText ?? 'OK',
		json: async () => payload,
		text: async () => JSON.stringify(payload)
	} as Response;
}

function barsResponse(dates: string[]) {
	return {
		ticker: 'NVDA',
		start: dates[0],
		end: dates[dates.length - 1],
		bars: dates.map((date) => ({
			ticker: 'NVDA',
			date,
			open: 1,
			high: 2,
			low: 0.5,
			close: 1.5,
			volume: 100
		}))
	};
}

function config(overrides: Partial<HttpChartSeriesConfig> = {}): HttpChartSeriesConfig {
	return {
		baseUrl: 'https://backend.test',
		resolveSymbol: (instrumentId) => (instrumentId === 'instrument_nvda' ? 'NVDA' : null),
		clock: CLOCK,
		sourceId: 'src.panel.stored',
		sourceLabel: 'Stored price panel',
		timezone: 'America/New_York',
		currency: 'USD',
		sourceAdjustment: 'adjusted',
		liveness: 'historical',
		...overrides
	} as HttpChartSeriesConfig;
}

function request(overrides: Partial<ChartSeriesRequest> = {}): ChartSeriesRequest {
	return {
		instrumentId: 'instrument_nvda',
		timeframe: '1d',
		window: { start: '2026-01-02', end: '2026-01-05' },
		priceAdjustment: 'adjusted',
		session: 'regular',
		...overrides
	};
}

function onlyCall(calls: FetchCall[]): FetchCall {
	expect(calls).toHaveLength(1);
	return calls[0] as FetchCall;
}

async function expectChartSeriesError(promise: Promise<unknown>): Promise<ChartSeriesError> {
	let thrown: unknown;
	try {
		await promise;
	} catch (err) {
		thrown = err;
	}
	expect(thrown).toBeInstanceOf(ChartSeriesError);
	return thrown as ChartSeriesError;
}

describe('createHttpChartSeries request shaping', () => {
	it('gets the backend bars route with the resolved symbol and date bounds', async () => {
		const { impl, calls } = stubFetch(() => jsonResponse(barsResponse(['2026-01-02'])));
		await createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(request());
		const call = onlyCall(calls);
		expect(call.url.origin + call.url.pathname).toBe('https://backend.test/api/chart/bars');
		expect(call.url.searchParams.get('ticker')).toBe('NVDA');
		expect(call.url.searchParams.get('start')).toBe('2026-01-02');
		expect(call.url.searchParams.get('end')).toBe('2026-01-05');
	});

	it('refuses a window wider than the source will serve in one request', async () => {
		const { impl, calls } = stubFetch(() => jsonResponse(barsResponse([])));
		const error = await expectChartSeriesError(
			createHttpChartSeries(config({ fetchImpl: impl, maxWindowDays: 3 })).fetchSeries(
				request({ window: { start: '2026-01-01', end: '2026-01-31' } })
			)
		);
		expect(error.reason).toBe('invalid_window');
		expect(calls).toHaveLength(0);
	});
});

describe('createHttpChartSeries results', () => {
	it('maps backend price rows onto OHLCV bars', async () => {
		const { impl } = stubFetch(() => jsonResponse(barsResponse(['2026-01-02'])));
		const result = await createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(request());
		expect(result.bars).toEqual([
			{ time: '2026-01-02', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }
		]);
	});

	it('orders bars chronologically', async () => {
		const { impl } = stubFetch(() => jsonResponse(barsResponse(['2026-01-05', '2026-01-02'])));
		const result = await createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(request());
		expect(result.bars.map((entry) => entry.time)).toEqual(['2026-01-02', '2026-01-05']);
	});

	it('drops any bar the source returns from outside the requested window', async () => {
		const { impl } = stubFetch(() =>
			jsonResponse(barsResponse(['2025-12-30', '2026-01-02']))
		);
		const result = await createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(request());
		expect(result.bars.map((entry) => entry.time)).toEqual(['2026-01-02']);
	});

	it('returns an empty series with valid provenance for a window with no data', async () => {
		const { impl } = stubFetch(() =>
			jsonResponse({ ticker: 'NVDA', start: '2026-01-02', end: '2026-01-05', bars: [] })
		);
		const result = await createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(request());
		expect(result.bars).toEqual([]);
		expect(result.provenance.sourceId).toBe('src.panel.stored');
		expect(result.provenance.asOf).toBe('2026-09-02T20:00:00.000Z');
		expect(result.provenance.engineVersion).toBe(ENGINE_VERSION);
		expect(result.provenance.liveness).toBe('historical');
	});

	it('reports the basis the source applies, not the one requested', async () => {
		const { impl } = stubFetch(() => jsonResponse(barsResponse(['2026-01-02'])));
		const result = await createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(
			request({ priceAdjustment: 'unadjusted' })
		);
		expect(result.requestedPriceAdjustment).toBe('unadjusted');
		expect(result.appliedPriceAdjustment).toBe('adjusted');
		expect(result.provenance.priceAdjustment).toBe('adjusted');
		expect(result.warnings.join(' ')).toContain('unadjusted');
	});

	it('states no basis at all when the source does not report one', async () => {
		const { impl } = stubFetch(() => jsonResponse(barsResponse(['2026-01-02'])));
		const result = await createHttpChartSeries(
			config({ fetchImpl: impl, sourceAdjustment: 'unreported' })
		).fetchSeries(request());
		expect(result.appliedPriceAdjustment).toBeNull();
		expect('priceAdjustment' in result.provenance).toBe(false);
		expect(result.warnings.join(' ')).toContain('does not state');
	});

	it('warns rather than fails when the source cannot honour the requested session', async () => {
		const { impl } = stubFetch(() => jsonResponse(barsResponse(['2026-01-02'])));
		const result = await createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(
			request({ session: 'extended' })
		);
		expect(result.session).toBe('extended');
		expect(result.warnings.join(' ')).toContain('extended');
		expect(result.bars).toHaveLength(1);
	});

	it('carries the delay magnitude of a delayed source into provenance', async () => {
		const { impl } = stubFetch(() => jsonResponse(barsResponse(['2026-01-02'])));
		const result = await createHttpChartSeries(
			config({ fetchImpl: impl, liveness: 'delayed', delaySeconds: 900 })
		).fetchSeries(request());
		expect(result.provenance.liveness).toBe('delayed');
		expect(result.provenance.delaySeconds).toBe(900);
	});
});

describe('createHttpChartSeries failures', () => {
	it('wraps a rejected transport in a typed error carrying the cause', async () => {
		const transport = new TypeError('Failed to fetch');
		const { impl } = stubFetch(() => Promise.reject(transport));
		const error = await expectChartSeriesError(
			createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(request())
		);
		expect(error.reason).toBe('source_unavailable');
		expect(error.cause).toBe(transport);
		expect(error.instrumentId).toBe('instrument_nvda');
	});

	it('maps a 404 (unknown to the backend panel) onto unknown_instrument', async () => {
		const { impl } = stubFetch(() =>
			jsonResponse({ detail: 'Unknown ticker' }, { status: 404, statusText: 'Not Found' })
		);
		const error = await expectChartSeriesError(
			createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(request())
		);
		expect(error.reason).toBe('unknown_instrument');
	});

	it('wraps a non-OK, non-404 response, keeping the status reachable through the cause', async () => {
		const { impl } = stubFetch(() =>
			jsonResponse({ detail: 'no panel' }, { status: 503, statusText: 'Service Unavailable' })
		);
		const error = await expectChartSeriesError(
			createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(request())
		);
		expect(error.reason).toBe('source_unavailable');
		expect(String((error.cause as Error).message)).toContain('503');
	});

	it('wraps a body that cannot be parsed', async () => {
		const { impl } = stubFetch(
			() =>
				({
					ok: true,
					status: 200,
					statusText: 'OK',
					json: async () => {
						throw new SyntaxError('Unexpected token <');
					},
					text: async () => '<html>'
				}) as unknown as Response
		);
		const error = await expectChartSeriesError(
			createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(request())
		);
		expect(error.reason).toBe('malformed_response');
		expect(error.cause).toBeInstanceOf(SyntaxError);
	});

	it('rejects a body that is not a bars response', async () => {
		const { impl } = stubFetch(() => jsonResponse({ detail: 'surprise' }));
		const error = await expectChartSeriesError(
			createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(request())
		);
		expect(error.reason).toBe('malformed_response');
	});

	it('rejects an unknown instrument without touching the network', async () => {
		const { impl, calls } = stubFetch(() => jsonResponse(barsResponse([])));
		const error = await expectChartSeriesError(
			createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(
				request({ instrumentId: 'instrument_unlisted' })
			)
		);
		expect(error.reason).toBe('unknown_instrument');
		expect(calls).toHaveLength(0);
	});

	it('rejects a timeframe the source cannot serve without touching the network', async () => {
		const { impl, calls } = stubFetch(() => jsonResponse(barsResponse([])));
		const error = await expectChartSeriesError(
			createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(request({ timeframe: '5m' }))
		);
		expect(error.reason).toBe('unsupported_timeframe');
		expect(calls).toHaveLength(0);
	});

	it('rejects an inverted window without touching the network', async () => {
		const { impl, calls } = stubFetch(() => jsonResponse(barsResponse([])));
		const error = await expectChartSeriesError(
			createHttpChartSeries(config({ fetchImpl: impl })).fetchSeries(
				request({ window: { start: '2026-01-05', end: '2026-01-02' } })
			)
		);
		expect(error.reason).toBe('invalid_window');
		expect(calls).toHaveLength(0);
	});
});
