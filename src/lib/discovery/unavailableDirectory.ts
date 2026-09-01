// The InstrumentDirectory used when no reference-data source is configured --
// which is every deployment today, because nothing sources exchanges,
// listings, countries or currencies for this project yet and no workstream
// owns doing so.
//
// This is the deliberate alternative to a fixture dataset. A mock directory
// would make `search_instruments` look like it works and would put invented
// instruments in front of an agent that cannot tell them from real ones; an
// empty result carrying a stated reason lets the agent distinguish "no such
// instrument" from "instrument resolution is not wired up here".
//
// Infra layer: imports the port, never the reverse.

import { envelope, makeProvenance, type DiscoveryEnvelope } from '../surface/provenance';
import type { Instrument, InstrumentDirectory, InstrumentMatch } from './ports';

export const UNCONFIGURED_SOURCE_ID = 'src.instruments.unconfigured';

export const UNCONFIGURED_REASON =
	'No reference-data source is configured, so no instrument can be resolved. ' +
	'Instrument reference data (exchanges, listings, asset types, countries, ' +
	'currencies) has no source in this project yet. Do not proceed with ' +
	'instrument-scoped work; ask the user for an explicit identifier instead.';

// `static` rather than `live`: there is no feed behind this, and claiming a
// delivery status the source cannot honour is the failure mode this whole
// adapter exists to avoid.
function unconfiguredEnvelope<T>(data: T): DiscoveryEnvelope<T> {
	return envelope(
		data,
		makeProvenance({
			asOf: new Date().toISOString(),
			sourceId: UNCONFIGURED_SOURCE_ID,
			sourceLabel: 'No reference-data source configured',
			delivery: 'static',
			timezone: 'UTC'
		}),
		[UNCONFIGURED_REASON]
	);
}

// A factory rather than a module-level singleton so composition decides which
// adapter is in use (T-1008-3 AC8) and a real adapter can replace it without
// any consumer being edited.
export function createUnavailableInstrumentDirectory(): InstrumentDirectory {
	// Neither method reads its argument -- there is nothing to search -- so the
	// parameters are omitted rather than accepted and ignored.
	return {
		async searchInstruments(): Promise<DiscoveryEnvelope<InstrumentMatch[]>> {
			return unconfiguredEnvelope<InstrumentMatch[]>([]);
		},
		async getInstrument(): Promise<DiscoveryEnvelope<Instrument | null>> {
			return unconfiguredEnvelope<Instrument | null>(null);
		}
	};
}
