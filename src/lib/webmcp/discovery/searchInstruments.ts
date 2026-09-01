// `search_instruments`: free text in, canonical instrument IDs out. The first
// tool an agent reaches for, because every other tool wants an ID it cannot
// invent.
//
// API layer: imports domain (the port) and infra (the unconfigured adapter's
// source ID); nothing imports this back.

import {
	clampInstrumentLimit,
	MAX_INSTRUMENT_RESULTS,
	type AssetType,
	type InstrumentDirectory,
	type InstrumentQuery
} from '../../discovery/ports';
import { UNCONFIGURED_SOURCE_ID } from '../../discovery/unavailableDirectory';
import type { ToolResult, ToolSpec } from '../types';
import {
	fail,
	ok,
	readBooleanArg,
	readNumberArg,
	readStringArg,
	readStringArrayArg
} from './results';

const ASSET_TYPES: AssetType[] = [
	'equity',
	'etf',
	'adr',
	'fund',
	'index',
	'future',
	'fx',
	'crypto'
];

const DESCRIPTION =
	'Resolve free text naming a company or ticker into canonical instrument IDs. ' +
	'Returns ranked candidates, each with its canonical instrumentId, symbol, name, ' +
	'exchange and MIC, asset type, country, trading currency, primary-listing flag, ' +
	'listing status, match score, and which attribute matched. Pass the instrumentId ' +
	'(never the bare symbol) to every other tool that takes an instrument. Several ' +
	'candidates means the text was ambiguous -- ask the user which listing they mean ' +
	'rather than taking the top hit. An empty candidate list with outcome ' +
	'"source_unavailable" means no reference-data source is configured here: ' +
	'instrument-scoped work cannot proceed, and no amount of rephrasing will help.';

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		query: {
			type: 'string',
			minLength: 1,
			description: 'Free text: a ticker, a company name, or part of one. E.g. "apple", "AAPL".'
		},
		assetTypes: {
			type: 'array',
			items: { type: 'string', enum: ASSET_TYPES },
			description: 'Restrict to these asset types. Omit to search all.'
		},
		exchangeIds: {
			type: 'array',
			items: { type: 'string' },
			description: 'Restrict to these internal exchange IDs, as returned in a previous result.'
		},
		countryCodes: {
			type: 'array',
			items: { type: 'string' },
			description: 'Restrict to these ISO 3166-1 alpha-2 country codes, e.g. ["US", "GB"].'
		},
		includeDelisted: {
			type: 'boolean',
			description: 'Include delisted listings. Defaults to false.'
		},
		limit: {
			type: 'integer',
			minimum: 1,
			maximum: MAX_INSTRUMENT_RESULTS,
			description: `Maximum candidates to return. Clamped to ${MAX_INSTRUMENT_RESULTS}.`
		}
	},
	required: ['query']
};

function buildQuery(input: unknown, text: string): { query: InstrumentQuery; warnings: string[] } {
	const requested = readNumberArg(input, 'limit');
	const { limit, clamped } = clampInstrumentLimit(requested);
	const assetTypes = readStringArrayArg(input, 'assetTypes')?.filter((value): value is AssetType =>
		(ASSET_TYPES as string[]).includes(value)
	);
	return {
		query: {
			text,
			assetTypes,
			exchangeIds: readStringArrayArg(input, 'exchangeIds'),
			countryCodes: readStringArrayArg(input, 'countryCodes'),
			includeDelisted: readBooleanArg(input, 'includeDelisted') ?? false,
			limit
		},
		warnings: clamped
			? [`Requested limit ${requested} was clamped to the maximum of ${limit}.`]
			: []
	};
}

async function execute(directory: InstrumentDirectory, input: unknown): Promise<ToolResult> {
	// The declared schema requires `query`, but a bridge is not obliged to
	// enforce it, so the rejection happens here -- before any lookup.
	const text = readStringArg(input, 'query')?.trim();
	if (!text) {
		return fail(
			'search_instruments requires a non-empty "query" string naming a ticker or company.',
			{
				receivedInput: input
			}
		);
	}

	const { query, warnings } = buildQuery(input, text);
	let envelope;
	try {
		envelope = await directory.searchInstruments(query);
	} catch (error) {
		return fail(
			`Instrument lookup failed for "${text}": ${error instanceof Error ? error.message : String(error)}`,
			{ query: text }
		);
	}

	const unavailable = envelope.provenance.sourceId === UNCONFIGURED_SOURCE_ID;
	const candidates = envelope.data.map((match) => ({
		instrumentId: match.instrument.instrumentId,
		symbol: match.instrument.symbol,
		name: match.instrument.name,
		exchangeId: match.instrument.exchangeId,
		exchangeMic: match.instrument.exchangeMic,
		assetType: match.instrument.assetType,
		countryCode: match.instrument.countryCode,
		// Per candidate, not on the envelope: a multi-venue result spans
		// currencies and one global figure would be wrong for most rows.
		currency: match.instrument.currency,
		primaryListing: match.instrument.primaryListing,
		status: match.instrument.status,
		score: match.score,
		matchedOn: match.matchedOn
	}));

	return ok({
		query: text,
		appliedFilters: {
			assetTypes: query.assetTypes ?? null,
			exchangeIds: query.exchangeIds ?? null,
			countryCodes: query.countryCodes ?? null,
			includeDelisted: query.includeDelisted ?? false
		},
		limit: query.limit,
		outcome: unavailable ? 'source_unavailable' : candidates.length > 0 ? 'matches' : 'no_matches',
		note: outcomeNote(text, unavailable, candidates.length),
		matchCount: candidates.length,
		candidates,
		provenance: envelope.provenance,
		warnings: [...envelope.warnings, ...warnings]
	});
}

function outcomeNote(text: string, unavailable: boolean, count: number): string {
	if (unavailable) {
		return (
			'No reference-data source is configured, so no instrument can be resolved here. ' +
			'This is not a failed search: nothing would match any query. Ask the user for an ' +
			'explicit identifier instead of retrying.'
		);
	}
	if (count === 0) {
		return `No instrument matched "${text}".`;
	}
	if (count > 1) {
		return (
			`${count} listings match "${text}". They are ranked, not resolved -- confirm which ` +
			'one the user means before using an ID.'
		);
	}
	return `One instrument matched "${text}".`;
}

export function createSearchInstrumentsTool(directory: InstrumentDirectory): ToolSpec {
	return {
		name: 'search_instruments',
		description: DESCRIPTION,
		inputSchema: INPUT_SCHEMA,
		// Discovery precedes state: there is nothing for an availability
		// predicate to gate on.
		available: () => true,
		execute: (input) => execute(directory, input)
	};
}
