import { describe, expect, it } from 'vitest';
import { createIdSequencer } from '../workbench/domain/ids';
import type { Condition } from './conditions';
import { emptyFilterTree, type ConditionNode, type FilterNode, type GroupNode } from './definition';
import {
	addFilterNode,
	groupFilterNodes,
	removeFilterNode,
	reorderFilterChildren,
	setFilterNodeEnabled,
	updateFilterCondition,
	type FilterTreeOpResult
} from './filterTree';

function scalarCondition(fieldId: string, value: number): Condition {
	return { type: 'scalar', fieldId, operator: 'gt', value, unit: null };
}

function condition(nodeId: string, fieldId = 'price', value = 10, enabled = true): ConditionNode {
	return { nodeId, kind: 'condition', condition: scalarCondition(fieldId, value), enabled };
}

function group(
	nodeId: string,
	op: GroupNode['op'],
	children: FilterNode[],
	enabled = true
): GroupNode {
	return { nodeId, kind: 'group', op, children, enabled };
}

function collectIds(node: FilterNode, out: string[] = []): string[] {
	out.push(node.nodeId);
	if (node.kind === 'group') {
		for (const child of node.children) {
			collectIds(child, out);
		}
	}
	return out;
}

function ok(
	result: FilterTreeOpResult
): asserts result is Extract<FilterTreeOpResult, { ok: true }> {
	expect(
		result.ok,
		`expected an accepted operation, got a rejection: ${JSON.stringify(result)}`
	).toBe(true);
}

function rejected(
	result: FilterTreeOpResult
): asserts result is Extract<FilterTreeOpResult, { ok: false }> {
	expect(
		result.ok,
		`expected a rejection, got an accepted operation: ${JSON.stringify(result)}`
	).toBe(false);
}

describe('addFilterNode', () => {
	it('add_toEmptyRoot_appendsUnderRootWithNewId', () => {
		const ids = createIdSequencer({ filter: 1 });
		const tree = emptyFilterTree('filter_1');
		const result = addFilterNode(tree, ids, { condition: scalarCondition('price', 10) });
		ok(result);
		expect(result.tree.kind, 'root must stay a group').toBe('group');
		const root = result.tree as GroupNode;
		expect(root.children, 'exactly one condition should be appended').toHaveLength(1);
		expect(result.affectedIds, 'the new node id is reported in affectedIds').toEqual([
			root.children[0]?.nodeId
		]);
		expect(root.children[0]?.nodeId, 'new node id mints off the shared filter sequence').toBe(
			'filter_2'
		);
	});

	it('add_toNamedParentGroup_appendsOnlyThere', () => {
		const ids = createIdSequencer({ filter: 3 });
		const other = condition('filter_2');
		const nested = group('filter_3', 'and', []);
		const tree = group('filter_1', 'and', [other, nested]);
		const result = addFilterNode(tree, ids, {
			parentNodeId: 'filter_3',
			condition: scalarCondition('rsi', 40)
		});
		ok(result);
		const root = result.tree as GroupNode;
		const untouchedSibling = root.children.find((c) => c.nodeId === 'filter_2');
		expect(untouchedSibling, 'sibling outside the named parent is untouched').toEqual(other);
		const target = root.children.find((c) => c.nodeId === 'filter_3') as GroupNode;
		expect(target.children, 'new node lands inside the named parent, nowhere else').toHaveLength(1);
	});

	it('add_unknownParent_rejectedListingValidIds', () => {
		const ids = createIdSequencer({ filter: 1 });
		const tree = group('filter_1', 'and', [condition('filter_2')]);
		const result = addFilterNode(tree, ids, {
			parentNodeId: 'filter_999',
			condition: scalarCondition('price', 10)
		});
		rejected(result);
		expect(result.validNodeIds, 'unknown-id rejection lists the ids that do exist').toEqual([
			'filter_1',
			'filter_2'
		]);
	});

	it('add_conditionAsParent_rejected', () => {
		const ids = createIdSequencer({ filter: 1 });
		const leaf = condition('filter_2');
		const tree = group('filter_1', 'and', [leaf]);
		const result = addFilterNode(tree, ids, {
			parentNodeId: 'filter_2',
			condition: scalarCondition('price', 10)
		});
		rejected(result);
		expect(result.message, 'a condition node cannot hold children').toContain('filter_2');
	});
});

