import { describe, expect, it } from 'vitest';
import { MAX_INSTRUMENT_RESULTS } from '../../discovery/ports';
import { createFakeInstrumentDirectory, fakeInstrument } from '../../discovery/testSupport';
import { createUnavailableInstrumentDirectory } from '../../discovery/unavailableDirectory';
import { isInstrumentId } from '../../surface/ids';
import type { ToolSpec } from '../types';
import { createSearchInstrumentsTool } from './searchInstruments';
import { payload } from './testSupport';

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

function toolWith(instruments = [apple, appleLondon, appleEtf]): ToolSpec {
	return createSearchInstrumentsTool(createFakeInstrumentDirectory({ instruments }));
}

describe('search_instruments', () => {
	it('test_single_match_returns_the_instrument_with_a_canonical_id', async () => {
		const tool = toolWith([apple]);
		const body = payload(await tool.execute({ query: 'AAPL' }));
		expect(body.matchCount, `expected one match, got ${JSON.stringify(body)}`).toBe(1);
		const candidate = (body.candidates as Record<string, unknown>[])[0] ?? {};
		expect(
			isInstrumentId(candidate.instrumentId),
			`"${candidate.instrumentId}" is not a canonical instrument ID`
		).toBe(true);
		expect(candidate.instrumentId, 'the ID must not be the bare ticker').not.toBe('AAPL');
		expect(candidate.exchangeMic, 'the MIC must be reported').toBe('XNAS');
		expect(candidate.currency, 'currency is stated per candidate').toBe('USD');
		expect(candidate.matchedOn, 'the matched attribute must be reported').toBe('symbol');
	});

	it('test_multi_candidate_query_returns_all_of_them_in_descending_score_order', async () => {
		const body = payload(await toolWith().execute({ query: 'Apple' }));
		const candidates = body.candidates as { score: number; instrumentId: string }[];
		expect(
			candidates.length > 1,
			`expected several candidates, got ${JSON.stringify(candidates)}`
		).toBe(true);
		const scores = candidates.map((c) => c.score);
		expect(scores, `candidates are not in descending order: ${JSON.stringify(scores)}`).toEqual(
			[...scores].sort((a, b) => b - a)
		);
		expect(body.note, 'an ambiguous result must tell the agent not to take the top hit').toMatch(
			/ranked, not resolved/
		);
	});

	it('test_narrowing_by_asset_type_and_by_exchange', async () => {
		const byType = payload(await toolWith().execute({ query: 'Apple', assetTypes: ['etf'] }));
		expect(
			(byType.candidates as { symbol: string }[]).map((c) => c.symbol),
			'asset-type narrowing did not filter'
		).toEqual(['AAPU']);

		const byExchange = payload(await toolWith().execute({ query: 'AAPL', exchangeIds: ['lse'] }));
		expect(
			(byExchange.candidates as { exchangeMic: string }[]).map((c) => c.exchangeMic),
			'exchange narrowing did not filter'
		).toEqual(['XLON']);
	});

	it('test_empty_match_is_a_success_naming_the_query', async () => {
		const result = await toolWith().execute({ query: 'zzzznothing' });
		expect(result.isError, 'no match is not an error').toBeFalsy();
		const body = payload(result);
		expect(body.outcome, `expected no_matches, got ${body.outcome}`).toBe('no_matches');
		expect(body.note, 'the note must name the query that found nothing').toContain('zzzznothing');
	});

	it('test_unconfigured_source_reports_unavailable_and_invents_nothing', async () => {
		const tool = createSearchInstrumentsTool(createUnavailableInstrumentDirectory());
		const result = await tool.execute({ query: 'Apple' });
		expect(
			result.isError,
			'an unconfigured source is a well-formed result, not an error'
		).toBeFalsy();
		const body = payload(result);
		expect(body.outcome, `expected source_unavailable, got ${body.outcome}`).toBe(
			'source_unavailable'
		);
		expect(body.candidates, 'no instrument may be fabricated').toEqual([]);
		expect(
			body.note as string,
			`the note must name the missing dependency, got ${body.note}`
		).toMatch(/no reference-data source is configured/i);
	});

	it('test_source_failure_returns_an_error_naming_what_failed', async () => {
		const tool = createSearchInstrumentsTool(
			createFakeInstrumentDirectory({ failWith: new Error('upstream 503') })
		);
		const result = await tool.execute({ query: 'AAPL' });
		expect(result.isError, 'a source failure must be an error result').toBe(true);
		expect(
			payload(result).error as string,
			`the error must name what failed, got ${payload(result).error}`
		).toContain('upstream 503');
	});

	it('test_a_call_without_a_query_is_rejected_before_any_lookup', async () => {
		let searched = false;
		const tool = createSearchInstrumentsTool({
			async searchInstruments() {
				searched = true;
				throw new Error('should never be reached');
			},
			async getInstrument() {
				throw new Error('unused');
			}
		});
		const result = await tool.execute({});
		expect(result.isError, 'a missing query must be an error').toBe(true);
		expect(searched, 'the directory must not be consulted without a query').toBe(false);
	});

	it('test_limit_is_clamped_to_the_documented_maximum_and_warned_about', async () => {
		const many = Array.from({ length: 60 }, (_, i) =>
			fakeInstrument({ symbol: `AAP${i}`, name: `Apple Unit ${i}` })
		);
		const body = payload(await toolWith(many).execute({ query: 'Apple', limit: 500 }));
		expect(body.limit, `expected the limit clamped to ${MAX_INSTRUMENT_RESULTS}`).toBe(
			MAX_INSTRUMENT_RESULTS
		);
		expect(
			(body.candidates as unknown[]).length,
			'more candidates were returned than the maximum'
		).toBe(MAX_INSTRUMENT_RESULTS);
		expect(
			(body.warnings as string[]).some((w) => w.includes('clamped')),
			`expected a clamping warning, got ${JSON.stringify(body.warnings)}`
		).toBe(true);
	});

	it('test_result_carries_the_full_provenance_envelope', async () => {
		const body = payload(await toolWith().execute({ query: 'AAPL' }));
		const provenance = body.provenance as Record<string, unknown>;
		for (const field of [
			'asOf',
			'sourceId',
			'sourceLabel',
			'liveness',
			'timezone',
			'engineVersion'
		]) {
			expect(provenance[field], `provenance is missing "${field}"`).toBeTruthy();
		}
	});

	it('test_the_tool_is_read_only_and_always_available', async () => {
		const tool = toolWith();
		const schema = tool.inputSchema as { properties: Record<string, unknown> };
		for (const mutationKey of ['expected_revision', 'idempotency_key', 'undo_token']) {
			expect(
				mutationKey in schema.properties,
				`a read-only tool must not declare "${mutationKey}"`
			).toBe(false);
		}
		expect(
			tool.available({ studies: [], setups: [], instanceSets: [], panels: [], focus: null }),
			'discovery precedes state, so the tool is always available'
		).toBe(true);
	});
});
