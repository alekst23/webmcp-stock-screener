// The one market-data provenance contract for the whole WebMCP surface. Any
// result carrying market data, reference data or fundamentals states as-of
// time, source, liveness, timezone, currency, price-adjustment basis and
// reporting period -- so an agent never quotes a delayed, unadjusted,
// foreign-currency price as though it were current. See the final paragraph of
// docs/reference/tool-spec.md's "Common contract for every tool".
//
// This lives in the workbench domain layer because it is the common contract
// every sibling surface epic builds on, not one epic's private vocabulary.
// Pure types and pure constructors, no I/O. Discovery's extension of it is
// src/lib/surface/provenance.ts.

// One declared value so every tool in the surface reports the same version
// rather than each hard-coding its own string.
export const ENGINE_VERSION = '0.1.0';

// `historical` and `static` are different claims and both are needed.
// `historical` is market data about a past instant: it ticked once, and a
// later request for a later window will return different data. `static` data
// does not tick at all -- the built-in catalog, a dated reference-data export.
// `end_of_day` sits between them: stale by design, but it will refresh.
export type ProvenanceLiveness = 'live' | 'delayed' | 'end_of_day' | 'historical' | 'static';

export type PriceAdjustment = 'adjusted' | 'unadjusted' | 'not_applicable';

// A basis rather than a bare fiscal-period enum ('FY' | 'Q1'..'Q4'): a
// trailing-twelve-month figure is neither a fiscal quarter nor a fiscal year,
// and an enum of fiscal periods cannot say so without lying. `basis` also
// makes `point_in_time` -- a balance-sheet snapshot -- expressible.
export type ReportingBasis =
	'point_in_time' | 'trailing_twelve_months' | 'fiscal_quarter' | 'fiscal_year';

export interface ReportingPeriod {
	basis: ReportingBasis;
	// ISO date the reported period ends on.
	periodEnd: string;
	fiscalYear: number;
	// Absent for annual, trailing-twelve-month and point-in-time bases.
	fiscalQuarter?: number;
	// Absent when the source does not say. A stated `false` is a claim that
	// the figures are as first reported.
	restated?: boolean;
}

interface ProvenanceCore {
	// ISO-8601 with offset: the instant the payload is true as of.
	asOf: string;
	// Stable machine identifier, e.g. 'src.catalog.builtin'.
	sourceId: string;
	// Human-readable name for the same source. Both are kept: an id alone
	// cannot be shown to a user, a label alone cannot be matched on.
	sourceLabel: string;
	// IANA zone the payload's dates and times are expressed in.
	timezone: string;
	// ISO 4217. Absent -- not defaulted -- when the payload has no monetary
	// content, because a guessed currency is worse than a stated absence.
	currency?: string;
	// Absent when the payload has no price content.
	priceAdjustment?: PriceAdjustment;
	// Absent when the payload has no fundamentals.
	reportingPeriod?: ReportingPeriod;
	engineVersion: string;
}

// A union rather than a nullable `delaySeconds`, so "delayed, but we won't say
// by how much" is not expressible: the magnitude is what makes a delay
// actionable. The same union stops a live or static record from carrying a
// delay figure at all.
export type MarketDataProvenance =
	| (ProvenanceCore & { liveness: 'delayed'; delaySeconds: number })
	| (ProvenanceCore & {
			liveness: Exclude<ProvenanceLiveness, 'delayed'>;
			delaySeconds?: never;
	  });

type ProvenanceInputCore = Omit<ProvenanceCore, 'engineVersion'>;

export type ProvenanceInput =
	| (ProvenanceInputCore & { liveness: 'delayed'; delaySeconds: number })
	| (ProvenanceInputCore & {
			liveness: Exclude<ProvenanceLiveness, 'delayed'>;
			delaySeconds?: never;
	  });

// Keys whose value is undefined are dropped rather than written, so an omitted
// currency stays genuinely absent from the record instead of becoming an
// explicit `undefined` that survives into a serialized result.
function withoutUndefined<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function makeProvenance(input: ProvenanceInput): MarketDataProvenance {
	const core: ProvenanceCore = withoutUndefined({
		asOf: input.asOf,
		sourceId: input.sourceId,
		sourceLabel: input.sourceLabel,
		timezone: input.timezone,
		currency: input.currency,
		priceAdjustment: input.priceAdjustment,
		reportingPeriod: input.reportingPeriod,
		engineVersion: ENGINE_VERSION
	});
	return input.liveness === 'delayed'
		? { ...core, liveness: 'delayed', delaySeconds: input.delaySeconds }
		: { ...core, liveness: input.liveness };
}

// T-0020-6: the one honest "no market-data source configured" default every
// /workbench tool group falls back to (registerWorkbenchTools.ts,
// registerScreenerTools.ts, workbenchCompositionRoot.ts) -- `static` rather
// than a zero-second delay, and no currency/price-adjustment claim, since no
// real market-data source is wired up anywhere in this codebase yet. Defined
// once here so the three sites import one instance instead of each carrying
// a byte-for-byte duplicate with nothing keeping them in sync.
export const NOT_CONFIGURED_PROVENANCE: MarketDataProvenance = makeProvenance({
	asOf: new Date(0).toISOString(),
	sourceId: 'not_configured',
	sourceLabel: 'No market-data source configured',
	liveness: 'static',
	timezone: 'America/New_York'
});

export interface WithProvenance<T> {
	data: T;
	provenance: MarketDataProvenance;
}

export function withProvenance<T>(data: T, provenance: MarketDataProvenance): WithProvenance<T> {
	return { data, provenance };
}

function toWireReportingPeriod(period: ReportingPeriod): Record<string, unknown> {
	return withoutUndefined({
		basis: period.basis,
		period_end: period.periodEnd,
		fiscal_year: period.fiscalYear,
		fiscal_quarter: period.fiscalQuarter,
		restated: period.restated
	});
}

// The single snake_case serializer for the wire. Absent optionals stay absent
// rather than serializing as null, matching the record they came from.
export function toWireProvenance(p: MarketDataProvenance): Record<string, unknown> {
	return withoutUndefined({
		as_of: p.asOf,
		source_id: p.sourceId,
		source_label: p.sourceLabel,
		liveness: p.liveness,
		delay_seconds: p.delaySeconds,
		timezone: p.timezone,
		currency: p.currency,
		price_adjustment: p.priceAdjustment,
		reporting_period: p.reportingPeriod ? toWireReportingPeriod(p.reportingPeriod) : undefined,
		engine_version: p.engineVersion
	});
}
