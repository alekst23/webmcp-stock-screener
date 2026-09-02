// Domain ports for the workbench surface: declared here, implemented in
// infra/ or application/, per the project's hexagonal architecture rule
// that domain never imports from infra. Extended by later tickets in this
// epic (T-1006-4 adds WorkspaceRepository, T-1006-5 adds Clock).
import type { MarketDataProvenance } from './provenance';

// The port through which the separate reference/fundamental-data workstream
// supplies current provenance. This epic defines it and ships no provider
// implementing it beyond what tests need (T-1006-3).
export interface ProvenanceSource {
	current(scope: 'prices' | 'fundamentals' | 'reference'): MarketDataProvenance;
}
