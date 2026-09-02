// The provenance envelope every tool in the new WebMCP surface returns its
// payload inside. tool-spec.md's "Common contract for every tool" requires
// market-data results to state as_of, source, live/delayed status, timezone,
// currency, price adjustment, fundamentals reporting period, and the
// calculation-engine version. Encoding that once, as a type, is what keeps it
// from being re-remembered (and half-forgotten) in every tool.
//
// Domain layer: pure types and pure constructors, no I/O. Named for the whole
// surface rather than for discovery because sibling epics need the same
// envelope.

// One declared value so every tool in the surface reports the same version
// rather than each hard-coding its own string.
export const ENGINE_VERSION = '0.1.0';

// `static` covers data that does not tick at all -- the built-in catalog, a
// dated reference-data export. Distinguishing it from `end_of_day` matters:
// end-of-day data is stale by design and will refresh, static data will not.
export type DeliveryStatus = 'live' | 'delayed' | 'end_of_day' | 'static';

export type PriceAdjustment = 'adjusted' | 'unadjusted' | 'not_applicable';

export type ReportingBasis =
	'point_in_time' | 'trailing_twelve_months' | 'fiscal_quarter' | 'fiscal_year';

export interface ReportingPeriod {
	basis: ReportingBasis;
	// ISO date the reported period ends on.
	periodEnd: string;
	fiscalYear: number;
	// Absent for annual and trailing-twelve-month bases.
	fiscalQuarter?: number;
}

interface ProvenanceCore {
	// ISO-8601 with offset: when the payload is true as of.
	asOf: string;
	// Stable source identifier, e.g. 'src.catalog.builtin'.
	sourceId: string;
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

// A union rather than an optional `delaySeconds`, so "delayed, but we won't say
// by how much" is not expressible: the magnitude is what makes a delay
// actionable.
export type Provenance =
	| (ProvenanceCore & { delivery: 'delayed'; delaySeconds: number })
	| (ProvenanceCore & { delivery: Exclude<DeliveryStatus, 'delayed'>; delaySeconds?: never });

type ProvenanceInputCore = Omit<ProvenanceCore, 'engineVersion'>;

export type ProvenanceInput =
	| (ProvenanceInputCore & { delivery: 'delayed'; delaySeconds: number })
	| (ProvenanceInputCore & { delivery: Exclude<DeliveryStatus, 'delayed'>; delaySeconds?: never });

// Keys whose value is undefined are dropped rather than written, so an omitted
// currency stays genuinely absent from the record instead of becoming an
// explicit `undefined` that survives into a serialized result.
function withoutUndefined<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function makeProvenance(input: ProvenanceInput): Provenance {
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
	return input.delivery === 'delayed'
		? { ...core, delivery: 'delayed', delaySeconds: input.delaySeconds }
		: { ...core, delivery: input.delivery };
}

export interface DiscoveryEnvelope<T> {
	data: T;
	provenance: Provenance;
	// Non-fatal notes the agent should read: a clamped limit, an unconfigured
	// source. Never used to report failure -- that is an error result.
	warnings: string[];
}

export function envelope<T>(
	data: T,
	provenance: Provenance,
	warnings: string[] = []
): DiscoveryEnvelope<T> {
	return { data, provenance, warnings };
}
