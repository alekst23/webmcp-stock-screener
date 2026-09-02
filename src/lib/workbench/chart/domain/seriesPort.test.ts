import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, toWireProvenance } from '../../domain/provenance';
import {
	adjustmentWarning,
	assertBoundedWindow,
	barsWithinWindow,
	buildSeriesProvenance,
	ChartSeriesError,
	parseWindowBound,
	toProvenancePriceAdjustment,
	type ChartSeriesLiveness,
	type ChartSeriesRequest,
	type ChartSeriesWindow,
	type OhlcvBar
} from './seriesPort';

function bar(time: string, close: number): OhlcvBar {
	return { time, open: close, high: close, low: close, close, volume: 1_000 };
}

// These assertions are checked by `npm run typecheck`, not by vitest: an
// unnecessary @ts-expect-error is itself a compile error, so each case fails
// the build the moment the type stops forbidding what it claims to forbid.
describe('boundedness is a property of the type, not of a runtime check', () => {
	it('cannot express a request with no window at all', () => {
		// @ts-expect-error the window is required; "fetch everything" does not compile
		const unbounded: ChartSeriesRequest = {
			instrumentId: 'instrument_1',
			timeframe: '1d',
			priceAdjustment: 'adjusted',
			session: 'regular'
		};
		expect(unbounded).toBeDefined();
	});

	it('cannot express an "all" or "max" window token', () => {
		// @ts-expect-error a window is two explicit bounds, never a token
		const everything: ChartSeriesWindow = 'all';
		expect(everything).toBeDefined();
	});

	it('cannot express a window with only one bound', () => {
		// @ts-expect-error both bounds are required
		const openEnded: ChartSeriesWindow = { start: '2026-01-01' };
		expect(openEnded).toBeDefined();
	});

	it('cannot describe a delayed source without stating the delay', () => {
		// @ts-expect-error the delayed arm requires delaySeconds
		const liveness: ChartSeriesLiveness = { liveness: 'delayed' };
		expect(liveness).toBeDefined();
	});

	it('cannot attach a delay figure to a source that is not delayed', () => {
		// @ts-expect-error only the delayed arm carries a delay magnitude
		const liveness: ChartSeriesLiveness = { liveness: 'historical', delaySeconds: 900 };
		expect(liveness).toBeDefined();
	});
});

