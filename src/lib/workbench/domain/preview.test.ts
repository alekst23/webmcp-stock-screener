import { describe, expect, it } from 'vitest';
import {
	buildPreviewResult,
	collectAffectedIds,
	isApplicable,
	toWirePreviewResult
} from './preview';
import type {
	ChangeBatch,
	DiffEntry,
	OperationFailure,
	OperationOutcome,
	OperationWarning,
	PreviewResult,
	ProposedOperation,
	WorkspaceDiff
} from './preview';

function op(kind: string, input: unknown = {}): ProposedOperation {
	return { kind, input };
}

describe('ChangeBatch', () => {
	it('preserves the order operations were proposed in', () => {
		const batch: ChangeBatch = [
			op('add_panel', { kind: 'chart' }),
			op('configure_panel', { panelId: 'panel_chart_1' })
		];
		expect(
			batch.map((entry) => entry.kind),
			'a batch is an ordered sequence: a later operation depends on an earlier one'
		).toEqual(['add_panel', 'configure_panel']);
	});

	it('treats two batches with the same operations in different orders as different', () => {
		const forward: ChangeBatch = [op('add_panel'), op('configure_panel')];
		const reversed: ChangeBatch = [op('configure_panel'), op('add_panel')];
		expect(forward, 'ordering is significant, so a reordered batch is not equal').not.toEqual(
			reversed
		);
	});

	it('accepts an empty batch as a representable value, leaving rejection to a caller', () => {
		const batch: ChangeBatch = [];
		expect(batch.length, 'the type permits an empty batch; validation rejects it').toBe(0);
	});
});

describe('ProposedOperation.kind', () => {
	it('accepts a registry key this module never mentions', () => {
		// A kind registered by a later epic must need no change to these types.
		const novel = op('summon_a_kind_invented_after_this_file', { anything: [1, 2, 3] });
		expect(novel.kind, 'kind is an open registry key, not a closed enum').toBe(
			'summon_a_kind_invented_after_this_file'
		);
		expect(novel.input, 'input is opaque here; only the kind validator knows its shape').toEqual({
			anything: [1, 2, 3]
		});
	});
});

describe('OperationFailure', () => {
	it('identifies the offending operation by position and kind with a human reason', () => {
		const failure: OperationFailure = {
			index: 2,
			kind: 'set_filter',
			reason: 'threshold must be a number'
		};
		expect(failure.index, 'position in the batch names the offending operation').toBe(2);
		expect(failure.kind, 'the kind is reported alongside the position').toBe('set_filter');
		expect(failure.reason, 'the reason is human-readable, not a code').toBe(
			'threshold must be a number'
		);
	});

	it('lets a batch carry more than one failure, at distinct positions', () => {
		const failures: OperationFailure[] = [
			{ index: 0, kind: 'unknown_kind', reason: 'operation kind is not registered' },
			{ index: 2, kind: 'set_filter', reason: 'threshold must be a number' }
		];
		expect(failures.length, 'every determinable failure is reported, not only the first').toBe(2);
		expect(
			failures.map((f) => f.index),
			'each failure points at its own operation'
		).toEqual([0, 2]);
	});
});

describe('warnings versus failures', () => {
	it('treats a warning as a distinct type from a failure', () => {
		const warning: OperationWarning = {
			index: 1,
			kind: 'add_panel',
			message: 'workspace already has six panels'
		};
		expect('message' in warning, 'a warning carries a message').toBe(true);
		expect('reason' in warning, 'a warning is not a failure wearing a different name').toBe(false);
	});

	it('stays applicable when only warnings are present', () => {
		expect(isApplicable([]), 'no failures means the preview is applicable').toBe(true);
	});

	it('is not applicable when any failure is present', () => {
		const failures: OperationFailure[] = [{ index: 0, kind: 'x', reason: 'bad' }];
		expect(isApplicable(failures), 'a single failure blocks apply').toBe(false);
	});
});

