import { describe, expect, it } from 'vitest';
import {
	ENGINE_VERSION,
	makeProvenance,
	toWireProvenance,
	withProvenance,
	type MarketDataProvenance,
	type ProvenanceInput
} from './provenance';
import type { ProvenanceSource } from './ports';

function staticInput(overrides: Partial<ProvenanceInput> = {}): ProvenanceInput {
	return {
		asOf: '2026-09-01T00:00:00Z',
		sourceId: 'src.catalog.builtin',
		sourceLabel: 'Built-in catalog',
		liveness: 'static',
		timezone: 'UTC',
		...overrides
	} as ProvenanceInput;
}

const LIVE_PROVENANCE: MarketDataProvenance = makeProvenance({
	asOf: '2026-09-02T14:30:00.000Z',
	sourceId: 'eodhd',
	sourceLabel: 'EOD Historical Data',
	liveness: 'live',
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'adjusted'
});

const DELAYED_WITH_FUNDAMENTALS: MarketDataProvenance = makeProvenance({
	asOf: '2026-09-02T14:00:00.000Z',
	sourceId: 'eodhd',
	sourceLabel: 'EOD Historical Data',
	liveness: 'delayed',
	delaySeconds: 900,
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'not_applicable',
	reportingPeriod: {
		basis: 'fiscal_quarter',
		periodEnd: '2026-06-30',
		fiscalYear: 2026,
		fiscalQuarter: 2,
		restated: false
	}
});

describe('makeProvenance', () => {
	it('test_minimal_record_carries_every_required_field', () => {
		const p = makeProvenance(staticInput());
		expect(p.asOf, `asOf missing from ${JSON.stringify(p)}`).toBe('2026-09-01T00:00:00Z');
		expect(p.sourceId, `sourceId missing from ${JSON.stringify(p)}`).toBe('src.catalog.builtin');
		expect(p.sourceLabel, `sourceLabel missing from ${JSON.stringify(p)}`).toBe('Built-in catalog');
		expect(p.liveness, `liveness missing from ${JSON.stringify(p)}`).toBe('static');
		expect(p.timezone, `timezone missing from ${JSON.stringify(p)}`).toBe('UTC');
	});

	it('test_engine_version_comes_from_the_single_declared_constant', () => {
		const a = makeProvenance(staticInput());
		const b = makeProvenance(staticInput({ sourceId: 'src.instruments.unconfigured' }));
		expect(a.engineVersion, `expected the declared version, got ${a.engineVersion}`).toBe(
			ENGINE_VERSION
		);
		expect(
			b.engineVersion,
			`two sources reported different engine versions: ${a.engineVersion} vs ${b.engineVersion}`
		).toBe(a.engineVersion);
	});

	it('test_delayed_liveness_states_the_delay_magnitude', () => {
		const p = makeProvenance(staticInput({ liveness: 'delayed', delaySeconds: 900 }));
		expect(p.liveness, `expected delayed liveness, got ${p.liveness}`).toBe('delayed');
		expect(
			p.delaySeconds,
			`a delayed record must state its magnitude, got ${JSON.stringify(p)}`
		).toBe(900);
	});

	it('test_historical_and_static_are_both_expressible_and_distinct', () => {
		const past = makeProvenance(staticInput({ liveness: 'historical' }));
		const shipped = makeProvenance(staticInput({ liveness: 'static' }));
		expect(past.liveness, `expected historical, got ${past.liveness}`).toBe('historical');
		expect(
			shipped.liveness,
			`static must not collapse into historical, got ${shipped.liveness}`
		).toBe('static');
	});

	it('test_omitted_currency_adjustment_and_period_stay_absent_rather_than_defaulting', () => {
		const p = makeProvenance(staticInput());
		expect('currency' in p, `currency should be absent, got ${JSON.stringify(p)}`).toBe(false);
		expect(
			'priceAdjustment' in p,
			`priceAdjustment should be absent, got ${JSON.stringify(p)}`
		).toBe(false);
		expect(
			'reportingPeriod' in p,
			`reportingPeriod should be absent, got ${JSON.stringify(p)}`
		).toBe(false);
	});

	it('test_explicit_undefined_optionals_are_dropped_not_recorded', () => {
		const p = makeProvenance(
			staticInput({ currency: undefined, priceAdjustment: undefined, reportingPeriod: undefined })
		);
		expect(
			Object.keys(p).sort(),
			`explicit undefined optionals leaked into the record: ${JSON.stringify(p)}`
		).toEqual(['asOf', 'engineVersion', 'liveness', 'sourceId', 'sourceLabel', 'timezone']);
	});

	it('test_monetary_and_fundamental_payloads_state_currency_adjustment_and_period', () => {
		const p = makeProvenance(
			staticInput({
				liveness: 'end_of_day',
				currency: 'USD',
				priceAdjustment: 'adjusted',
				reportingPeriod: {
					basis: 'fiscal_quarter',
					periodEnd: '2026-06-30',
					fiscalYear: 2026,
					fiscalQuarter: 3
				}
			})
		);
		expect(p.currency, `expected USD, got ${p.currency}`).toBe('USD');
		expect(p.priceAdjustment, `expected adjusted, got ${p.priceAdjustment}`).toBe('adjusted');
		expect(
			p.reportingPeriod?.fiscalQuarter,
			`expected Q3, got ${JSON.stringify(p.reportingPeriod)}`
		).toBe(3);
	});

	it('test_trailing_twelve_months_is_representable', () => {
		const p = makeProvenance(
			staticInput({
				reportingPeriod: {
					basis: 'trailing_twelve_months',
					periodEnd: '2026-06-30',
					fiscalYear: 2026
				}
			})
		);
		expect(
			p.reportingPeriod?.basis,
			`TTM must survive the record, got ${JSON.stringify(p.reportingPeriod)}`
		).toBe('trailing_twelve_months');
	});
});

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
			source_id: 'eodhd',
			source_label: 'EOD Historical Data',
			liveness: 'live',
			timezone: 'America/New_York',
			currency: 'USD',
			price_adjustment: 'adjusted',
			engine_version: ENGINE_VERSION
		});
	});

	it('states a duration when data is delayed and includes the reporting period', () => {
		const wire = toWireProvenance(DELAYED_WITH_FUNDAMENTALS);
		expect(wire.delay_seconds).toBe(900);
		expect(wire.reporting_period).toEqual({
			basis: 'fiscal_quarter',
			period_end: '2026-06-30',
			fiscal_year: 2026,
			fiscal_quarter: 2,
			restated: false
		});
	});

	it('never states a misleading duration when data is not delayed', () => {
		const wire = toWireProvenance(LIVE_PROVENANCE);
		expect(
			'delay_seconds' in wire,
			`a live record must not carry a delay, got ${JSON.stringify(wire)}`
		).toBe(false);
	});

	it('omits a reporting period the record does not carry', () => {
		const wire = toWireProvenance(LIVE_PROVENANCE);
		expect(
			'reporting_period' in wire,
			`no fundamentals means no reporting period, got ${JSON.stringify(wire)}`
		).toBe(false);
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