describe('updateFilterCondition', () => {
	it('update_existingCondition_changesOnlyThatNodeAndKeepsSiblingsIntact', () => {
		const sibling = condition('filter_2', 'volume', 1000);
		const target = condition('filter_3', 'price', 10);
		const tree = group('filter_1', 'and', [sibling, target]);
		const result = updateFilterCondition(tree, {
			nodeId: 'filter_3',
			condition: scalarCondition('price', 25)
		});
		ok(result);
		const root = result.tree as GroupNode;
		expect(root.children, 'sibling count and order unchanged').toHaveLength(2);
		expect(root.children[0], 'untouched sibling node is unchanged').toEqual(sibling);
		const updated = root.children[1] as ConditionNode;
		expect(updated.nodeId, 'node id is stable across an update').toBe('filter_3');
		expect(updated.condition, 'condition payload is replaced').toEqual(
			scalarCondition('price', 25)
		);
	});

	it('update_groupNode_rejected', () => {
		const tree = group('filter_1', 'and', [group('filter_2', 'or', [])]);
		const result = updateFilterCondition(tree, {
			nodeId: 'filter_2',
			condition: scalarCondition('price', 10)
		});
		rejected(result);
		expect(result.message, 'group nodes cannot be updated as a condition').toContain('group');
	});

	it('update_unknownNodeId_rejected', () => {
		const tree = emptyFilterTree('filter_1');
		const result = updateFilterCondition(tree, {
			nodeId: 'filter_404',
			condition: scalarCondition('price', 10)
		});
		rejected(result);
		expect(result.validNodeIds, 'lists the known ids for self-correction').toEqual(['filter_1']);
	});
});

describe('removeFilterNode', () => {
	it('remove_leaf_dropsOnlyThatNodeKeepingOtherIdsStable', () => {
		const keep = condition('filter_2');
		const drop = condition('filter_3');
		const tree = group('filter_1', 'and', [keep, drop]);
		const result = removeFilterNode(tree, { nodeId: 'filter_3' });
		ok(result);
		const root = result.tree as GroupNode;
		expect(
			root.children.map((c) => c.nodeId),
			'only the removed id is gone'
		).toEqual(['filter_2']);
	});

	it('remove_group_dropsWholeSubtree', () => {
		const nestedLeaf = condition('filter_3');
		const removedGroup = group('filter_2', 'or', [nestedLeaf]);
		const keep = condition('filter_4');
		const tree = group('filter_1', 'and', [removedGroup, keep]);
		const result = removeFilterNode(tree, { nodeId: 'filter_2' });
		ok(result);
		const remainingIds = collectIds(result.tree);
		expect(remainingIds, 'the whole subtree, including the nested leaf, is gone').toEqual([
			'filter_1',
			'filter_4'
		]);
	});

	it('remove_rootNode_rejected', () => {
		const tree = emptyFilterTree('filter_1');
		const result = removeFilterNode(tree, { nodeId: 'filter_1' });
		rejected(result);
	});

	it('remove_unknownNodeId_rejected', () => {
		const tree = emptyFilterTree('filter_1');
		const result = removeFilterNode(tree, { nodeId: 'filter_404' });
		rejected(result);
	});
});

