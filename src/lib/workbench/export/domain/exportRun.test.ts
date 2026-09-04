// Tests for T-1014-10's export payload domain model: shape, column
// selection, bounding, and wire serialization. Orchestration (reading a
// PinnedRunStore, cutting a slice, the "no silent rerun" guarantee) is
// covered by application/exportResults.test.ts -- these tests exercise
// buildScreenerRunExport and its helpers in isolation.
import { describe, expect, it } from 'vitest';
import { testProvenance, testRun } from '../../../results/testSupport';
import type { ProjectedRow } from '../../../results/domain/projection';
import type { ResultsTableConfig } from '../../../results/domain/tableConfig';
import {
	buildScreenerRunExport,
	EXPORT_MAX_LIMIT,
	resolveExportColumnIds,
	resolveExportLimit,
	toWireScreenerRunExport
} from './exportRun';

function config(overrides: Partial<ResultsTableConfig> = {}): ResultsTableConfig {
	return {
		columns: [],
		computedColumns: [],
		sort: null,
		grouping: null,
		formattingRules: [],
		pageSize: null,
		chartPanelId: null,
		...overrides
	};
}

function projectedRow(rank: number, columns: Record<string, number | null> = {}): ProjectedRow {
	return {
		resultId: `result_${rank}`,
		instrumentId: `inst_${rank}`,
		ticker: `TICK${rank}`,
		symbol: `SYM${rank}`,
		exchange: 'XNAS',
		assetType: 'equity',
		name: `Test Instrument ${rank}`,
		rank,
		compositeScore: 1 / rank,
		columns,
		groupValue: null
	};
}

const twoColumnConfig: ResultsTableConfig = config({
	columns: [
		{
			id: 'column_price',
			identity: { source: 'catalog_field', fieldId: 'field.price.close' },
			label: 'Close',
			valueType: 'number'
		},
		{
			id: 'column_ratio',
			identity: { source: 'computed_column', computedColumnId: 'computed_1' },
			label: 'Price/Volume',
			valueType: 'number'
		}
	]
});

describe('resolveExportLimit', () => {
	it('defaults to 500 when no limit is requested', () => {
		expect(resolveExportLimit(undefined)).toBe(500);
	});

	it('rejects a non-integer or non-positive limit, naming the maximum', () => {
		const outcome = resolveExportLimit(0);
		if (typeof outcome === 'number') throw new Error('expected a rejection');
		expect(outcome.reason).toBe('limit_invalid');
		expect(outcome.max).toBe(EXPORT_MAX_LIMIT);
	});

	it('rejects a limit above the maximum rather than clamping it', () => {
		const outcome = resolveExportLimit(EXPORT_MAX_LIMIT + 1);
		if (typeof outcome === 'number') throw new Error('expected a rejection');
		expect(outcome.reason).toBe('limit_exceeded');
		expect(outcome.requested).toBe(EXPORT_MAX_LIMIT + 1);
	});

	it('accepts a valid limit within range', () => {
		expect(resolveExportLimit(10)).toBe(10);
	});
});

describe('resolveExportColumnIds', () => {
	it('resolves to null (no restriction) when no subset is requested', () => {
		expect(resolveExportColumnIds(undefined, twoColumnConfig)).toBeNull();
	});

	it('passes through a valid subset of configured column ids', () => {
		const result = resolveExportColumnIds(['column_price'], twoColumnConfig);
		expect(result).toEqual(['column_price']);
	});

	it('rejects a column id absent from the table configuration, naming it', () => {
		const result = resolveExportColumnIds(['column_price', 'column_missing'], twoColumnConfig);
		if (result === null || !('rejected' in result)) throw new Error('expected a rejection');
		expect(result.reason).toBe('unknown_columns');
		expect(result.columnIds).toEqual(['column_missing']);
	});
});

