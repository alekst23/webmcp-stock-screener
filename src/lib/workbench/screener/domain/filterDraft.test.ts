import { describe, expect, it } from 'vitest';
import { emptyWorkspace } from '../../domain/workspace';
import type { FilterNode } from '../../../screener/definition';
import {
	filterDraftIdSeed,
	normalizeFilterDraft,
	readFilterDraft,
	readFilterDrafts,
	toWireFilterDraft,
	writeFilterDraft,
	type FilterDraft
} from './filterDraft';

function tree(): FilterNode {
	return {
		nodeId: 'filter_2',
		kind: 'group',
		op: 'and',
		enabled: true,
		children: [
			{
				nodeId: 'filter_3',
				kind: 'condition',
				enabled: true,
				condition: {
					type: 'scalar',
					fieldId: 'field.volume',
					operator: 'op.greater_than',
					value: 1,
					unit: null
				}
			}
		]
	};
}

function draft(overrides: Partial<FilterDraft> = {}): FilterDraft {
	return {
		draftId: 'filter_draft_1',
		sourceSetupId: 'setup_1',
		createdAt: '2026-01-01T00:00:00.000Z',
		sourceRevision: 3,
		tree: tree(),
		provenance: [{ nodeId: 'filter_3', characteristic: 'study', explanation: 'from a study' }],
		...overrides
	};
}

describe('filterDraft read/write', () => {
	it('round-trips a draft through write and read', () => {
		const doc = writeFilterDraft(
			emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'),
			draft()
		);
		const read = readFilterDraft(doc, 'filter_draft_1');
		expect(read).toEqual(draft());
	});

	it('never mutates the input document', () => {
		const original = emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z');
		writeFilterDraft(original, draft());
		expect(original.extensions).toEqual({});
	});

	it('lists every normalizable draft and drops corrupt entries', () => {
		let doc = writeFilterDraft(
			emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'),
			draft()
		);
		doc = {
			...doc,
			extensions: {
				...doc.extensions,
				filter_drafts: { ...(doc.extensions.filter_drafts as object), bad: { not: 'a draft' } }
			}
		};
		expect(readFilterDrafts(doc)).toEqual([draft()]);
	});

	it('normalizes an unknown draft id to null rather than throwing', () => {
		const doc = writeFilterDraft(
			emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'),
			draft()
		);
		expect(readFilterDraft(doc, 'filter_draft_9')).toBeNull();
	});

	it('normalizeFilterDraft rejects a payload with no recoverable tree', () => {
		expect(
			normalizeFilterDraft({ draftId: 'filter_draft_1', sourceSetupId: 'setup_1', tree: null })
		).toBeNull();
	});

	it('normalizeFilterDraft drops an unrecognized condition rather than keeping a half node', () => {
		const corrupt = {
			...draft(),
			tree: {
				nodeId: 'filter_2',
				kind: 'group',
				op: 'and',
				enabled: true,
				children: [
					{
						nodeId: 'filter_3',
						kind: 'condition',
						enabled: true,
						condition: { type: 'not_a_real_type' }
					}
				]
			}
		};
		const normalized = normalizeFilterDraft(corrupt);
		expect(normalized?.tree).toEqual({
			nodeId: 'filter_2',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: []
		});
	});
});

describe('toWireFilterDraft', () => {
	it('serializes to snake_case, including provenance entries', () => {
		const wire = toWireFilterDraft(draft());
		expect(wire).toMatchObject({
			draft_id: 'filter_draft_1',
			source_setup_id: 'setup_1',
			source_revision: 3,
			provenance: [{ node_id: 'filter_3', characteristic: 'study', explanation: 'from a study' }]
		});
	});

	it('omits accepted_at/accepted_screener_id when the draft has never been accepted', () => {
		const wire = toWireFilterDraft(draft());
		expect(wire.accepted_at).toBeUndefined();
		expect(wire.accepted_screener_id).toBeUndefined();
	});

	it('includes acceptance fields once a draft has been accepted', () => {
		const wire = toWireFilterDraft(
			draft({ acceptedAt: '2026-02-01T00:00:00.000Z', acceptedScreenerId: 'screener_1' })
		);
		expect(wire.accepted_at).toBe('2026-02-01T00:00:00.000Z');
		expect(wire.accepted_screener_id).toBe('screener_1');
	});
});

describe('filterDraftIdSeed', () => {
	it('reports the highest existing filter_draft sequence number', () => {
		let doc = writeFilterDraft(
			emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'),
			draft()
		);
		doc = writeFilterDraft(doc, draft({ draftId: 'filter_draft_3' }));
		expect(filterDraftIdSeed(doc)).toEqual({ 'filter:draft': 3 });
	});

	it('returns an empty seed for a workspace with no drafts', () => {
		expect(
			filterDraftIdSeed(emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'))
		).toEqual({});
	});
});
