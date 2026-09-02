// Domain ports for the workbench surface: declared here, implemented in
// infra/ or application/, per the project's hexagonal architecture rule
// that domain never imports from infra. Extended by later tickets in this
// epic (T-1006-5 adds Clock).
import type { ResourceId } from './ids';
import type { MarketDataProvenance } from './provenance';
import type { Revision, WorkspaceDocument } from './workspace';

// The port through which the separate reference/fundamental-data workstream
// supplies current provenance. This epic defines it and ships no provider
// implementing it beyond what tests need (T-1006-3).
export interface ProvenanceSource {
	current(scope: 'prices' | 'fundamentals' | 'reference'): MarketDataProvenance;
}

export interface WorkspaceSummary {
	id: ResourceId;
	name: string;
	revision: Revision;
	updatedAt: string;
}

export interface SavedRevision {
	workspaceId: ResourceId;
	revision: Revision;
	// Set by save_workspace; null for an unnamed, ordinary revision snapshot.
	name: string | null;
	savedAt: string;
	document: WorkspaceDocument;
}

// A server-backed store must be able to satisfy this unchanged, so it never
// mentions localStorage or any other browser-specific concept (T-1006-4).
export interface WorkspaceRepository {
	list(): WorkspaceSummary[];
	get(id: ResourceId): WorkspaceDocument | null;
	put(doc: WorkspaceDocument): void;
	getActiveId(): ResourceId | null;
	setActiveId(id: ResourceId): void;
	listRevisions(id: ResourceId): SavedRevision[];
	getRevision(id: ResourceId, revision: Revision): WorkspaceDocument | null;
	putRevision(entry: SavedRevision): void;
}
