// Stable IDs for the new WebMCP surface. tool-spec.md's common contract is
// explicit: "Every resource should use stable IDs -- never 'panel 3' or ticker
// alone." A bare ticker is not an identifier (it is reassigned, and it means
// different instruments on different venues), so the surface passes namespaced
// opaque strings and offers a checker that catches a ticker handed in where an
// ID belongs.
//
// Domain layer: pure string construction and validation, no I/O.

// Instrument IDs are `inst:<MIC>:<SYMBOL>`, e.g. `inst:XNAS:AAPL`. This is the
// application's *default* construction only -- a reference-data source that
// mints its own stable identifiers may supply those instead, which is why
// callers must treat the value as opaque and never parse it to recover a
// ticker (see spec.md Open Question 2).
const INSTRUMENT_ID = /^inst:[A-Z0-9]{4}:[A-Za-z0-9][A-Za-z0-9.\-_]*$/;

// The ID prefix each catalog kind uses. Deliberately declared here rather than
// in the catalog module: `src/lib/surface/` must not depend on the catalog, and
// sibling epics validate catalog IDs without importing the registry.
export const CATALOG_ID_PREFIXES = [
	'field',
	'op',
	'study',
	'indicator',
	'pattern',
	'interval',
	'universe',
	'template'
] as const;

export type CatalogIdPrefix = (typeof CATALOG_ID_PREFIXES)[number];

// `<prefix>.<segment>[.<segment>...]`, e.g. `field.price.close`, `study.rsi`,
// `op.crosses_above`, `interval.1d`.
const CATALOG_ITEM_ID = new RegExp(`^(?:${CATALOG_ID_PREFIXES.join('|')})(?:\\.[a-z0-9_]+)+$`);

export function makeInstrumentId(exchangeMic: string, symbol: string): string {
	const id = `inst:${exchangeMic.toUpperCase()}:${symbol.toUpperCase()}`;
	if (!INSTRUMENT_ID.test(id)) {
		throw new Error(
			`Cannot build an instrument ID from MIC "${exchangeMic}" and symbol "${symbol}": ` +
				'a MIC is four alphanumerics (ISO 10383) and a symbol must be alphanumeric.'
		);
	}
	return id;
}

export function isInstrumentId(value: unknown): value is string {
	return typeof value === 'string' && INSTRUMENT_ID.test(value);
}

export function makeCatalogItemId(prefix: CatalogIdPrefix, path: string): string {
	const id = `${prefix}.${path}`;
	if (!CATALOG_ITEM_ID.test(id)) {
		throw new Error(
			`Cannot build a catalog item ID from prefix "${prefix}" and path "${path}": ` +
				'a path is one or more dot-separated lowercase alphanumeric/underscore segments.'
		);
	}
	return id;
}

export function isCatalogItemId(value: unknown): value is string {
	return typeof value === 'string' && CATALOG_ITEM_ID.test(value);
}
