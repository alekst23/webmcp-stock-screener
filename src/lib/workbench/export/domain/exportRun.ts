// The read-only export payload for a pinned screener run (T-1014-10):
// the run's rows, the exact filter tree and ranking that produced them, the
// universe, the run id and timestamp, and the full market-data provenance
// envelope -- so the payload stays interpretable and reproducible once it
// has left the workspace that produced it (spec.md "Export results", AC1-3,
// AC8).
//
// Domain layer: no I/O, no dependency on PinnedRunStore or the tool
// registry. Builds on results/domain/{page,projection,tableConfig}.ts
// rather than reinventing column/computed-field projection or the bounded-
// read cursor grammar -- an export is a bounded, column-selected read of
// the same pinned run get_screener_results already reads, not a second,
// competing representation of it.

import type { ResourceId } from '../../domain/ids';
import { toWireProvenance, type MarketDataProvenance } from '../../domain/provenance';
import type { FilterNode, RankingSpec } from '../../../screener/definition';
import type { ScreenerRun } from '../../../screener/run';
import type { Revision } from '../../domain/workspace';
import type { ColumnValue, ProjectedRow } from '../../../results/domain/projection';
import type {
	ColumnIdentity,
	DisplayColumn,
	ResultsTableConfig
} from '../../../results/domain/tableConfig';

// ---------------------------------------------------------------------------
// Bounds (AC7): a deliberately larger vocabulary than results/domain/page.ts's
// UI-page bound -- an export is a bulk read a researcher asked for, not a
// paged table render, so its default and maximum are both larger than the
// UI page's 25/200.
// ---------------------------------------------------------------------------

export const EXPORT_DEFAULT_LIMIT = 500;
export const EXPORT_MAX_LIMIT = 5000;

export interface ExportLimitRejected {
	rejected: true;
	reason: 'limit_exceeded' | 'limit_invalid';
	requested: number;
	max: number;
	message: string;
}

// Mirrors results/domain/page.ts's resolvePageSize: an out-of-range or
// non-integer request is rejected, naming the maximum, never silently
// clamped.
export function resolveExportLimit(requested: number | undefined): number | ExportLimitRejected {
	if (requested === undefined) {
		return EXPORT_DEFAULT_LIMIT;
	}
	if (!Number.isInteger(requested) || requested < 1) {
		return {
			rejected: true,
			reason: 'limit_invalid',
			requested,
			max: EXPORT_MAX_LIMIT,
			message: `Requested export limit ${requested} is invalid: it must be a positive integer.`
		};
	}
	if (requested > EXPORT_MAX_LIMIT) {
		return {
			rejected: true,
			reason: 'limit_exceeded',
			requested,
			max: EXPORT_MAX_LIMIT,
			message:
				`Requested export limit ${requested} exceeds the maximum of ${EXPORT_MAX_LIMIT} rows ` +
				'per export call.'
		};
	}
	return requested;
}

export interface UnknownColumnsRejected {
	rejected: true;
	reason: 'unknown_columns';
	columnIds: ResourceId[];
	message: string;
}

// `undefined` (the caller named no subset) resolves to "every configured
// display column" -- `null` here is the sentinel this module's own
// buildScreenerRunExport reads as "no restriction" (AC6's default). A
// requested id that isn't in `config.columns` is rejected by name rather
// than silently dropped.
export function resolveExportColumnIds(
	requested: ResourceId[] | undefined,
	config: ResultsTableConfig
): ResourceId[] | null | UnknownColumnsRejected {
	if (requested === undefined) {
		return null;
	}
	const known = new Set(config.columns.map((column) => column.id));
	const unknown = requested.filter((id) => !known.has(id));
	if (unknown.length > 0) {
		return {
			rejected: true,
			reason: 'unknown_columns',
			columnIds: unknown,
			message:
				`Requested export column(s) not found in the supplied table configuration: ` +
				`${unknown.join(', ')}.`
		};
	}
	return requested;
}

// ---------------------------------------------------------------------------
// Payload shape
// ---------------------------------------------------------------------------

export interface ExportColumnDescriptor {
	id: ResourceId;
	label: string;
	unit?: string;
	valueType: DisplayColumn['valueType'];
	source: ColumnIdentity['source'];
}

export interface ExportRow {
	resultId: ResourceId;
	instrumentId: string;
	ticker: string | null;
	rank: number;
	compositeScore: number | null;
	// Keyed by ExportColumnDescriptor.id -- only the selected columns, never
	// the full projected set when a subset was requested (AC6).
	values: Record<ResourceId, ColumnValue>;
}

export interface ExportSelection {
	offset: number;
	limit: number;
	// Rows actually included in this export call.
	returnedCount: number;
	// The run's full row count (ScreenerRun.returnedCount) -- "how many rows
	// the run held" (AC7), independent of how many this call returned.
	totalAvailable: number;
	// True whenever this call did not return the run's entire row set --
	// AC7's "states plainly that it is a bounded subset".
	bounded: boolean;
	// Plain-language statement of how rows were ordered/selected (AC7).
	orderedBy: string;
	nextCursor: string | null;
}

// self-describing enough to be read without the app (AC8): every field a
// reader needs to interpret and reproduce the run is present on the payload
// itself, nothing requires a second lookup against the live app.
export interface ScreenerRunExport {
	exportId: ResourceId;
	runId: ResourceId;
	screenerId: ResourceId;
	screenerRevision: Revision;
	// ISO-8601 instant the run was minted (AC1's "run timestamp").
	runCreatedAt: string;
	// ISO-8601 instant this export payload was assembled -- distinct from
	// runCreatedAt, which never changes across repeated exports of the same
	// run.
	exportedAt: string;
	// The run's own pinned filter tree and ranking -- never the live
	// screener, which can have moved past this run's revision (AC1, AC3).
	filterTree: FilterNode;
	rankingSpec: RankingSpec | null;
	// Known gap (see the ticket doc's Solution Approach): ScreenerRun pins
	// only the resolved instrument count, not the UniverseSpec that produced
	// it. Stated honestly as a count rather than a fabricated or re-derived
	// spec.
	universe: { instrumentCount: number };
	provenance: MarketDataProvenance;
	columns: ExportColumnDescriptor[];
	rows: ExportRow[];
	selection: ExportSelection;
	formatVersion: string;
}

