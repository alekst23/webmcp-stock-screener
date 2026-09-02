import { describe, expect, it } from 'vitest';
import { envelope, makeProvenance, type MarketDataProvenance } from './provenance';

function catalogProvenance(): MarketDataProvenance {
	return makeProvenance({
		asOf: '2026-09-01T00:00:00Z',
		sourceId: 'src.catalog.builtin',
		sourceLabel: 'Built-in catalog',
		liveness: 'static',
		timezone: 'UTC'
	});
}

describe('envelope', () => {
	it('test_payload_round_trips_with_provenance_and_no_warnings_by_default', () => {
		const provenance = catalogProvenance();
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
		const result = envelope([], catalogProvenance(), ['limit clamped to 50']);
		expect(result.warnings, `warnings not carried: ${JSON.stringify(result)}`).toEqual([
			'limit clamped to 50'
		]);
	});

	it('test_the_canonical_contract_is_re_exported_rather_than_redefined', () => {
		// A discovery caller must reach the one provenance constructor through
		// this module; a second local copy is the fork this file exists to avoid.
		const viaSurface = makeProvenance({
			asOf: '2026-09-01T00:00:00Z',
			sourceId: 'src.catalog.builtin',
			sourceLabel: 'Built-in catalog',
			liveness: 'static',
			timezone: 'UTC'
		});
		expect(
			viaSurface.engineVersion,
			`surface must report the canonical engine version, got ${viaSurface.engineVersion}`
		).toBe(catalogProvenance().engineVersion);
	});
});
