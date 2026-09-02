// Orchestrates a bounded, projected read of a pinned screener run
// (T-1010-4, `get_screener_results`): resolve the page size, load the run,
// decode the cursor, project the run's full match set through the
// configured results table (or the documented default when none is
// supplied), cut the requested page, and return it with provenance. All
// projection/sort/grouping arithmetic lives in domain/projection.ts -- this
// module only sequences the read and the cut.
//
// Reads PinnedRunStore directly rather than wrapping ResultsReader
// (ports.ts): a column projection needs ScreenerMatch.rankingValues, which
// ResultsReader's ResultRow deliberately does not carry (domain/page.ts).
// PinnedRunStore has no execute/refresh member (screener/ports.ts) --
// nothing reachable from this file can produce a fresher run than the one
// already pinned under runId (AC5, AC6).

import type { ResourceId } from '../../workbench/domain/ids';
import type { PinnedRunStore, RunNotAvailable } from '../../screener/ports';
import {
	decodeCursor,
	encodeCursor,
	resolvePageSize,
	type CursorRejected,
	type PageSizeRejected,
	type TickerResolver
} from '../domain/page';
import {
	defaultResultsTableConfig,
	projectResultRows,
	type ProjectedResultsPage
} from '../domain/projection';
import type { ResultsTableConfig } from '../domain/tableConfig';

export interface GetScreenerResultsRequest {
	runId: ResourceId;
	// Opaque, from a previous page's nextCursor. Omit for the first page.
	cursor?: string;
	// Defaults to domain/page.ts's DEFAULT_PAGE_SIZE when omitted (AC8).
	pageSize?: number;
	// The results_table panel's configuration. Omit to fall back to
	// defaultResultsTableConfig() -- the documented default column set.
	tableConfig?: ResultsTableConfig;
}

export type GetScreenerResultsOutcome =
	ProjectedResultsPage | RunNotAvailable | PageSizeRejected | CursorRejected;

export interface GetScreenerResultsOptions {
	resolveTicker?: TickerResolver;
}

function isRunNotAvailable<T>(value: T | RunNotAvailable): value is RunNotAvailable {
	return typeof value === 'object' && value !== null && 'available' in value;
}

export function getScreenerResults(
	store: PinnedRunStore,
	request: GetScreenerResultsRequest,
	options: GetScreenerResultsOptions = {}
): GetScreenerResultsOutcome {
	const pageSize = resolvePageSize(request.pageSize);
	if (typeof pageSize !== 'number') {
		return pageSize;
	}

	const run = store.getRun(request.runId);
	if (isRunNotAvailable(run)) {
		return run;
	}

	let offset = 0;
	if (request.cursor !== undefined) {
		const decoded = decodeCursor(request.cursor, request.runId);
		if ('rejected' in decoded) {
			return decoded;
		}
		offset = decoded.offset;
	}

	const config = request.tableConfig ?? defaultResultsTableConfig();
	const resolveTicker = options.resolveTicker ?? (() => null);
	const projected = projectResultRows(run, config, resolveTicker);
	const rows = projected.slice(offset, offset + pageSize);
	const nextOffset = offset + rows.length;

	return {
		runId: run.runId,
		rows,
		total: projected.length,
		offset,
		pageSize,
		nextCursor:
			nextOffset < projected.length ? encodeCursor({ runId: run.runId, offset: nextOffset }) : null,
		provenance: run.provenance,
		grouped: config.grouping !== null
	};
}