describe('DiffEntry', () => {
	it('represents an addition with no field changes', () => {
		const entry: DiffEntry = {
			change: 'added',
			entityType: 'panel',
			id: 'panel_chart_1',
			fields: []
		};
		expect(entry.change, 'an added entity is typed as added').toBe('added');
		expect(entry.fields, 'an addition carries no before/after field list').toEqual([]);
	});

	it('represents a removal with no field changes', () => {
		const entry: DiffEntry = {
			change: 'removed',
			entityType: 'link',
			id: 'link_1',
			fields: []
		};
		expect(entry.change, 'a removed entity is typed as removed').toBe('removed');
		expect(entry.fields, 'a removal carries no before/after field list').toEqual([]);
	});

	it('lists only the changed fields for an update, with before and after values', () => {
		const entry: DiffEntry = {
			change: 'updated',
			entityType: 'panel',
			id: 'panel_chart_1',
			fields: [{ field: 'title', before: 'Chart', after: 'AAPL Chart' }]
		};
		expect(
			entry.fields.map((f) => f.field),
			'unchanged fields are omitted from an update entry'
		).toEqual(['title']);
		expect(entry.fields[0]?.before, 'an update names the value before').toBe('Chart');
		expect(entry.fields[0]?.after, 'an update names the value after').toBe('AAPL Chart');
	});

	it('accepts an entity type this module never enumerates', () => {
		const entry: DiffEntry = {
			change: 'added',
			entityType: 'sentiment_overlay',
			id: 'annotation_7',
			fields: []
		};
		expect(entry.entityType, 'entityType is a free string, not a closed union').toBe(
			'sentiment_overlay'
		);
	});
});

describe('collectAffectedIds', () => {
	it('deduplicates ids while preserving first-appearance order', () => {
		const diff: WorkspaceDiff = [
			{ change: 'added', entityType: 'panel', id: 'panel_chart_1', fields: [] },
			{ change: 'added', entityType: 'link', id: 'link_1', fields: [] },
			{
				change: 'updated',
				entityType: 'panel',
				id: 'panel_chart_1',
				fields: [{ field: 'title', before: 'a', after: 'b' }]
			}
		];
		expect(collectAffectedIds(diff), 'first-appearance order, no repeats').toEqual([
			'panel_chart_1',
			'link_1'
		]);
	});

	it('returns an empty list for an empty diff', () => {
		expect(collectAffectedIds([]), 'a no-op batch affects nothing').toEqual([]);
	});
});

describe('buildPreviewResult', () => {
	const diff: WorkspaceDiff = [
		{ change: 'added', entityType: 'panel', id: 'panel_chart_1', fields: [] },
		{
			change: 'updated',
			entityType: 'workspace',
			id: 'workspace_1',
			fields: [{ field: 'activePanelId', before: null, after: 'panel_chart_1' }]
		}
	];

	it('carries every field a preview result must report', () => {
		const outcomes: OperationOutcome[] = [
			{ index: 0, kind: 'add_panel', describe: 'Add a chart panel', failures: [], warnings: [] }
		];
		const result = buildPreviewResult({
			previewId: 'preview_1',
			baseRevision: 4,
			diff,
			summary: 'Added a chart panel and focused it.',
			outcomes
		});
		expect(result.previewId, 'a stable preview id').toBe('preview_1');
		expect(result.baseRevision, 'the revision the preview was computed against').toBe(4);
		expect(result.diff, 'the structured diff').toEqual(diff);
		expect(result.affectedIds, 'the affected stable ids').toEqual(['panel_chart_1', 'workspace_1']);
		expect(result.summary, 'a human-readable summary').toBe('Added a chart panel and focused it.');
		expect(result.warnings, 'warnings default to empty rather than undefined').toEqual([]);
		expect(result.failures, 'failures default to empty rather than undefined').toEqual([]);
		expect(result.outcomes, 'per-operation outcomes').toEqual(outcomes);
		expect(result.applicable, 'a failure-free preview is applicable').toBe(true);
	});

	it('derives affectedIds from the diff rather than trusting a caller', () => {
		const result = buildPreviewResult({
			previewId: 'preview_1',
			baseRevision: 1,
			diff,
			summary: 'x'
		});
		expect(
			result.affectedIds,
			'affectedIds cannot disagree with the diff because it is derived from it'
		).toEqual(collectAffectedIds(diff));
	});

	it('stays applicable when the batch produced warnings but no failures', () => {
		const result = buildPreviewResult({
			previewId: 'preview_1',
			baseRevision: 1,
			diff,
			summary: 'x',
			warnings: [{ index: 0, kind: 'add_panel', message: 'panel count is high' }]
		});
		expect(result.applicable, 'advisory warnings never block apply').toBe(true);
		expect(result.warnings.length, 'the warnings are still reported').toBe(1);
	});

	it('is not applicable when the batch produced any failure', () => {
		const result = buildPreviewResult({
			previewId: 'preview_1',
			baseRevision: 1,
			diff: [],
			summary: 'x',
			failures: [{ index: 2, kind: 'set_filter', reason: 'threshold must be a number' }],
			warnings: [{ index: 0, kind: 'add_panel', message: 'panel count is high' }]
		});
		expect(result.applicable, 'a failure blocks apply even alongside warnings').toBe(false);
	});

	it('reports an empty diff for a no-op batch rather than failing', () => {
		const result = buildPreviewResult({
			previewId: 'preview_1',
			baseRevision: 9,
			diff: [],
			summary: 'No changes.'
		});
		expect(result.diff, 'a no-op batch previews as an empty diff').toEqual([]);
		expect(result.applicable, 'an empty diff is still applicable').toBe(true);
	});
});

