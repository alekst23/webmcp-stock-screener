import { describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../../../catalog/registry';
import { createScreener, type FilterNode, type GroupNode } from '../../../screener/definition';
import { readScreener, writeScreener } from '../../../screener/state';
import { createIdSequencer } from '../../domain/ids';
import { emptyWorkspace } from '../../domain/workspace';
import { readFilterDraft, writeFilterDraft, type FilterDraft } from '../domain/filterDraft';
import {
	createAcceptFilterDraftOperation,
	createEditFilterDraftOperation
} from './filterDraftOperations';

function fixedClock(iso: string) {
	return { now: () => iso };
}

function scalarCondition(fieldId: string, value: number) {
	return { type: 'scalar' as const, fieldId, operator: 'op.greater_than', value, unit: null };
}

function baseDoc() {
	const clock = fixedClock('2026-01-01T00:00:00.000Z');
	const ids = createIdSequencer();
	let doc = emptyWorkspace('workspace_1', 'W', clock.now());
	const screener = createScreener(ids, doc.id, 'S');
	doc = writeScreener(doc, screener);
	const draft: FilterDraft = {
		draftId: 'filter_draft_1',
		sourceSetupId: 'setup_1',
		createdAt: clock.now(),
		sourceRevision: 1,
		tree: {
			nodeId: 'filter_root',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [
				{
					nodeId: 'filter_a',
					kind: 'condition',
					enabled: true,
					condition: scalarCondition('field.volume', 1000)
				},
				{
					nodeId: 'filter_b',
					kind: 'condition',
					enabled: false,
					condition: scalarCondition('field.price.close', 50)
				}
			]
		},
		provenance: [
			{ nodeId: 'filter_a', characteristic: 'study', explanation: 'from a study' },
			{
				nodeId: 'filter_b',
				characteristic: 'annotation.price_level',
				explanation: 'from an annotation'
			}
		]
	};
	doc = writeFilterDraft(doc, draft);
	return { doc, ids, clock, screenerId: screener.screenerId };
}

describe('edit_filter_draft operation', () => {
	const op = createEditFilterDraftOperation({ registry: builtinCatalogRegistry });

	it('validate() rejects an unknown draft id', () => {
		const { doc } = baseDoc();
		const issues = op.validate(
			{ draftId: 'filter_draft_9', operation: 'set_enabled' } as never,
			doc
		);
		expect(issues.length).toBeGreaterThan(0);
	});

	it('add: appends a node with no provenance entry -- a manual addition, not a derived one', () => {
		const { doc, ids } = baseDoc();
		const draft = op.apply(
			{
				draftId: 'filter_draft_1',
				operation: 'add',
				condition: scalarCondition('field.volume', 5)
			} as never,
			doc,
			ids
		);
		const next = readFilterDraft(draft.document, 'filter_draft_1')!;
		const root = next.tree as GroupNode;
		expect(root.children).toHaveLength(3);
		const newNode = root.children[2] as FilterNode;
		expect(next.provenance.some((p) => p.nodeId === newNode.nodeId)).toBe(false);
	});

	it("update: replaces the condition and drops the node's old provenance entry", () => {
		const { doc, ids } = baseDoc();
		const draft = op.apply(
			{
				draftId: 'filter_draft_1',
				operation: 'update',
				nodeId: 'filter_a',
				condition: scalarCondition('field.volume', 9999)
			} as never,
			doc,
			ids
		);
		const next = readFilterDraft(draft.document, 'filter_draft_1')!;
		expect(next.provenance.some((p) => p.nodeId === 'filter_a')).toBe(false);
		expect(next.provenance.some((p) => p.nodeId === 'filter_b')).toBe(true); // untouched sibling survives
		const root = next.tree as GroupNode;
		const updated = root.children.find((c) => c.nodeId === 'filter_a');
		expect(updated?.kind === 'condition' ? updated.condition : null).toMatchObject({ value: 9999 });
	});

	it('remove: drops the node and its provenance entry; the draft remains a draft', () => {
		const { doc, ids } = baseDoc();
		const draft = op.apply(
			{ draftId: 'filter_draft_1', operation: 'remove', nodeId: 'filter_a' } as never,
			doc,
			ids
		);
		const next = readFilterDraft(draft.document, 'filter_draft_1')!;
		const root = next.tree as GroupNode;
		expect(root.children.map((c) => c.nodeId)).toEqual(['filter_b']);
		expect(next.provenance.some((p) => p.nodeId === 'filter_a')).toBe(false);
		expect(next.acceptedAt).toBeUndefined();
	});

	it('set_enabled: disables a node without touching its provenance', () => {
		const { doc, ids } = baseDoc();
		const draft = op.apply(
			{
				draftId: 'filter_draft_1',
				operation: 'set_enabled',
				nodeId: 'filter_a',
				enabled: false
			} as never,
			doc,
			ids
		);
		const next = readFilterDraft(draft.document, 'filter_draft_1')!;
		const root = next.tree as GroupNode;
		expect(root.children.find((c) => c.nodeId === 'filter_a')?.enabled).toBe(false);
		expect(next.provenance.some((p) => p.nodeId === 'filter_a')).toBe(true);
	});

	it("group: regroups two nodes under a new group, keeping both conditions' provenance", () => {
		const { doc, ids } = baseDoc();
		const draft = op.apply(
			{
				draftId: 'filter_draft_1',
				operation: 'group',
				nodeIds: ['filter_a', 'filter_b'],
				groupOp: 'or'
			} as never,
			doc,
			ids
		);
		const next = readFilterDraft(draft.document, 'filter_draft_1')!;
		const root = next.tree as GroupNode;
		expect(root.children).toHaveLength(1);
		const group = root.children[0] as GroupNode;
		expect(group.op).toBe('or');
		expect(group.children.map((c) => c.nodeId).sort()).toEqual(['filter_a', 'filter_b']);
		expect(next.provenance.map((p) => p.nodeId).sort()).toEqual(['filter_a', 'filter_b']);
	});

	it('rejects a condition carrying a field not in its typed model (no free-form expressions, AC2)', () => {
		const { doc, ids } = baseDoc();
		expect(() =>
			op.apply(
				{
					draftId: 'filter_draft_1',
					operation: 'add',
					condition: {
						type: 'scalar',
						fieldId: 'field.volume',
						operator: 'op.greater_than',
						value: 1,
						unit: null,
						sql: 'DROP TABLE x'
					}
				} as never,
				doc,
				ids
			)
		).toThrow();
	});
});

describe('accept_filter_draft operation', () => {
	it("replaces the target screener's filter tree wholesale with the draft's contents (AC6)", () => {
		const { doc, ids, clock, screenerId } = baseDoc();
		const op = createAcceptFilterDraftOperation({ clock });
		const before = readScreener(doc, screenerId)!;
		const result = op.apply(
			{ draftId: 'filter_draft_1', targetScreenerId: screenerId } as never,
			doc,
			ids
		);
		const after = readScreener(result.document, screenerId)!;
		expect(after.filterTree).toEqual(readFilterDraft(doc, 'filter_draft_1')!.tree);
		expect(after.filterTree).not.toEqual(before.filterTree);
		expect(after.revision).toBe(before.revision + 1);
	});

	it('stamps the draft as accepted', () => {
		const { doc, ids, clock, screenerId } = baseDoc();
		const op = createAcceptFilterDraftOperation({ clock });
		const result = op.apply(
			{ draftId: 'filter_draft_1', targetScreenerId: screenerId } as never,
			doc,
			ids
		);
		const draft = readFilterDraft(result.document, 'filter_draft_1')!;
		expect(draft.acceptedAt).toBe(clock.now());
		expect(draft.acceptedScreenerId).toBe(screenerId);
	});

	it("AC10: its inverse restores the screener's exact prior filter tree", () => {
		const { doc, ids, clock, screenerId } = baseDoc();
		const op = createAcceptFilterDraftOperation({ clock });
		const before = readScreener(doc, screenerId)!;
		const result = op.apply(
			{ draftId: 'filter_draft_1', targetScreenerId: screenerId } as never,
			doc,
			ids
		);
		expect(result.inverse).toBeTruthy();
		const restored = readScreener(result.inverse!.document, screenerId)!;
		expect(restored.filterTree).toEqual(before.filterTree);
	});

	it('validate() rejects an unknown screener id', () => {
		const { doc, clock } = baseDoc();
		const op = createAcceptFilterDraftOperation({ clock });
		const issues = op.validate(
			{ draftId: 'filter_draft_1', targetScreenerId: 'screener_9' } as never,
			doc
		);
		expect(issues.length).toBeGreaterThan(0);
	});
});
