// define_screener's universe payload (T-0026-1): wire-to-domain mapping
// plus the catalog-membership problem shaping, split out of
// defineScreener.ts to keep that file under the project's size guidance.
// normalizeUniverse (screener/definition.ts) and checkUniverseCatalogMembership
// (screener/universeValidation.ts) are reused, not reimplemented, matching
// set_screener_universe.ts's own wire-mapping convention.

import type { CatalogRegistry } from '../../catalog/registry';
import { normalizeUniverse, type UniverseSpec } from '../../screener/definition';
import { checkUniverseCatalogMembership } from '../../screener/universeValidation';
import { PROBLEM_CODES, type ValidationProblem } from '../../screener/validation';

interface UniverseWireInput {
	asset_class?: unknown;
	exchanges?: unknown;
	countries?: unknown;
	sectors?: unknown;
	industries?: unknown;
	indexes?: unknown;
	watchlists?: unknown;
	liquidity?: {
		min_price?: unknown;
		min_average_volume?: unknown;
		min_market_cap?: unknown;
	};
	exclusions?: {
		instrument_ids?: unknown;
		sector_ids?: unknown;
		industry_ids?: unknown;
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildUniverseSpec(raw: unknown): UniverseSpec {
	const input = (isRecord(raw) ? raw : {}) as UniverseWireInput;
	return normalizeUniverse({
		assetClass: input.asset_class,
		exchanges: input.exchanges,
		countries: input.countries,
		sectors: input.sectors,
		industries: input.industries,
		indexes: input.indexes,
		watchlists: input.watchlists,
		liquidity: {
			minPrice: input.liquidity?.min_price,
			minAverageVolume: input.liquidity?.min_average_volume,
			minMarketCap: input.liquidity?.min_market_cap
		},
		exclusions: {
			instrumentIds: input.exclusions?.instrument_ids,
			sectorIds: input.exclusions?.sector_ids,
			industryIds: input.exclusions?.industry_ids
		}
	});
}

function unknownIndexProblem(
	unknownIds: string[],
	suggestions: Record<string, string[]>
): ValidationProblem {
	const parts = unknownIds.map((id) => {
		const near = suggestions[id] ?? [];
		return near.length > 0 ? `"${id}" (did you mean: ${near.join(', ')}?)` : `"${id}"`;
	});
	return {
		severity: 'blocking',
		code: PROBLEM_CODES.unknownCatalogItem,
		nodeIds: [],
		universeCriteria: [],
		message: `Unrecognized index ID(s): ${parts.join(', ')}. Use search_catalog (kind "universe") to find valid index IDs.`
	};
}

// AC4: an unrecognized index id is collected as a blocking problem rather
// than rejecting the call immediately -- this is the one thing
// screenerValidation.ts's validateScreenerDefinition does not itself check
// (it only resolves universe *size*, never index membership), so it stays
// here alongside the wire mapping rather than duplicating a second
// universe-validation pass.
export function buildUniverseAndCheckIndexes(
	rawUniverse: unknown,
	registry: CatalogRegistry,
	problems: ValidationProblem[],
	warnings: string[]
): UniverseSpec {
	const universe = buildUniverseSpec(rawUniverse);
	const { unknownIndexIds, suggestionsByIndex, unverifiableWarning } =
		checkUniverseCatalogMembership(universe, registry);
	if (unknownIndexIds.length > 0) {
		problems.push(unknownIndexProblem(unknownIndexIds, suggestionsByIndex));
	}
	if (unverifiableWarning) {
		warnings.push(unverifiableWarning);
	}
	return universe;
}
