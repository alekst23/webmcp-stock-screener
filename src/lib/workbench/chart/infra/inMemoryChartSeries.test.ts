// The ChartSeriesPort contract, exercised end to end through an
// implementation with real behavior rather than a per-assertion stub. No
// network is reachable from any test here.
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../../domain/provenance';
import {
	ChartSeriesError,
	type ChartSeriesPort,
	type ChartSeriesRequest,
	type OhlcvBar
} from '../domain/seriesPort';
import { createInMemoryChartSeries, type InMemoryChartSeriesFixture } from './inMemoryChartSeries';

const CLOCK = { now: () => '2026-09-02T20:00:00.000Z' };

function bar(time: string, close: number): OhlcvBar {
	return { time, open: close - 1, high: close + 1, low: close - 2, close, volume: 1_000 };
}

const NVDA_BARS = [bar('2026-01-02', 10), bar('2026-01-05', 12), bar('2026-01-09', 11)];

function nvda(overrides: Partial<InMemoryChartSeriesFixture> = {}): InMemoryChartSeriesFixture {
	return {
		instrumentId: 'instrument_nvda',
		timeframe: '1d',
		bars: NVDA_BARS,
		sourceAdjustment: 'adjusted',
		currency: 'USD',
		timezone: 'America/New_York',
		liveness: 'static',
		...overrides
	} as InMemoryChartSeriesFixture;
}

function port(...series: InMemoryChartSeriesFixture[]): ChartSeriesPort {
	return createInMemoryChartSeries({ clock: CLOCK, series });
}