describe('groupFilterNodes', () => {
	it('group_twoSiblings_replacesThemInPositionKeepingTheirIds', () => {
		const ids = createIdSequencer({ filter: 4 });
		const a = condition('filter_2', 'price', 1);
		const b = condition('filter_3', 'price', 2);
		const c = condition('filter_4', 'price', 3);
		const tree = group('filter_1', 'and', [a, b, c]);
		const result = groupFilterNodes(tree, ids, { nodeIds: ['filter_3', 'filter_2'], op: 'or' });
		ok(result);
		const root = result.tree as GroupNode;
		expect(root.children, 'group replaces the two grouped nodes with itself').toHaveLength(2);
		const newGroup = root.children[0] as GroupNode;
		expect(newGroup.op, 'requested operator is used').toBe('or');
		expect(
			newGroup.children.map((c) => c.nodeId),
			'children follow the requested order, not original order'
		).toEqual(['filter_3', 'filter_2']);
		expect(
			root.children[1]?.nodeId,
			'ungrouped sibling keeps its id and follows the new group'
		).toBe('filter_4');
		expect(result.affectedIds, 'affectedIds names the new group and every grouped id').toEqual([
			newGroup.nodeId,
			'filter_3',
			'filter_2'
		]);
	});

	it('group_landsAtFirstGroupedSiblingsOriginalPosition', () => {
		const ids = createIdSequencer({ filter: 4 });
		const a = condition('filter_2');
		const b = condition('filter_3');
		const c = condition('filter_4');
		const tree = group('filter_1', 'and', [a, b, c]);
		// Grouping the *last two* siblings must leave the untouched first
		// sibling in place ahead of the new group.
		const result = groupFilterNodes(tree, ids, { nodeIds: ['filter_3', 'filter_4'], op: 'and' });
		ok(result);
		const root = result.tree as GroupNode;
		expect(root.children[0]?.nodeId, 'untouched leading sibling stays first').toBe('filter_2');
		expect(root.children[1]?.kind, 'new group takes the position right after it').toBe('group');
	});

	it('group_notOpWithTwoIds_rejectedByArity', () => {
		const ids = createIdSequencer({ filter: 2 });
		const tree = group('filter_1', 'and', [condition('filter_2'), condition('filter_3')]);
		const result = groupFilterNodes(tree, ids, { nodeIds: ['filter_2', 'filter_3'], op: 'not' });
		rejected(result);
		expect(result.message, 'a not group cannot hold two children').toContain('not');
	});

	it('group_nonSiblingIds_rejected', () => {
		const ids = createIdSequencer({ filter: 3 });
		const nested = group('filter_3', 'or', [condition('filter_4')]);
		const tree = group('filter_1', 'and', [condition('filter_2'), nested]);
		const result = groupFilterNodes(tree, ids, { nodeIds: ['filter_2', 'filter_4'], op: 'and' });
		rejected(result);
		expect(result.message, 'nodes from different parents are not siblings').toContain('siblings');
	});

	it('group_unknownNodeId_rejected', () => {
		const ids = createIdSequencer({ filter: 2 });
		const tree = group('filter_1', 'and', [condition('filter_2')]);
		const result = groupFilterNodes(tree, ids, { nodeIds: ['filter_2', 'filter_999'], op: 'and' });
		rejected(result);
		expect(result.validNodeIds, 'unknown id rejection still lists the valid ids').toBeDefined();
	});

	it('group_fewerThanTwoIds_rejected', () => {
		const ids = createIdSequencer({ filter: 2 });
		const tree = group('filter_1', 'and', [condition('filter_2')]);
		const result = groupFilterNodes(tree, ids, { nodeIds: ['filter_2'], op: 'and' });
		rejected(result);
	});
});

describe('setFilterNodeEnabled', () => {
	it('setEnabled_disable_keepsNodeInTreeWithIdAndPositionStable', () => {
		const target = condition('filter_2');
		const sibling = condition('filter_3');
		const tree = group('filter_1', 'and', [target, sibling]);
		const result = setFilterNodeEnabled(tree, { nodeId: 'filter_2', enabled: false });
		ok(result);
		const root = result.tree as GroupNode;
		expect(
			root.children.map((c) => c.nodeId),
			'ids and order are unchanged'
		).toEqual(['filter_2', 'filter_3']);
		expect(root.children[0]?.enabled, 'target node reports disabled').toBe(false);
		expect(root.children[1]?.enabled, 'sibling untouched').toBe(true);
	});

	it('setEnabled_unknownNodeId_rejected', () => {
		const tree = emptyFilterTree('filter_1');
		const result = setFilterNodeEnabled(tree, { nodeId: 'filter_404', enabled: false });
		rejected(result);
	});
});

