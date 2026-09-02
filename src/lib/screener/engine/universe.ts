// Universe resolution (T-1009-7 AC1): a thin wrapper around
// ScreenerMarketData.resolveUniverse, reporting the resulting instrument
// count and an empty-universe warning when appropriate.
//
// ports.ts's resolveUniverse takes the whole UniverseSpec -- inclusion
// criteria, liquidity limits, and exclusions together -- because applying
// AC1's ordering (inclusion, then liquidity, then exclusions, exclusions
// always winning) requires reference data and per-instrument price/volume
// data this narrow port does not expose primitives for beyond that one
// call. That ordering is therefore a property of whatever implements
// ScreenerMarketData, not of this module: "do not build a data pipeline or
// a mock dataset" (ticket, Technical Considerations) is exactly why
// unavailableMarketData.ts's resolveUniverse returns an honest empty list
// rather than this module re-deriving inclusion/liquidity/exclusion logic
// with no data source behind it.
//
// Infra layer: implements evaluation behind the domain port (ports.ts);
// domain code does not import this file.

import type { UniverseSpec } from '../definition';
import type { ScreenerMarketData } from '../ports';
import type { ScreenerWarning } from '../run';
import { PROBLEM_CODES } from '../validation';

export interface UniverseResolution {
	instrumentIds: string[];
	warnings: ScreenerWarning[];
}

export async function resolveEngineUniverse(
	universe: UniverseSpec,
	marketData: ScreenerMarketData
): Promise<UniverseResolution> {
	const instrumentIds = await marketData.resolveUniverse(universe);
	const warnings: ScreenerWarning[] = [];
	if (instrumentIds.length === 0) {
		warnings.push({
			code: PROBLEM_CODES.emptyUniverse,
			message:
				'The universe resolved to zero instruments after inclusion criteria, liquidity limits ' +
				'and exclusions were applied.'
		});
	}
	return { instrumentIds, warnings };
}
