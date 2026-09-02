import { describe, expect, it } from 'vitest';
import { toWireProvenance, withProvenance, type MarketDataProvenance } from './provenance';
import type { ProvenanceSource } from './ports';

const LIVE_PROVENANCE: MarketDataProvenance = {
	asOf: '2026-09-02T14:30:00.000Z',
	source: 'eodhd',
	liveness: 'live',
	delaySeconds: null,
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'adjusted',
	fundamentalsPeriod: null,
	calcEngineVersion: '1.0.0'
};

const DELAYED_WITH_FUNDAMENTALS: MarketDataProvenance = {
	asOf: '2026-09-02T14:00:00.000Z',
	source: 'eodhd',
	liveness: 'delayed',
	delaySeconds: 900,
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'not_applicable',
	fundamentalsPeriod: {
		fiscalYear: 2026,
		fiscalPeriod: 'Q2',
		periodEnd: '2026-06-30',
		restated: false
	},
	calcEngineVersion: '1.0.0'
};

describe('withProvenance', () => {
	it('wraps any payload with its data and provenance together', () => {
		const wrapped = withProvenance({ price: 123.45 }, LIVE_PROVENANCE);
		expect(wrapped.data).toEqual({ price: 123.45 });
		expect(wrapped.provenance).toBe(LIVE_PROVENANCE);
	});
});

describe('toWireProvenance', () => {
	it('serializes to snake_case field names', () => {
		expect(toWireProvenance(LIVE_PROVENANCE)).toEqual({
			as_of: '2026-09-02T14:30:00.000Z',
			source: 'eodhd',
			liveness: 'live',
			delay_seconds: null,
			timezone: 'America/New_York',
			currency: 'USD',
			price_adjustment: 'adjusted',
			fundamentals_period: null,
			calc_engine_version: '1.0.0'
		});
	});

	it('states a duration when data is delayed and includes the fundamentals period', () => {
		const wire = toWireProvenance(DELAYED_WITH_FUNDAMENTALS);
		expect(wire.delay_seconds).toBe(900);
		expect(wire.fundamentals_period).toEqual({
			fiscal_year: 2026,
			fiscal_period: 'Q2',
			period_end: '2026-06-30',
			restated: false
		});
	});

	it('never states a misleading duration when data is not delayed', () => {
		expect(toWireProvenance(LIVE_PROVENANCE).delay_seconds).toBeNull();
	});
});

describe('ProvenanceSource port', () => {
	it('can be satisfied by a fixed-value fake for tests', () => {
		const fake: ProvenanceSource = {
			current: () => LIVE_PROVENANCE
		};
		expect(fake.current('prices')).toBe(LIVE_PROVENANCE);
	});
});