describe('buildScreenerRunExport: payload shape (AC1, AC2, AC3, AC8)', () => {
	it('carries the run id, screener id/revision, timestamp, filter tree, ranking and provenance', () => {
		const run = testRun('run_1', 2, { screenerId: 'screener_9', screenerRevision: 4 });
		const payload = buildScreenerRunExport({
			exportId: 'export_1',
			run,
			rows: [projectedRow(1), projectedRow(2)],
			columnIds: null,
			tableConfig: config(),
			offset: 0,
			limit: 500,
			totalAvailable: 2,
			nextCursor: null,
			exportedAt: '2026-09-02T15:00:00.000Z'
		});
		expect(payload.exportId).toBe('export_1');
		expect(payload.runId).toBe('run_1');
		expect(payload.screenerId).toBe('screener_9');
		expect(payload.screenerRevision).toBe(4);
		expect(payload.runCreatedAt, "the run's own timestamp, not the export time").toBe(
			run.createdAt
		);
		expect(payload.exportedAt).toBe('2026-09-02T15:00:00.000Z');
		expect(payload.filterTree).toBe(run.filterTree);
		expect(payload.rankingSpec).toBe(run.rankingSpec);
		expect(payload.provenance).toEqual(testProvenance());
	});

	it('states the universe honestly as a resolved instrument count', () => {
		const run = testRun('run_1', 1, { universeCount: 4200 });
		const payload = buildScreenerRunExport({
			exportId: 'export_1',
			run,
			rows: [projectedRow(1)],
			columnIds: null,
			tableConfig: config(),
			offset: 0,
			limit: 500,
			totalAvailable: 1,
			nextCursor: null,
			exportedAt: '2026-09-02T15:00:00.000Z'
		});
		expect(payload.universe).toEqual({ instrumentCount: 4200 });
	});
});

describe('buildScreenerRunExport: column selection (AC6)', () => {
	it('includes every configured column when no subset is requested', () => {
		const run = testRun('run_1', 1);
		const row = projectedRow(1, { column_price: 101.5, column_ratio: 0.4 });
		const payload = buildScreenerRunExport({
			exportId: 'export_1',
			run,
			rows: [row],
			columnIds: null,
			tableConfig: twoColumnConfig,
			offset: 0,
			limit: 500,
			totalAvailable: 1,
			nextCursor: null,
			exportedAt: '2026-09-02T15:00:00.000Z'
		});
		expect(payload.columns.map((c) => c.id).sort()).toEqual(['column_price', 'column_ratio']);
		expect(payload.rows[0]?.values).toEqual({ column_price: 101.5, column_ratio: 0.4 });
	});

	it('includes only the requested column subset, including a computed column, in rows and descriptors', () => {
		const run = testRun('run_1', 1);
		const row = projectedRow(1, { column_price: 101.5, column_ratio: 0.4 });
		const payload = buildScreenerRunExport({
			exportId: 'export_1',
			run,
			rows: [row],
			columnIds: ['column_ratio'],
			tableConfig: twoColumnConfig,
			offset: 0,
			limit: 500,
			totalAvailable: 1,
			nextCursor: null,
			exportedAt: '2026-09-02T15:00:00.000Z'
		});
		expect(payload.columns.map((c) => c.id)).toEqual(['column_ratio']);
		expect(payload.columns[0]?.source, 'the computed column source must be reported').toBe(
			'computed_column'
		);
		expect(payload.rows[0]?.values).toEqual({ column_ratio: 0.4 });
		expect(
			'column_price' in (payload.rows[0]?.values ?? {}),
			'an unselected column must not leak into the row values'
		).toBe(false);
	});
});