export const EXPORT_FORMAT_VERSION = '1';

function describeColumn(column: DisplayColumn): ExportColumnDescriptor {
	return {
		id: column.id,
		label: column.label,
		...(column.unit !== undefined ? { unit: column.unit } : {}),
		valueType: column.valueType,
		source: column.identity.source
	};
}

function toExportRow(row: ProjectedRow, columnIds: ResourceId[]): ExportRow {
	const values: Record<ResourceId, ColumnValue> = {};
	for (const id of columnIds) {
		if (id in row.columns) {
			values[id] = row.columns[id] as ColumnValue;
		}
	}
	return {
		resultId: row.resultId,
		instrumentId: row.instrumentId,
		ticker: row.ticker,
		rank: row.rank,
		compositeScore: row.compositeScore,
		values
	};
}

function describeIdentity(identity: ColumnIdentity): string {
	if (identity.source === 'catalog_field') {
		return `field "${identity.fieldId}"`;
	}
	if (identity.source === 'computed_column') {
		return `computed column "${identity.computedColumnId}"`;
	}
	return 'the result id';
}

function describeOrdering(config: ResultsTableConfig): string {
	if (!config.sort) {
		return "the run's pinned rank order (no sort configured)";
	}
	const direction = config.sort.direction === 'asc' ? 'ascending' : 'descending';
	return `${describeIdentity(config.sort.key)}, ${direction}`;
}

// The one exported entry point: assembles a full ScreenerRunExport from an
// already-projected, already-cut page of rows. Pure function of its inputs --
// no store lookup, no I/O -- so exportResults.ts (the application layer)
// stays the only place that touches PinnedRunStore.
export function buildScreenerRunExport(input: {
	exportId: ResourceId;
	run: ScreenerRun;
	rows: ProjectedRow[];
	columnIds: ResourceId[] | null;
	tableConfig: ResultsTableConfig;
	offset: number;
	limit: number;
	totalAvailable: number;
	nextCursor: string | null;
	exportedAt: string;
}): ScreenerRunExport {
	const {
		exportId,
		run,
		rows,
		columnIds,
		tableConfig,
		offset,
		limit,
		totalAvailable,
		nextCursor,
		exportedAt
	} = input;
	const selectedIds = columnIds ?? tableConfig.columns.map((column) => column.id);
	const columns = tableConfig.columns
		.filter((column) => selectedIds.includes(column.id))
		.map(describeColumn);
	const exportRows = rows.map((row) => toExportRow(row, selectedIds));
	return {
		exportId,
		runId: run.runId,
		screenerId: run.screenerId,
		screenerRevision: run.screenerRevision,
		runCreatedAt: run.createdAt,
		exportedAt,
		filterTree: run.filterTree,
		rankingSpec: run.rankingSpec,
		universe: { instrumentCount: run.universeCount },
		provenance: run.provenance,
		columns,
		rows: exportRows,
		selection: {
			offset,
			limit,
			returnedCount: rows.length,
			totalAvailable,
			bounded: rows.length < totalAvailable,
			orderedBy: describeOrdering(tableConfig),
			nextCursor
		},
		formatVersion: EXPORT_FORMAT_VERSION
	};
}

// ---------------------------------------------------------------------------
// Wire serialization
// ---------------------------------------------------------------------------

function toWireColumnDescriptor(column: ExportColumnDescriptor): Record<string, unknown> {
	return {
		id: column.id,
		label: column.label,
		...(column.unit !== undefined ? { unit: column.unit } : {}),
		value_type: column.valueType,
		source: column.source
	};
}

function toWireExportRow(row: ExportRow): Record<string, unknown> {
	return {
		result_id: row.resultId,
		instrument_id: row.instrumentId,
		ticker: row.ticker,
		rank: row.rank,
		composite_score: row.compositeScore,
		values: row.values
	};
}

// filter_tree/ranking_spec are carried through as their existing domain
// (camelCase) shapes rather than converted into a new wire grammar -- no
// serializer in this codebase converts the filter tree's 8-variant
// Condition union to snake_case anywhere else, and this is still fully
// self-describing JSON (AC8). See the ticket doc's Solution Approach.
export function toWireScreenerRunExport(payload: ScreenerRunExport): Record<string, unknown> {
	return {
		export_id: payload.exportId,
		run_id: payload.runId,
		screener_id: payload.screenerId,
		screener_revision: payload.screenerRevision,
		run_created_at: payload.runCreatedAt,
		exported_at: payload.exportedAt,
		filter_tree: payload.filterTree,
		ranking_spec: payload.rankingSpec,
		universe: { instrument_count: payload.universe.instrumentCount },
		provenance: toWireProvenance(payload.provenance),
		columns: payload.columns.map(toWireColumnDescriptor),
		rows: payload.rows.map(toWireExportRow),
		selection: {
			offset: payload.selection.offset,
			limit: payload.selection.limit,
			returned_count: payload.selection.returnedCount,
			total_available: payload.selection.totalAvailable,
			bounded: payload.selection.bounded,
			ordered_by: payload.selection.orderedBy,
			next_cursor: payload.selection.nextCursor
		},
		format_version: payload.formatVersion
	};
}
