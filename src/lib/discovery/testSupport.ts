// A configurable InstrumentDirectory double for tests, mirroring
// webmcp/testSupport.ts's convention so ports.test.ts and the
// search_instruments tool tests cannot drift into disagreeing about what a
// directory does.
//
// This deliberately lives beside the tests rather than in the shipped default
// path: the sample instruments below are test data, and shipping them as a
// "mock directory" would put invented listings in front of an agent that
// cannot tell them from real ones. The shipped no-source behaviour is
// unavailableDirectory.ts.

import { envelope, makeProvenance, type DiscoveryEnvelope } from '../surface/provenance';
import { makeInstrumentId } from '../surface/ids';
import {
	clampInstrumentLimit,
	type Instrument,
	type InstrumentDirectory,
	type InstrumentMatch,
	type InstrumentMatchAttribute,
	type InstrumentQuery
} from './ports';

export interface FakeDirectoryOptions {
	instruments?: Instrument[];
	// When set, both methods reject with this error, exercising the tool
	// layer's source-failure path.
	failWith?: Error;
	sourceId?: string;
	sourceLabel?: string;
	asOf?: string;
}

export function fakeInstrument(overrides: Partial<Instrument> = {}): Instrument {
	const symbol = overrides.symbol ?? 'AAPL';
	const exchangeMic = overrides.exchangeMic ?? 'XNAS';
	return {
		instrumentId: overrides.instrumentId ?? makeInstrumentId(exchangeMic, symbol),
		symbol,
		name: 'Apple Inc.',
		exchangeId: 'nasdaq',
		exchangeMic,
		assetType: 'equity',
		countryCode: 'US',
		currency: 'USD',
		primaryListing: true,
		status: 'active',
		...overrides
	};
}

function matchAttribute(instrument: Instrument, text: string): InstrumentMatchAttribute | null {
	const needle = text.trim().toLowerCase();
	if (needle === '') {
		return null;
	}
	if (instrument.symbol.toLowerCase().includes(needle)) {
		return 'symbol';
	}
	if (instrument.name.toLowerCase().includes(needle)) {
		return 'name';
	}
	if (instrument.isin?.toLowerCase() === needle) {
		return 'isin';
	}
	if (instrument.figi?.toLowerCase() === needle) {
		return 'figi';
	}
	return null;
}

// Exact symbol beats prefix beats substring, so ordering assertions in caller
// tests are predictable rather than incidental.
function score(instrument: Instrument, text: string, matchedOn: InstrumentMatchAttribute): number {
	const needle = text.trim().toLowerCase();
	const symbol = instrument.symbol.toLowerCase();
	if (matchedOn === 'symbol' && symbol === needle) {
		return 1;
	}
	if (matchedOn === 'symbol') {
		return 0.8;
	}
	if (instrument.name.toLowerCase().startsWith(needle)) {
		return 0.6;
	}
	return 0.4;
}

function passesFilters(instrument: Instrument, query: InstrumentQuery): boolean {
	if (!query.includeDelisted && instrument.status === 'delisted') {
		return false;
	}
	if (query.assetTypes && !query.assetTypes.includes(instrument.assetType)) {
		return false;
	}
	if (query.exchangeIds && !query.exchangeIds.includes(instrument.exchangeId)) {
		return false;
	}
	if (query.countryCodes && !query.countryCodes.includes(instrument.countryCode)) {
		return false;
	}
	return true;
}

export function createFakeInstrumentDirectory(
	options: FakeDirectoryOptions = {}
): InstrumentDirectory {
	const instruments = options.instruments ?? [];
	const build = <T>(data: T, warnings: string[] = []): DiscoveryEnvelope<T> =>
		envelope(
			data,
			makeProvenance({
				asOf: options.asOf ?? '2026-09-01T00:00:00Z',
				sourceId: options.sourceId ?? 'src.instruments.fake',
				sourceLabel: options.sourceLabel ?? 'Test instrument directory',
				delivery: 'static',
				timezone: 'UTC'
			}),
			warnings
		);

	return {
		async searchInstruments(query: InstrumentQuery) {
			if (options.failWith) {
				throw options.failWith;
			}
			const { limit, clamped } = clampInstrumentLimit(query.limit);
			const matches: InstrumentMatch[] = [];
			for (const instrument of instruments) {
				if (!passesFilters(instrument, query)) {
					continue;
				}
				const matchedOn = matchAttribute(instrument, query.text);
				if (matchedOn) {
					matches.push({ instrument, matchedOn, score: score(instrument, query.text, matchedOn) });
				}
			}
			matches.sort((a, b) => b.score - a.score);
			const warnings = clamped ? [`Result limit clamped to ${limit}.`] : [];
			return build(matches.slice(0, limit), warnings);
		},
		async getInstrument(instrumentId: string) {
			if (options.failWith) {
				throw options.failWith;
			}
			return build(instruments.find((i) => i.instrumentId === instrumentId) ?? null);
		}
	};
}
