import { describe, expect, it } from 'vitest';
import { isInstrumentId } from '../surface/ids';
import { clampInstrumentLimit, MAX_INSTRUMENT_RESULTS } from './ports';
import { createFakeInstrumentDirectory, fakeInstrument } from './testSupport';
import {
	createUnavailableInstrumentDirectory,
	UNCONFIGURED_SOURCE_ID
} from './unavailableDirectory';

const apple = fakeInstrument();
const appleLondon = fakeInstrument({
	symbol: 'AAPL',
	exchangeMic: 'XLON',
	exchangeId: 'lse',
	countryCode: 'GB',
	currency: 'GBP',
	primaryListing: false
});
const appleEtf = fakeInstrument({
	symbol: 'AAPU',
	name: 'Apple Leveraged ETF',
	assetType: 'etf',
	primaryListing: false
});
const delisted = fakeInstrument({
	symbol: 'APPL',
	name: 'Applied Old Corp',
	status: 'delisted',
	primaryListing: false
});

const directory = createFakeInstrumentDirectory({
	instruments: [apple, appleLondon, appleEtf, delisted]
});

describe('InstrumentDirectory contract', () => {
	it('test_matching_search_returns_ranked_candidates_with_matched_attribute', async () => {
		const result = await directory.searchInstruments({ text: 'AAPL' });
		expect(
			result.data.length,
			`expected the two AAPL listings, got ${JSON.stringify(result.data.map((m) => m.instrument.exchangeMic))}`
		).toBe(2);
		const [first, second] = result.data;
		expect(first?.matchedOn, `expected a symbol match, got ${first?.matchedOn}`).toBe('symbol');
		expect(
			(first?.score ?? 0) >= (second?.score ?? 0),
			`candidates are not in descending score order: ${JSON.stringify(result.data.map((m) => m.score))}`
		).toBe(true);
	});

	it('test_ambiguous_text_returns_every_listing_rather_than_pre_selecting_one', async () => {
		const result = await directory.searchInstruments({ text: 'Apple' });
		const mics = result.data.map((m) => m.instrument.exchangeMic);
		expect(
			result.data.length > 1,
			`an ambiguous query must return several candidates, got ${JSON.stringify(mics)}`
		).toBe(true);
	});

	it('test_every_returned_identifier_is_a_namespaced_id_not_a_bare_ticker', async () => {
		const result = await directory.searchInstruments({ text: 'AAPL' });
		for (const match of result.data) {
			expect(
				isInstrumentId(match.instrument.instrumentId),
				`"${match.instrument.instrumentId}" is not a well-formed instrument ID`
			).toBe(true);
			expect(
				match.instrument.instrumentId,
				'the canonical ID must be distinct from the display symbol'
			).not.toBe(match.instrument.symbol);
		}
	});

	it('test_narrowing_by_asset_type_and_exchange_filters_candidates', async () => {
		const etfs = await directory.searchInstruments({ text: 'Apple', assetTypes: ['etf'] });
		expect(
			etfs.data.map((m) => m.instrument.symbol),
			`asset-type narrowing did not filter: ${JSON.stringify(etfs.data.map((m) => m.instrument.symbol))}`
		).toEqual(['AAPU']);

		const london = await directory.searchInstruments({ text: 'AAPL', exchangeIds: ['lse'] });
		expect(
			london.data.map((m) => m.instrument.exchangeMic),
			'exchange narrowing did not filter'
		).toEqual(['XLON']);
	});

	it('test_delisted_instruments_are_omitted_unless_explicitly_requested', async () => {
		const without = await directory.searchInstruments({ text: 'Applied' });
		expect(
			without.data.length,
			`a delisted listing leaked into a default search: ${JSON.stringify(without.data)}`
		).toBe(0);

		const with_ = await directory.searchInstruments({ text: 'Applied', includeDelisted: true });
		expect(with_.data[0]?.instrument.status, 'expected the delisted listing back').toBe('delisted');
	});

	it('test_no_match_search_is_an_empty_success_carrying_provenance', async () => {
		const result = await directory.searchInstruments({ text: 'zzzznothing' });
		expect(result.data, `expected no matches, got ${JSON.stringify(result.data)}`).toEqual([]);
		expect(result.provenance.asOf, 'an empty result still carries provenance').toBeTruthy();
	});

	it('test_unknown_id_fetch_resolves_to_null_rather_than_throwing', async () => {
		const result = await directory.getInstrument('inst:XNAS:NOPE');
		expect(
			result.data,
			`an unknown ID must resolve to null, got ${JSON.stringify(result.data)}`
		).toBeNull();
	});

	it('test_known_id_fetch_returns_the_instrument', async () => {
		const result = await directory.getInstrument(apple.instrumentId);
		expect(result.data?.symbol, `expected AAPL, got ${JSON.stringify(result.data)}`).toBe('AAPL');
	});

	it('test_source_failure_rejects_so_the_tool_layer_can_map_it_to_an_error', async () => {
		const failing = createFakeInstrumentDirectory({ failWith: new Error('upstream 503') });
		await expect(
			failing.searchInstruments({ text: 'AAPL' }),
			'a source failure must reject, not resolve empty'
		).rejects.toThrow('upstream 503');
	});
});

