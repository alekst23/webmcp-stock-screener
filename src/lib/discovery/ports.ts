// The instrument directory port: the integration seam between this program and
// whoever eventually sources reference data (exchanges, listings, asset types,
// countries, currencies). No workstream owns that data today and sourcing it is
// an open project decision, so this file is deliberately the *contract only* --
// the shipped default adapter reports honest unavailability rather than
// inventing instruments (see unavailableDirectory.ts).
//
// Domain layer. Imports nothing that performs I/O, and never imports an
// adapter: dependency direction runs infra -> domain, not the reverse.

import type { DiscoveryEnvelope } from '../surface/provenance';

export type AssetType = 'equity' | 'etf' | 'adr' | 'fund' | 'index' | 'future' | 'fx' | 'crypto';

export type ListingStatus = 'active' | 'delisted' | 'suspended';

export interface Instrument {
	// Canonical and opaque. Distinct from `symbol` by construction: callers must
	// never parse it back into a ticker, and a provider that mints its own
	// stable identifiers may supply those instead of the `inst:<MIC>:<SYMBOL>`
	// form ids.ts builds (spec.md Open Question 2).
	instrumentId: string;
	// Display ticker. Identity, not identifier -- it is reassigned over time and
	// collides across venues, which is the whole reason instrumentId exists.
	symbol: string;
	name: string;
	exchangeId: string;
	// ISO 10383.
	exchangeMic: string;
	assetType: AssetType;
	// ISO 3166-1 alpha-2.
	countryCode: string;
	// ISO 4217 trading currency. Per instrument, not per envelope: a multi-venue
	// result spans currencies.
	currency: string;
	primaryListing: boolean;
	status: ListingStatus;
	isin?: string;
	figi?: string;
	// ISO dates.
	listedFrom?: string;
	listedTo?: string;
}

export type InstrumentMatchAttribute = 'symbol' | 'name' | 'alias' | 'isin' | 'figi';

export interface InstrumentMatch {
	instrument: Instrument;
	// Higher is a better match. Relative within one result set only.
	score: number;
	// Which attribute matched, so an ambiguous resolution can be explained to
	// the user rather than silently resolved to the top hit.
	matchedOn: InstrumentMatchAttribute;
}

// The most results any implementation may return for one search. Declared here
// so both the adapter and the tool layer clamp against the same number, and so
// an unbounded search is not expressible.
export const MAX_INSTRUMENT_RESULTS = 50;

export const DEFAULT_INSTRUMENT_RESULTS = 10;

export interface InstrumentQuery {
	text: string;
	assetTypes?: AssetType[];
	exchangeIds?: string[];
	// ISO 3166-1 alpha-2.
	countryCodes?: string[];
	// Defaults to false: a delisted listing is rarely what a user meant.
	includeDelisted?: boolean;
	// Clamped to MAX_INSTRUMENT_RESULTS by the implementation, which adds a
	// warning to the envelope when it clamps.
	limit?: number;
}

// Clamps to [1, MAX_INSTRUMENT_RESULTS] and reports whether it had to, so the
// caller can warn the agent rather than silently truncating.
export function clampInstrumentLimit(limit: number | undefined): {
	limit: number;
	clamped: boolean;
} {
	if (limit === undefined) {
		return { limit: DEFAULT_INSTRUMENT_RESULTS, clamped: false };
	}
	const floored = Math.floor(limit);
	if (!Number.isFinite(floored) || floored < 1) {
		return { limit: 1, clamped: true };
	}
	if (floored > MAX_INSTRUMENT_RESULTS) {
		return { limit: MAX_INSTRUMENT_RESULTS, clamped: true };
	}
	return { limit: floored, clamped: false };
}

// Implemented by whoever eventually sources reference data. The implementer's
// checklist -- what to put in every provenance field, why `currency` is per
// instrument, why ambiguity must return several ranked candidates -- is in
// docs/design/discovery-and-catalog/technical.md.
export interface InstrumentDirectory {
	// Ambiguity ("Apple" matches several listings) is the normal case: return
	// every candidate ranked, never pre-select one.
	searchInstruments(query: InstrumentQuery): Promise<DiscoveryEnvelope<InstrumentMatch[]>>;
	// Resolves `data: null` for an unknown ID -- an explicit not-found outcome,
	// never a throw and never a fabricated record. Genuine source failures
	// (network, auth) do reject; the tool layer maps those to error results.
	getInstrument(instrumentId: string): Promise<DiscoveryEnvelope<Instrument | null>>;
}