function request(overrides: Partial<ChartSeriesRequest> = {}): ChartSeriesRequest {
	return {
		instrumentId: 'instrument_nvda',
		timeframe: '1d',
		window: { start: '2026-01-01', end: '2026-01-31' },
		priceAdjustment: 'adjusted',
		session: 'regular',
		...overrides
	};
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

describe('the chart series port contract', () => {
	it('returns the bars inside the window, in order, echoing the request', async () => {
		const result = await port(nvda()).fetchSeries(request());
		expect(result.bars.map((entry) => entry.time)).toEqual([
			'2026-01-02',
			'2026-01-05',
			'2026-01-09'
		]);
		expect(result.instrumentId).toBe('instrument_nvda');
		expect(result.timeframe).toBe('1d');
		expect(result.window).toEqual({ start: '2026-01-01', end: '2026-01-31' });
		expect(result.session).toBe('regular');
		expect(result.warnings).toEqual([]);
	});

	it('narrows to the window rather than returning everything it holds', async () => {
		const result = await port(nvda()).fetchSeries(
			request({ window: { start: '2026-01-03', end: '2026-01-06' } })
		);
		expect(result.bars.map((entry) => entry.time)).toEqual(['2026-01-05']);
	});

	it('populates every provenance field a market-data result must state', async () => {
		const result = await port(nvda()).fetchSeries(request());
		expect(result.provenance).toEqual({
			asOf: '2026-09-02T20:00:00.000Z',
			sourceId: 'src.chart.in_memory',
			sourceLabel: 'In-memory chart series',
			liveness: 'static',
			timezone: 'America/New_York',
			currency: 'USD',
			priceAdjustment: 'adjusted',
			engineVersion: ENGINE_VERSION
		});
	});

	it('warns naming both sessions when the source cannot honour the requested one', async () => {
		const result = await port(nvda({ session: 'regular' })).fetchSeries(
			request({ session: 'extended' })
		);
		expect(result.session).toBe('extended');
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('extended');
		expect(result.warnings[0]).toContain('regular');
		expect(result.bars).toHaveLength(3);
	});

	it('offers no continuation cursor a caller could loop on', async () => {
		const result = await port(nvda()).fetchSeries(request());
		expect('nextCursor' in result).toBe(false);
		expect('hasMore' in result).toBe(false);
	});
});

describe('delayed data', () => {
	it('states the delay magnitude alongside the delayed liveness', async () => {
		const result = await port(nvda({ liveness: 'delayed', delaySeconds: 900 })).fetchSeries(
			request()
		);
		expect(result.provenance.liveness).toBe('delayed');
		expect(result.provenance.delaySeconds).toBe(900);
	});

	it('carries no delay figure when the source is not delayed', async () => {
		const result = await port(nvda()).fetchSeries(request());
		expect('delaySeconds' in result.provenance).toBe(false);
	});
});

describe('adjustment downgrade', () => {
	it('reports the applied basis and warns naming both policies', async () => {
		const result = await port(nvda({ sourceAdjustment: 'adjusted' })).fetchSeries(
			request({ priceAdjustment: 'unadjusted' })
		);
		expect(result.requestedPriceAdjustment).toBe('unadjusted');
		expect(result.appliedPriceAdjustment).toBe('adjusted');
		expect(result.provenance.priceAdjustment).toBe('adjusted');
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('unadjusted');
		expect(result.warnings[0]).toContain('adjusted');
	});

	it('reports split-adjusted prices exactly as such alongside coarser provenance', async () => {
		const result = await port(nvda({ sourceAdjustment: 'split_adjusted' })).fetchSeries(
			request({ priceAdjustment: 'adjusted' })
		);
		expect(result.appliedPriceAdjustment).toBe('split_adjusted');
		expect(result.provenance.priceAdjustment).toBe('adjusted');
	});

	it('does not warn when the source honours the requested policy', async () => {
		const result = await port(nvda({ sourceAdjustment: 'unadjusted' })).fetchSeries(
			request({ priceAdjustment: 'unadjusted' })
		);
		expect(result.provenance.priceAdjustment).toBe('unadjusted');
		expect(result.warnings).toEqual([]);
	});

	it('never invents a basis for a source that states none', async () => {
		const result = await port(nvda({ sourceAdjustment: 'unreported' })).fetchSeries(request());
		expect(result.appliedPriceAdjustment).toBeNull();
		expect('priceAdjustment' in result.provenance).toBe(false);
		expect(result.warnings[0]).toContain('does not state');
	});
});

describe('empty windows', () => {
	it('returns an empty series with valid provenance rather than an error', async () => {
		const result = await port(nvda()).fetchSeries(
			request({ window: { start: '2026-02-01', end: '2026-02-28' } })
		);
		expect(result.bars).toEqual([]);
		expect(result.provenance.asOf).toBe('2026-09-02T20:00:00.000Z');
		expect(result.provenance.engineVersion).toBe(ENGINE_VERSION);
		expect(result.provenance.priceAdjustment).toBe('adjusted');
	});

	it('returns an empty series for an instrument that holds no bars at all', async () => {
		const result = await port(nvda({ bars: [] })).fetchSeries(request());
		expect(result.bars).toEqual([]);
	});
});

describe('source failure', () => {
	it('raises a typed chart-layer error carrying the underlying cause', async () => {
		const cause = new Error('feed handshake failed');
		const error = await expectChartSeriesError(
			port(nvda({ failure: cause })).fetchSeries(request())
		);
		expect(error.reason).toBe('source_unavailable');
		expect(error.cause).toBe(cause);
		expect(error.instrumentId).toBe('instrument_nvda');
		expect(error.name).toBe('ChartSeriesError');
	});

	it('rejects an instrument the source does not carry', async () => {
		const error = await expectChartSeriesError(
			port(nvda()).fetchSeries(request({ instrumentId: 'instrument_unlisted' }))
		);
		expect(error.reason).toBe('unknown_instrument');
	});

	it('rejects a timeframe the instrument is not loaded at, naming what is loaded', async () => {
		const error = await expectChartSeriesError(
			port(nvda()).fetchSeries(request({ timeframe: '1wk' }))
		);
		expect(error.reason).toBe('unsupported_timeframe');
		expect(error.message).toContain('1d');
	});

	it('rejects an inverted window', async () => {
		const error = await expectChartSeriesError(
			port(nvda()).fetchSeries(request({ window: { start: '2026-01-09', end: '2026-01-02' } }))
		);
		expect(error.reason).toBe('invalid_window');
	});
});

describe('several instruments and timeframes', () => {
	const weekly = nvda({ timeframe: '1wk', bars: [bar('2026-01-05', 12)] });
	const msft = nvda({ instrumentId: 'instrument_msft', bars: [bar('2026-01-02', 400)] });

	it('serves each instrument its own bars', async () => {
		const result = await port(nvda(), msft).fetchSeries(
			request({ instrumentId: 'instrument_msft' })
		);
		expect(result.bars.map((entry) => entry.close)).toEqual([400]);
	});

	it('serves each timeframe its own bars', async () => {
		const result = await port(nvda(), weekly).fetchSeries(request({ timeframe: '1wk' }));
		expect(result.bars.map((entry) => entry.time)).toEqual(['2026-01-05']);
	});
});