describe('buildScreenerRunExport: bounded subset (AC7)', () => {
	it('reports bounded=true and the run-held total when fewer rows are returned than exist', () => {
		const run = testRun('run_1', 500);
		const payload = buildScreenerRunExport({
			exportId: 'export_1',
			run,
			rows: [projectedRow(1), projectedRow(2)],
			columnIds: null,
			tableConfig: config(),
			offset: 0,
			limit: 2,
			totalAvailable: 500,
			nextCursor: 'rc1~run_1~2',
			exportedAt: '2026-09-02T15:00:00.000Z'
		});
		expect(payload.selection.bounded).toBe(true);
		expect(payload.selection.returnedCount).toBe(2);
		expect(payload.selection.totalAvailable, "the run's full row count").toBe(500);
		expect(payload.selection.nextCursor).toBe('rc1~run_1~2');
	});

	it('reports bounded=false when the whole run fits in one export call', () => {
		const run = testRun('run_1', 2);
		const payload = buildScreenerRunExport({
			exportId: 'export_1',
			run,
			rows: [projectedRow(1), projectedRow(2)],
			columnIds: null,
			tableConfig: config(),
			offset: 0,
			limit: 500,
			totalAvailable: 2,
			nextCursor: null,
			exportedAt: '2026-09-02T15:00:00.000Z'
		});
		expect(payload.selection.bounded).toBe(false);
	});

	it('states the ordering plainly, naming the sort key when one is configured', () => {
		const run = testRun('run_1', 1);
		const payload = buildScreenerRunExport({
			exportId: 'export_1',
			run,
			rows: [projectedRow(1)],
			columnIds: null,
			tableConfig: config({
				sort: { key: { source: 'catalog_field', fieldId: 'field.price.close' }, direction: 'asc' }
			}),
			offset: 0,
			limit: 500,
			totalAvailable: 1,
			nextCursor: null,
			exportedAt: '2026-09-02T15:00:00.000Z'
		});
		expect(payload.selection.orderedBy).toContain('field.price.close');
		expect(payload.selection.orderedBy).toContain('ascending');
	});

	it('describes the default order as the run’s pinned rank order when no sort is configured', () => {
		const run = testRun('run_1', 1);
		const payload = buildScreenerRunExport({
			exportId: 'export_1',
			run,
			rows: [projectedRow(1)],
			columnIds: null,
			tableConfig: config(),
			offset: 0,
			limit: 500,
			totalAvailable: 1,
			nextCursor: null,
			exportedAt: '2026-09-02T15:00:00.000Z'
		});
		expect(payload.selection.orderedBy).toContain('rank');
	});
});

describe('toWireScreenerRunExport (AC8: self-describing wire shape)', () => {
	it('serializes every top-level field in snake_case, with provenance delegated to toWireProvenance', () => {
		const run = testRun('run_1', 1);
		const payload = buildScreenerRunExport({
			exportId: 'export_7',
			run,
			rows: [projectedRow(1, { column_price: 10 })],
			columnIds: null,
			tableConfig: {
				...twoColumnConfig,
				columns: [twoColumnConfig.columns[0] as (typeof twoColumnConfig.columns)[number]]
			},
			offset: 0,
			limit: 500,
			totalAvailable: 1,
			nextCursor: null,
			exportedAt: '2026-09-02T15:00:00.000Z'
		});
		const wire = toWireScreenerRunExport(payload);
		expect(wire.export_id).toBe('export_7');
		expect(wire.run_id).toBe('run_1');
		expect(wire.screener_id).toBe(run.screenerId);
		expect(wire.screener_revision).toBe(run.screenerRevision);
		expect(wire.run_created_at).toBe(run.createdAt);
		expect(wire.filter_tree).toBe(run.filterTree);
		expect(wire.ranking_spec).toBe(run.rankingSpec);
		expect(wire.universe).toEqual({ instrument_count: run.universeCount });
		expect(wire.provenance).toHaveProperty('as_of');
		expect(wire.provenance).toHaveProperty('engine_version');
		expect(Array.isArray(wire.rows)).toBe(true);
		expect(wire.format_version).toBe('1');
		const selection = wire.selection as Record<string, unknown>;
		expect(selection.returned_count).toBe(1);
		expect(selection.total_available).toBe(1);
	});
});