describe('reorderFilterChildren', () => {
	it('reorder_permutesChildren_withoutChangingAnyId', () => {
		const a = condition('filter_2');
		const b = condition('filter_3');
		const c = condition('filter_4');
		const tree = group('filter_1', 'and', [a, b, c]);
		const result = reorderFilterChildren(tree, {
			parentNodeId: 'filter_1',
			orderedNodeIds: ['filter_4', 'filter_2', 'filter_3']
		});
		ok(result);
		const root = result.tree as GroupNode;
		expect(
			root.children.map((c) => c.nodeId),
			'requested order is applied'
		).toEqual(['filter_4', 'filter_2', 'filter_3']);
		expect(new Set(collectIds(result.tree)), 'the id set is unchanged by a reorder').toEqual(
			new Set(collectIds(tree))
		);
	});

	it('reorder_defaultsToRoot_whenParentNodeIdOmitted', () => {
		const a = condition('filter_2');
		const b = condition('filter_3');
		const tree = group('filter_1', 'and', [a, b]);
		const result = reorderFilterChildren(tree, { orderedNodeIds: ['filter_3', 'filter_2'] });
		ok(result);
		const root = result.tree as GroupNode;
		expect(root.children.map((c) => c.nodeId)).toEqual(['filter_3', 'filter_2']);
	});

	it('reorder_mismatchedIdSet_rejected', () => {
		const a = condition('filter_2');
		const b = condition('filter_3');
		const tree = group('filter_1', 'and', [a, b]);
		const missingOne = reorderFilterChildren(tree, {
			parentNodeId: 'filter_1',
			orderedNodeIds: ['filter_2']
		});
		rejected(missingOne);
		const duplicated = reorderFilterChildren(tree, {
			parentNodeId: 'filter_1',
			orderedNodeIds: ['filter_2', 'filter_2']
		});
		rejected(duplicated);
		const foreign = reorderFilterChildren(tree, {
			parentNodeId: 'filter_1',
			orderedNodeIds: ['filter_2', 'filter_999']
		});
		rejected(foreign);
	});
});

describe('deep nesting', () => {
	function deepTree(): FilterNode {
		// filter_1(and) -> [filter_2(condition), filter_3(or) -> [filter_4(not) -> [filter_5(condition)]]]
		return group('filter_1', 'and', [
			condition('filter_2'),
			group('filter_3', 'or', [group('filter_4', 'not', [condition('filter_5')])])
		]);
	}

	it('operations_addressDeeplyNestedNodesByIdRegardlessOfDepth', () => {
		const tree = deepTree();
		const disabled = setFilterNodeEnabled(tree, { nodeId: 'filter_5', enabled: false });
		ok(disabled);
		const deepNode = findDeep(disabled.tree, 'filter_5');
		expect(deepNode?.enabled, 'a node four levels deep is reachable and mutable').toBe(false);
	});

	it('operations_rejectUnknownIdEvenWhenTreeIsDeeplyNested', () => {
		const tree = deepTree();
		const result = updateFilterCondition(tree, {
			nodeId: 'filter_999',
			condition: scalarCondition('price', 1)
		});
		rejected(result);
		expect(result.validNodeIds).toEqual([
			'filter_1',
			'filter_2',
			'filter_3',
			'filter_4',
			'filter_5'
		]);
	});

	function findDeep(node: FilterNode, nodeId: string): FilterNode | null {
		if (node.nodeId === nodeId) return node;
		if (node.kind !== 'group') return null;
		for (const child of node.children) {
			const found = findDeep(child, nodeId);
			if (found) return found;
		}
		return null;
	}
});

describe('node-id stability across group and reorder', () => {
	it('grouping_thenReorderingTheNewGroupsChildren_neverMintsOrDropsAnId', () => {
		const ids = createIdSequencer({ filter: 4 });
		const a = condition('filter_2');
		const b = condition('filter_3');
		const c = condition('filter_4');
		const tree = group('filter_1', 'and', [a, b, c]);

		const before = new Set(collectIds(tree));
		const grouped = groupFilterNodes(tree, ids, { nodeIds: ['filter_2', 'filter_3'], op: 'and' });
		ok(grouped);
		const newGroupId = (grouped.tree as GroupNode).children[0]?.nodeId;
		expect(newGroupId, 'exactly one new id (the group) was minted').toBe('filter_5');

		const reordered = reorderFilterChildren(grouped.tree, {
			parentNodeId: newGroupId,
			orderedNodeIds: ['filter_3', 'filter_2']
		});
		ok(reordered);

		const after = new Set(collectIds(reordered.tree));
		const expected = new Set([...before, 'filter_5']);
		expect(after, 'grouping mints exactly one id; reordering mints none').toEqual(expected);
	});
});