describe('toWirePreviewResult', () => {
	it('serializes to the exact snake_case field names the tool layer returns', () => {
		const result: PreviewResult = buildPreviewResult({
			previewId: 'preview_1',
			baseRevision: 4,
			diff: [
				{
					change: 'updated',
					entityType: 'panel',
					id: 'panel_chart_1',
					fields: [{ field: 'title', before: 'Chart', after: 'AAPL Chart' }]
				}
			],
			summary: 'Renamed the chart panel.',
			warnings: [{ index: 0, kind: 'rename_panel', message: 'title is very long' }],
			outcomes: [
				{
					index: 0,
					kind: 'rename_panel',
					describe: 'Rename the chart panel',
					failures: [],
					warnings: [{ index: 0, kind: 'rename_panel', message: 'title is very long' }]
				}
			]
		});
		expect(toWirePreviewResult(result), 'the wire payload uses snake_case throughout').toEqual({
			preview_id: 'preview_1',
			base_revision: 4,
			diff: [
				{
					change: 'updated',
					entity_type: 'panel',
					id: 'panel_chart_1',
					fields: [{ field: 'title', before: 'Chart', after: 'AAPL Chart' }]
				}
			],
			affected_ids: ['panel_chart_1'],
			diff_summary: 'Renamed the chart panel.',
			warnings: [{ index: 0, kind: 'rename_panel', message: 'title is very long' }],
			failures: [],
			per_operation: [
				{
					index: 0,
					kind: 'rename_panel',
					describe: 'Rename the chart panel',
					failures: [],
					warnings: [{ index: 0, kind: 'rename_panel', message: 'title is very long' }]
				}
			],
			applicable: true
		});
	});

	it('emits every failure in the batch, keyed by position', () => {
		const result = buildPreviewResult({
			previewId: 'preview_2',
			baseRevision: 1,
			diff: [],
			summary: 'Nothing can be applied.',
			failures: [
				{ index: 0, kind: 'unknown_kind', reason: 'operation kind is not registered' },
				{ index: 2, kind: 'set_filter', reason: 'threshold must be a number' }
			]
		});
		const wire = toWirePreviewResult(result);
		expect(
			wire.failures.map((f) => f.index),
			'every failure survives serialization with its position'
		).toEqual([0, 2]);
		expect(wire.applicable, 'the wire payload states the preview is not applicable').toBe(false);
	});

	it('keeps the applicable flag present even when false', () => {
		const result = buildPreviewResult({
			previewId: 'preview_3',
			baseRevision: 1,
			diff: [],
			summary: 'x',
			failures: [{ index: 0, kind: 'x', reason: 'bad' }]
		});
		const wire = toWirePreviewResult(result);
		expect('applicable' in wire, 'applicable is emitted, not omitted when false').toBe(true);
	});
});
