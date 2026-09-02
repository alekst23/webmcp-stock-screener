// Orchestrates a bounded, provenance-carrying export of a pinned screener
// run (T-1014-10, `export_results`): resolve the limit, load the run,
// decode the cursor, project the run's full match set through the
// configured (or default) results table, cut the requested slice, and
// assemble the self-describing export payload. All column/computed-field
// arithmetic lives in results/domain/projection.ts and all payload assembly
// lives in ../domain/exportRun.ts -- this module only sequences the read.
//
// Reads PinnedRunStore directly, the same port get_screener_results reads
// (results/application/getScreenerResults.ts) -- it has no execute/refresh
// member (screener/ports.ts), so nothing reachable from this file can
// produce a fresher run than the one already pinned under runId (AC4, AC5).

import { createIdSequencer, type ResourceId } from '../../domain/ids';
import type { PinnedRunStore, RunNotAvailable } from '../../../screener/ports';
import {
	decodeCursor,
	encodeCursor,
	type CursorRejected,
	type TickerResolver
} from '../../../results/domain/page';
import { defaultResultsTableConfig, projectResultRows } from '../../../results/domain/projection';
import type { ResultsTableConfig } from '../../../results/domain/tableConfig';
import {
	buildScreenerRunExport,
	resolveExportColumnIds,
	resolveExportLimit,
	type ExportLimitRejected,
	type ScreenerRunExport,
	type UnknownColumnsRejected
} from '../domain/exportRun';
import { createExportIdGenerator, type ExportIdGenerator } from '../domain/exportId';

export interface ExportResultsRequest {
	runId: ResourceId;
	// The results_table panel's configuration. Omit to fall back to
	// defaultResultsTableConfig() -- the documented default column set,
	// matching get_screener_results' own convention.
	tableConfig?: ResultsTableConfig;
	// Subset of tableConfig.columns[].id to include in each row's `values`.
	// Omit to include every configured display column (AC6).
	columnIds?: ResourceId[];
	// Rows per export call, up to EXPORT_MAX_LIMIT; defaults to
	// EXPORT_DEFAULT_LIMIT when omitted (AC7).
	limit?: number;
	// Opaque, from a previous export's selection.nextCursor. Omit for the
	// first slice.
	cursor?: string;
}

export type ExportResultsOutcome =
	| ScreenerRunExport
	| RunNotAvailable
	| ExportLimitRejected
	| CursorRejected
	| UnknownColumnsRejected;

export interface ExportResultsOptions {
	resolveTicker?: TickerResolver;
	now?: () => Date;
	nextExportId?: ExportIdGenerator;
}

function isRunNotAvailable<T>(value: T | RunNotAvailable): value is RunNotAvailable {
	return typeof value === 'object' && value !== null && 'available' in value;
}

// A module-scoped sequencer, not the workspace's shared one -- export_results
// is read-only with respect to workspace state (AC10) and has no persisted
// high-water mark to resume from, so each process gets its own 'export'
// sequence. What matters for the cross-epic concern this replaced a
// workaround for is that ids are minted via the canonical IdSequencer/
// mintId mechanism and kind registry, not a private string format.
const defaultExportIdGenerator = createExportIdGenerator(createIdSequencer());

export function exportResults(
	store: PinnedRunStore,
	request: ExportResultsRequest,
	options: ExportResultsOptions = {}
): ExportResultsOutcome {
	const limit = resolveExportLimit(request.limit);
	if (typeof limit !== 'number') {
		return limit;
	}

	// AC5: an unknown or evicted run is reported here and nothing below ever
	// runs -- there is no fallback path that could paper over it with a
	// fresh screener execution.
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

	const tableConfig = request.tableConfig ?? defaultResultsTableConfig();
	const columnIds = resolveExportColumnIds(request.columnIds, tableConfig);
	if (columnIds !== null && 'rejected' in columnIds) {
		return columnIds;
	}

	const resolveTicker = options.resolveTicker ?? (() => null);
	const projected = projectResultRows(run, tableConfig, resolveTicker);
	const rows = projected.slice(offset, offset + limit);
	const nextOffset = offset + rows.length;
	const nextCursor =
		nextOffset < projected.length ? encodeCursor({ runId: run.runId, offset: nextOffset }) : null;

	const nextExportId = options.nextExportId ?? defaultExportIdGenerator;
	const now = options.now ?? (() => new Date());

	return buildScreenerRunExport({
		exportId: nextExportId(),
		run,
		rows,
		columnIds,
		tableConfig,
		offset,
		limit,
		totalAvailable: projected.length,
		nextCursor,
		exportedAt: now().toISOString()
	});
}