describe('assertBoundedWindow', () => {
	it('accepts an ordered window', () => {
		expect(() =>
			assertBoundedWindow({ start: '2026-01-02', end: '2026-01-09' }, 'instrument_1')
		).not.toThrow();
	});

	it('accepts a single-instant window', () => {
		expect(() =>
			assertBoundedWindow({ start: '2026-01-02', end: '2026-01-02' }, 'instrument_1')
		).not.toThrow();
	});

	it('rejects an inverted window naming both bounds', () => {
		let thrown: unknown;
		try {
			assertBoundedWindow({ start: '2026-01-09', end: '2026-01-02' }, 'instrument_1');
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(ChartSeriesError);
		const error = thrown as ChartSeriesError;
		expect(error.reason).toBe('invalid_window');
		expect(error.message).toContain('2026-01-09');
		expect(error.message).toContain('2026-01-02');
		expect(error.instrumentId).toBe('instrument_1');
	});

	it('rejects an unparseable bound', () => {
		expect(() => assertBoundedWindow({ start: 'whenever', end: '2026-01-02' }, 'i')).toThrow(
			ChartSeriesError
		);
	});
});

describe('parseWindowBound', () => {
	it('returns null rather than NaN for a bound that is not a timestamp', () => {
		expect(parseWindowBound('not-a-date')).toBeNull();
	});
});

describe('barsWithinWindow', () => {
	const bars = [bar('2026-01-05', 3), bar('2026-01-02', 1), bar('2026-01-09', 5)];

	it('keeps only bars inside the window, inclusive of both bounds', () => {
		const kept = barsWithinWindow(bars, { start: '2026-01-02', end: '2026-01-05' });
		expect(kept.map((entry) => entry.time)).toEqual(['2026-01-02', '2026-01-05']);
	});

	it('sorts the kept bars ascending regardless of source order', () => {
		const kept = barsWithinWindow(bars, { start: '2026-01-01', end: '2026-01-31' });
		expect(kept.map((entry) => entry.time)).toEqual(['2026-01-02', '2026-01-05', '2026-01-09']);
	});

	it('returns an empty list for a window that contains no bars', () => {
		expect(barsWithinWindow(bars, { start: '2026-02-01', end: '2026-02-28' })).toEqual([]);
	});
});

describe('toProvenancePriceAdjustment', () => {
	it('reports split-adjusted prices as adjusted, the coarser truth', () => {
		expect(toProvenancePriceAdjustment('split_adjusted')).toBe('adjusted');
	});

	it('never widens unadjusted prices into adjusted ones', () => {
		expect(toProvenancePriceAdjustment('unadjusted')).toBe('unadjusted');
	});

	it('passes adjusted through', () => {
		expect(toProvenancePriceAdjustment('adjusted')).toBe('adjusted');
	});
});

describe('adjustmentWarning', () => {
	it('is silent when the source honoured the request', () => {
		expect(adjustmentWarning('adjusted', 'adjusted')).toBeNull();
	});

	it('names both policies when they differ', () => {
		const warning = adjustmentWarning('unadjusted', 'adjusted');
		expect(warning).toContain('unadjusted');
		expect(warning).toContain('adjusted');
	});

	it('says the basis is unknown when the source states none', () => {
		const warning = adjustmentWarning('adjusted', null);
		expect(warning).toContain('does not state');
	});
});

describe('buildSeriesProvenance', () => {
	const base = {
		asOf: '2026-09-02T20:00:00.000Z',
		sourceId: 'src.panel.stored',
		sourceLabel: 'Stored price panel',
		timezone: 'America/New_York',
		currency: 'USD'
	};

	it('stamps the shared engine version rather than taking one from the caller', () => {
		const provenance = buildSeriesProvenance({
			...base,
			liveness: 'historical',
			appliedPriceAdjustment: 'adjusted'
		});
		expect(provenance.engineVersion).toBe(ENGINE_VERSION);
	});

	it('carries the delay magnitude for a delayed source', () => {
		const provenance = buildSeriesProvenance({
			...base,
			liveness: 'delayed',
			delaySeconds: 900,
			appliedPriceAdjustment: 'adjusted'
		});
		expect(provenance.liveness).toBe('delayed');
		expect(provenance.delaySeconds).toBe(900);
	});

	it('carries no delay figure for a non-delayed source', () => {
		const provenance = buildSeriesProvenance({
			...base,
			liveness: 'historical',
			appliedPriceAdjustment: 'adjusted'
		});
		expect('delaySeconds' in provenance).toBe(false);
	});

	it('omits price adjustment entirely when the source states no basis', () => {
		const provenance = buildSeriesProvenance({
			...base,
			liveness: 'historical',
			appliedPriceAdjustment: null
		});
		expect('priceAdjustment' in provenance).toBe(false);
		expect('price_adjustment' in toWireProvenance(provenance)).toBe(false);
	});

	it('reports the applied basis, not a requested one', () => {
		const provenance = buildSeriesProvenance({
			...base,
			liveness: 'historical',
			appliedPriceAdjustment: 'unadjusted'
		});
		expect(provenance.priceAdjustment).toBe('unadjusted');
	});

	it('omits currency when the source does not state one', () => {
		const provenance = buildSeriesProvenance({
			asOf: base.asOf,
			sourceId: base.sourceId,
			sourceLabel: base.sourceLabel,
			timezone: base.timezone,
			liveness: 'historical',
			appliedPriceAdjustment: 'adjusted'
		});
		expect('currency' in provenance).toBe(false);
	});

	it('passes a reporting period through when one is supplied', () => {
		const provenance = buildSeriesProvenance({
			...base,
			liveness: 'historical',
			appliedPriceAdjustment: 'adjusted',
			reportingPeriod: {
				basis: 'fiscal_quarter',
				periodEnd: '2026-06-30',
				fiscalYear: 2026,
				fiscalQuarter: 2
			}
		});
		expect(provenance.reportingPeriod?.periodEnd).toBe('2026-06-30');
	});

	it('omits the reporting period when no fundamentals contributed', () => {
		const provenance = buildSeriesProvenance({
			...base,
			liveness: 'historical',
			appliedPriceAdjustment: 'adjusted'
		});
		expect('reportingPeriod' in provenance).toBe(false);
	});
});

describe('ChartSeriesError', () => {
	it('keeps the underlying transport failure reachable as its cause', () => {
		const transport = new TypeError('Failed to fetch');
		const error = new ChartSeriesError('source_unavailable', 'source down', { cause: transport });
		expect(error.cause).toBe(transport);
	});

	it('serializes to a machine-readable wire error', () => {
		const error = new ChartSeriesError('unknown_instrument', 'nope', {
			instrumentId: 'instrument_9'
		});
		expect(error.toWireError()).toEqual({
			error: 'chart_series_unknown_instrument',
			message: 'nope',
			reason: 'unknown_instrument',
			instrument_id: 'instrument_9'
		});
	});
});
