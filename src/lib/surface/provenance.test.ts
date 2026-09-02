import { describe, expect, it } from 'vitest';
import {
	ENGINE_VERSION,
	envelope,
	makeProvenance,
	type Provenance,
	type ProvenanceInput
} from './provenance';

function staticInput(overrides: Partial<ProvenanceInput> = {}): ProvenanceInput {
	return {
		asOf: '2026-09-01T00:00:00Z',
		sourceId: 'src.catalog.builtin',
		sourceLabel: 'Built-in catalog',
		delivery: 'static',
		timezone: 'UTC',
		...overrides
	} as ProvenanceInput;
}

describe('makeProvenance', () => {
	it('test_minimal_record_carries_every_required_field', () => {
		const p = makeProvenance(staticInput());
		expect(p.asOf, `asOf missing from ${JSON.stringify(p)}`).toBe('2026-09-01T00:00:00Z');
		expect(p.sourceId, `sourceId missing from ${JSON.stringify(p)}`).toBe('src.catalog.builtin');
		expect(p.sourceLabel, `sourceLabel missing from ${JSON.stringify(p)}`).toBe('Built-in catalog');
		expect(p.delivery, `delivery missing from ${JSON.stringify(p)}`).toBe('static');
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

	it('test_delayed_delivery_states_the_delay_magnitude', () => {
		const p = makeProvenance(staticInput({ delivery: 'delayed', delaySeconds: 900 }));
		expect(p.delivery, `expected delayed delivery, got ${p.delivery}`).toBe('delayed');
		expect(
			p.delaySeconds,
			`a delayed record must state its magnitude, got ${JSON.stringify(p)}`
		).toBe(900);
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
		).toEqual(['asOf', 'delivery', 'engineVersion', 'sourceId', 'sourceLabel', 'timezone']);
	});

	it('test_monetary_and_fundamental_payloads_state_currency_adjustment_and_period', () => {
		const p = makeProvenance(
			staticInput({
				delivery: 'end_of_day',
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
});

describe('envelope', () => {
	it('test_payload_round_trips_with_provenance_and_no_warnings_by_default', () => {
		const provenance: Provenance = makeProvenance(staticInput());
		const result = envelope({ items: ['a'] }, provenance);
		expect(result.data, `payload not preserved: ${JSON.stringify(result)}`).toEqual({
			items: ['a']
		});
		expect(result.provenance, `provenance not preserved: ${JSON.stringify(result)}`).toBe(
			provenance
		);
		expect(result.warnings, `expected no warnings, got ${JSON.stringify(result.warnings)}`).toEqual(
			[]
		);
	});

	it('test_warnings_are_carried_alongside_a_successful_payload', () => {
		const result = envelope([], makeProvenance(staticInput()), ['limit clamped to 50']);
		expect(result.warnings, `warnings not carried: ${JSON.stringify(result)}`).toEqual([
			'limit clamped to 50'
		]);
	});
});
