import { describe, expect, it } from 'vitest';
import {
	CATALOG_ID_PREFIXES,
	isCatalogItemId,
	isInstrumentId,
	makeCatalogItemId,
	makeInstrumentId,
	parseInstrumentId
} from './ids';

describe('instrument IDs', () => {
	it('test_instrument_id_is_namespaced_and_distinct_from_the_bare_symbol', () => {
		const id = makeInstrumentId('XNAS', 'AAPL');
		expect(id, `expected a namespaced ID, got ${id}`).toBe('inst:XNAS:AAPL');
		expect(id, 'an instrument ID must never equal the bare ticker').not.toBe('AAPL');
	});

	it('test_bare_ticker_is_rejected_by_the_instrument_id_checker', () => {
		for (const bare of ['AAPL', 'aapl', 'BRK.B']) {
			expect(isInstrumentId(bare), `bare ticker "${bare}" was accepted as an instrument ID`).toBe(
				false
			);
		}
	});

	it('test_well_formed_instrument_id_is_accepted', () => {
		expect(isInstrumentId('inst:XNAS:AAPL'), 'a well-formed instrument ID was rejected').toBe(true);
		expect(isInstrumentId('inst:XNYS:BRK.B'), 'a dotted symbol was rejected').toBe(true);
	});

	it('test_non_string_and_malformed_values_are_rejected', () => {
		for (const value of [
			undefined,
			null,
			42,
			{},
			'inst:XNAS:',
			'inst:TOOLONG:AAPL',
			'inst::AAPL'
		]) {
			expect(
				isInstrumentId(value),
				`malformed value ${JSON.stringify(value)} was accepted as an instrument ID`
			).toBe(false);
		}
	});

	it('test_building_an_id_from_an_invalid_mic_fails_loudly', () => {
		expect(
			() => makeInstrumentId('NASDAQ', 'AAPL'),
			'a non-MIC exchange code was accepted'
		).toThrow(/MIC/);
	});

	it('test_parseInstrumentId_recovers_the_mic_and_symbol_it_was_built_from', () => {
		const parsed = parseInstrumentId(makeInstrumentId('XNAS', 'AAPL'));
		expect(parsed, 'expected a well-formed instrument ID to parse').not.toBeNull();
		expect(parsed?.exchangeMic, 'expected the MIC recovered verbatim').toBe('XNAS');
		expect(parsed?.symbol, 'expected the symbol recovered verbatim').toBe('AAPL');
	});

	it('test_parseInstrumentId_returns_null_rather_than_throwing_for_a_non_instrument_id', () => {
		for (const value of ['AAPL', 'I1', 'inst:XNAS:', '']) {
			expect(
				parseInstrumentId(value),
				`expected "${value}" to parse as null, not throw or fabricate parts`
			).toBeNull();
		}
	});
});

describe('catalog item IDs', () => {
	it('test_every_declared_prefix_produces_a_well_formed_id', () => {
		for (const prefix of CATALOG_ID_PREFIXES) {
			const id = makeCatalogItemId(prefix, 'example_item');
			expect(isCatalogItemId(id), `ID "${id}" for prefix "${prefix}" was not recognised`).toBe(
				true
			);
		}
	});

	it('test_multi_segment_paths_are_well_formed', () => {
		expect(
			isCatalogItemId(makeCatalogItemId('field', 'price.close')),
			'a dotted field path was rejected'
		).toBe(true);
		expect(isCatalogItemId('interval.1d'), 'a numeric interval segment was rejected').toBe(true);
		expect(isCatalogItemId('op.crosses_above'), 'an underscored operator ID was rejected').toBe(
			true
		);
	});

	it('test_unprefixed_or_malformed_values_are_rejected', () => {
		for (const value of ['rsi', 'RSI14', 'study', 'study.', 'unknownkind.thing', 'study.RSI', 7]) {
			expect(
				isCatalogItemId(value),
				`malformed value ${JSON.stringify(value)} was accepted as a catalog item ID`
			).toBe(false);
		}
	});

	it('test_building_an_id_from_an_invalid_path_fails_loudly', () => {
		expect(
			() => makeCatalogItemId('study', 'Relative Strength'),
			'a path with spaces and capitals was accepted'
		).toThrow(/path/);
	});
});
