// Universe-level checks `set_screener_universe` (T-1009-3) needs beyond
// T-1009-1's lenient `normalizeUniverse`: strict catalog membership for
// `indexes`, an honest statement of what the catalog cannot verify yet, and
// turning a best-effort resolved instrument count into AC7's warning.
//
// Domain layer: no I/O, no imports from src/lib/webmcp/.

import type { CatalogRegistry } from '../catalog/registry';
import type { UniverseSpec } from './definition';

export interface UniverseCatalogCheck {
	// Non-empty means the whole set_screener_universe call must be rejected
	// (AC6) -- these are the only universe dimension the catalog can actually
	// confirm or deny membership for today (see UNVERIFIABLE_FIELDS below).
	unknownIndexIds: string[];
	suggestionsByIndex: Record<string, string[]>;
	// Advisory only: non-null when exchanges/countries/sectors/industries were
	// supplied but could not be checked against anything.
	unverifiableWarning: string | null;
}

// `CatalogKind` (src/lib/catalog/types.ts) has no 'exchange' | 'country' |
// 'sector' | 'industry' member -- there is no reference-data source for any
// of these four dimensions yet (see DataAvailability.requiresReferenceData
// and src/lib/discovery/unavailableDirectory.ts). Rejecting every value here
// would make these fields impossible to ever set; silently treating them as
// checked would misrepresent what happened. Warning is the honest middle.
const UNVERIFIABLE_FIELDS: ReadonlyArray<{ key: keyof UniverseSpec; label: string }> = [
	{ key: 'exchanges', label: 'exchanges' },
	{ key: 'countries', label: 'countries' },
	{ key: 'sectors', label: 'sectors' },
	{ key: 'industries', label: 'industries' }
];

function buildUnverifiableWarning(universe: UniverseSpec): string | null {
	const supplied = UNVERIFIABLE_FIELDS.filter(
		({ key }) => (universe[key] as string[]).length > 0
	).map(({ label }) => label);
	if (supplied.length === 0) {
		return null;
	}
	return (
		`Catalog membership could not be verified for: ${supplied.join(', ')} -- this project ` +
		'has no reference-data source for exchange, country, sector or industry membership yet. ' +
		'The supplied values were stored as given, unchecked.'
	);
}

// `indexes` is the one universe dimension the catalog can answer for: an
// index (e.g. "S&P 500") is modelled as a CatalogItem of kind 'universe'
// (src/lib/catalog/items.ts), the same kind describe_catalog_item and
// search_catalog already expose.
export function checkUniverseCatalogMembership(
	universe: UniverseSpec,
	catalog: CatalogRegistry
): UniverseCatalogCheck {
	const unknownIndexIds: string[] = [];
	const suggestionsByIndex: Record<string, string[]> = {};
	for (const indexId of universe.indexes) {
		const item = catalog.getCatalogItem(indexId);
		if (!item || item.kind !== 'universe') {
			unknownIndexIds.push(indexId);
			suggestionsByIndex[indexId] = catalog.suggestCatalogIds(indexId);
		}
	}
	return {
		unknownIndexIds,
		suggestionsByIndex,
		unverifiableWarning: buildUnverifiableWarning(universe)
	};
}

export interface UniverseSizeResolution {
	// False when nothing could answer "how many instruments match this
	// universe" -- no directory configured, or the configured one reported
	// its own unavailability. Not the same thing as a genuine zero.
	resolvable: boolean;
	count: number;
}

// AC7: an empty universe is still applied, with a warning that it is empty --
// but a universe whose size this program simply cannot compute yet must not
// be misreported as "empty" (that is a stronger, false claim).
export function describeUniverseSizeWarning(resolution: UniverseSizeResolution): string | null {
	if (!resolution.resolvable) {
		return (
			'Universe size could not be resolved: no instrument reference-data source could ' +
			'answer how many instruments match this universe. Treat the universe size as unknown, ' +
			'not zero.'
		);
	}
	if (resolution.count === 0) {
		return 'This universe currently resolves to zero instruments.';
	}
	return null;
}
