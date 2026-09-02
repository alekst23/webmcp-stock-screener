// The ScreenerMarketData used when no market-data source is configured --
// which is every deployment today, mirroring
// src/lib/discovery/unavailableDirectory.ts's honest-unavailability pattern.
//
// A mock adapter would let run_screener and validate_screener look like they
// work while inventing prices, series and pattern hits an agent could not
// tell from real data. This adapter instead reports "not wired up" on every
// read, so engine.ts's dataUnavailable/warning machinery is exercised
// honestly rather than papered over with fixture numbers.
//
// Infra layer: implements the domain port (ports.ts), never the reverse.

import { makeProvenance } from '../../workbench/domain/provenance';
import type { ScreenerMarketData, SeriesPoint } from '../ports';

export const UNCONFIGURED_MARKET_DATA_SOURCE_ID = 'src.screener.market_data.unconfigured';

// Factory, not a module-level singleton, mirroring
// createUnavailableInstrumentDirectory -- composition decides which adapter
// is wired in, and a real adapter replaces it without any call site change.
export function createUnavailableMarketData(): ScreenerMarketData {
	return {
		async resolveUniverse(): Promise<string[]> {
			return [];
		},
		async getFieldValue(): Promise<number | string | boolean | null> {
			return null;
		},
		async getSeries(): Promise<SeriesPoint[]> {
			return [];
		},
		async detectPattern(): Promise<{ confidence: number } | null> {
			return null;
		},
		async getStudyOutput(): Promise<number | string | boolean | null> {
			return null;
		},
		async getProvenance() {
			// 'static' rather than 'live'/'delayed': there is no feed behind this
			// adapter, and claiming a liveness it cannot honour is exactly the
			// failure mode this adapter exists to avoid.
			return makeProvenance({
				asOf: new Date().toISOString(),
				sourceId: UNCONFIGURED_MARKET_DATA_SOURCE_ID,
				sourceLabel: 'No market-data source configured',
				liveness: 'static',
				timezone: 'UTC'
			});
		}
	};
}