describe('clampInstrumentLimit', () => {
	it('test_an_unbounded_limit_is_clamped_to_the_documented_maximum', () => {
		const clamped = clampInstrumentLimit(10_000);
		expect(clamped.limit, `expected ${MAX_INSTRUMENT_RESULTS}, got ${clamped.limit}`).toBe(
			MAX_INSTRUMENT_RESULTS
		);
		expect(clamped.clamped, 'clamping must be reported so the caller can warn').toBe(true);
	});

	it('test_an_in_range_limit_passes_through_unclamped', () => {
		expect(clampInstrumentLimit(5), 'an in-range limit must pass through').toEqual({
			limit: 5,
			clamped: false
		});
	});

	it('test_a_nonsensical_limit_is_clamped_up_to_one', () => {
		expect(clampInstrumentLimit(0).limit, 'a zero limit must clamp up to 1').toBe(1);
		expect(clampInstrumentLimit(-3).limit, 'a negative limit must clamp up to 1').toBe(1);
	});

	it('test_search_clamps_the_returned_page_and_warns', async () => {
		const many = Array.from({ length: 60 }, (_, i) =>
			fakeInstrument({ symbol: `AAP${i}`, exchangeMic: 'XNAS', name: `Apple Unit ${i}` })
		);
		const big = createFakeInstrumentDirectory({ instruments: many });
		const result = await big.searchInstruments({ text: 'AAP', limit: 500 });
		expect(
			result.data.length,
			`expected at most ${MAX_INSTRUMENT_RESULTS}, got ${result.data.length}`
		).toBe(MAX_INSTRUMENT_RESULTS);
		expect(
			result.warnings.some((w) => w.includes('clamped')),
			`expected a clamping warning, got ${JSON.stringify(result.warnings)}`
		).toBe(true);
	});
});

describe('unavailableInstrumentDirectory', () => {
	const unavailable = createUnavailableInstrumentDirectory();

	it('test_search_returns_a_well_formed_empty_result_naming_the_missing_source', async () => {
		const result = await unavailable.searchInstruments({ text: 'Apple' });
		expect(
			result.data,
			`the default adapter must invent nothing, got ${JSON.stringify(result.data)}`
		).toEqual([]);
		expect(result.provenance.sourceId, 'provenance must mark the source unconfigured').toBe(
			UNCONFIGURED_SOURCE_ID
		);
		expect(result.provenance.delivery, 'an unconfigured source is not a live feed').toBe('static');
		expect(
			result.warnings.join(' '),
			`expected a warning naming the missing source, got ${JSON.stringify(result.warnings)}`
		).toMatch(/no reference-data source is configured/i);
	});

	it('test_fetch_resolves_null_without_throwing', async () => {
		const result = await unavailable.getInstrument('inst:XNAS:AAPL');
		expect(result.data, 'the default adapter must resolve null, not throw').toBeNull();
		expect(result.provenance.engineVersion, 'provenance must still be complete').toBeTruthy();
	});
});
