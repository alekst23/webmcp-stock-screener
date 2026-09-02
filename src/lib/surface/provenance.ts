// Discovery's extension of the common provenance contract.
//
// The contract itself -- the liveness vocabulary, the provenance record, the
// engine version, the wire serializer -- lives in workbench/domain/provenance.
// It is re-exported here so discovery code has one import for the envelope and
// the record it carries, but it is not redefined: a second vocabulary is how
// two epics end up disagreeing about what `delayed` means.
//
// The only genuinely discovery-specific part is `warnings`: a search that
// clamped a limit or hit an unconfigured source still succeeded, and the agent
// needs to be told so without the result becoming an error.

export {
	ENGINE_VERSION,
	makeProvenance,
	type MarketDataProvenance,
	type PriceAdjustment,
	type ProvenanceInput,
	type ProvenanceLiveness,
	type ReportingBasis,
	type ReportingPeriod,
	type WithProvenance
} from '../workbench/domain/provenance';

import type { MarketDataProvenance, WithProvenance } from '../workbench/domain/provenance';

export interface DiscoveryEnvelope<T> extends WithProvenance<T> {
	// Non-fatal notes the agent should read: a clamped limit, an unconfigured
	// source. Never used to report failure -- that is an error result.
	warnings: string[];
}

export function envelope<T>(
	data: T,
	provenance: MarketDataProvenance,
	warnings: string[] = []
): DiscoveryEnvelope<T> {
	return { data, provenance, warnings };
}
