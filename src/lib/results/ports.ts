// The results-page read contract (T-1010-2): what a caller may do with a
// pinned run's results -- obtain the run's metadata, or obtain one bounded
// page of its rows. Exactly two operations, deliberately: there is no
// execute/refresh member anywhere in this file, and that structural
// absence -- not a runtime check -- is EPIC-1010's "no silent rerun"
// guarantee at the results-page layer (AC5, AC6), the same pattern
// src/lib/screener/ports.ts's PinnedRunStore already uses one layer down.
//
// Domain-adjacent contract: types only, no I/O. resultsReader.ts is the
// only implementation, composed over PinnedRunStore rather than declaring
// a second, parallel run-read contract.

import type { ResourceId } from '../workbench/domain/ids';
import type { MarketDataProvenance } from '../workbench/domain/provenance';
import type { RunNotAvailable } from '../screener/ports';
import type { ScreenerWarning } from '../screener/run';
import type { CursorRejected, PageSizeRejected, ResultsPage } from './domain/page';

// A read-only projection of ScreenerRun for callers that want the run's
// shape -- counts, warnings, provenance -- without paging through its
// rows. Deliberately excludes `matches`: that is what getResultsPage is
// for, so a metadata read can never turn into an accidental full-run read.
export interface RunMetadata {
	runId: ResourceId;
	screenerId: ResourceId;
	screenerRevision: number;
	universeCount: number;
	matchedCount: number;
	returnedCount: number;
	truncated: boolean;
	rankingApplied: boolean;
	normalization: string | null;
	warnings: ScreenerWarning[];
	provenance: MarketDataProvenance;
	createdAt: string;
}

export interface PageRequest {
	// Opaque, from a previous page's nextCursor. Omit for the first page.
	cursor?: string;
	// Defaults to DEFAULT_PAGE_SIZE (page.ts) when omitted.
	pageSize?: number;
}

export type ResultsPageOutcome = ResultsPage | RunNotAvailable | PageSizeRejected | CursorRejected;

export interface ResultsReader {
	getRunMetadata(runId: ResourceId): RunMetadata | RunNotAvailable;
	getResultsPage(runId: ResourceId, request?: PageRequest): ResultsPageOutcome;
}
