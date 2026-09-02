// The six structural operations edit_filter_tree exposes (T-1009-4), as pure
// transformations over T-1009-1's FilterNode model. Every operation returns a
// result rather than throwing on an expected rejection, so the tool layer can
// turn a rejection into OperationValidationError's issues list without a
// try/catch, and so these functions stay testable with no workspace and no
// network. Node-ID stability is the whole point: every path here rebuilds
// only the tree nodes on the way to the target, and mints a fresh id only
// where a node is genuinely new (add, group).
import type { IdSequencer, ResourceId } from '../workbench/domain/ids';
import type { Condition } from './conditions';
import type { ConditionNode, FilterNode, GroupNode, GroupOp } from './definition';

export interface FilterTreeOpSuccess {
	ok: true;
	tree: FilterNode;
	affectedIds: ResourceId[];
	diffSummary: string;
}

export interface FilterTreeOpFailure {
	ok: false;
	message: string;
	// Populated only for an unknown-node-id rejection (AC8's self-correction
	// convention) -- other rejections (arity, non-siblings, missing input)
	// name their own problem in `message` instead.
	validNodeIds?: ResourceId[];
}

export type FilterTreeOpResult = FilterTreeOpSuccess | FilterTreeOpFailure;

function isGroup(node: FilterNode): node is GroupNode {
	return node.kind === 'group';
}

function collectNodeIds(node: FilterNode, out: ResourceId[] = []): ResourceId[] {
	out.push(node.nodeId);
	if (isGroup(node)) {
		for (const child of node.children) {
			collectNodeIds(child, out);
		}
	}
	return out;
}

function findNode(node: FilterNode, nodeId: ResourceId): FilterNode | null {
	if (node.nodeId === nodeId) {
		return node;
	}
	if (!isGroup(node)) {
		return null;
	}
	for (const child of node.children) {
		const found = findNode(child, nodeId);
		if (found) {
			return found;
		}
	}
	return null;
}

function unknownNodeFailure(tree: FilterNode, nodeId: ResourceId): FilterTreeOpFailure {
	return { ok: false, message: `Unknown node id: ${nodeId}.`, validNodeIds: collectNodeIds(tree) };
}

// Replaces the single node with id `targetId` using `transform`, rebuilding
// only the path from root to it. `found` false means the input tree is
// returned untouched (same reference where nothing on the path changed).
function transformNodeById(
	node: FilterNode,
	targetId: ResourceId,
	transform: (node: FilterNode) => FilterNode
): { node: FilterNode; found: boolean } {
	if (node.nodeId === targetId) {
		return { node: transform(node), found: true };
	}
	if (!isGroup(node)) {
		return { node, found: false };
	}
	let found = false;
	const children = node.children.map((child) => {
		const result = transformNodeById(child, targetId, transform);
		found = found || result.found;
		return result.node;
	});
	return { node: found ? { ...node, children } : node, found };
}

// Replaces the children array of the group whose id is `parentId`.
// `transform` returning null means "not applicable here" (e.g. the node at
// `parentId` is a condition, not a group), distinct from "not found yet".
function transformGroupChildren(
	node: FilterNode,
	parentId: ResourceId,
	transform: (children: FilterNode[]) => FilterNode[] | null
): { node: FilterNode; found: boolean } {
	if (node.nodeId === parentId) {
		if (!isGroup(node)) {
			return { node, found: false };
		}
		const nextChildren = transform(node.children);
		return nextChildren === null
			? { node, found: false }
			: { node: { ...node, children: nextChildren }, found: true };
	}
	if (!isGroup(node)) {
		return { node, found: false };
	}
	let found = false;
	const children = node.children.map((child) => {
		const result = transformGroupChildren(child, parentId, transform);
		found = found || result.found;
		return result.node;
	});
	return { node: found ? { ...node, children } : node, found };
}

// Splices `targetId` and its whole subtree out of wherever it lives.
function removeNodeById(
	node: FilterNode,
	targetId: ResourceId
): { node: FilterNode; removed: boolean } {
	if (!isGroup(node)) {
		return { node, removed: false };
	}
	let removed = node.children.some((child) => child.nodeId === targetId);
	const afterDirectRemoval = removed
		? node.children.filter((child) => child.nodeId !== targetId)
		: node.children;
	const children = afterDirectRemoval.map((child) => {
		const result = removeNodeById(child, targetId);
		removed = removed || result.removed;
		return result.node;
	});
	return { node: removed ? { ...node, children } : node, removed };
}

// Finds the group whose *direct* children are exactly (a superset with all
// requested ids among) its own children -- i.e. the siblings' common parent.
function locateSiblingParent(node: FilterNode, nodeIds: ResourceId[]): GroupNode | null {
	if (!isGroup(node)) {
		return null;
	}
	const childIds = new Set(node.children.map((child) => child.nodeId));
	if (nodeIds.every((id) => childIds.has(id))) {
		return node;
	}
	for (const child of node.children) {
		const found = locateSiblingParent(child, nodeIds);
		if (found) {
			return found;
		}
	}
	return null;
}

export function addFilterNode(
	tree: FilterNode,
	ids: IdSequencer,
	input: { parentNodeId?: ResourceId; condition: Condition }
): FilterTreeOpResult {
	const parentNodeId = input.parentNodeId ?? tree.nodeId;
	const parent = findNode(tree, parentNodeId);
	if (!parent) {
		return unknownNodeFailure(tree, parentNodeId);
	}
	if (parent.kind !== 'group') {
		return {
			ok: false,
			message: `Node ${parentNodeId} is a condition, not a group; it cannot hold children.`
		};
	}
	const newNodeId = ids.next('filter');
	const newNode: ConditionNode = {
		nodeId: newNodeId,
		kind: 'condition',
		condition: input.condition,
		enabled: true
	};
	const result = transformGroupChildren(tree, parentNodeId, (children) => [...children, newNode]);
	return {
		ok: true,
		tree: result.node,
		affectedIds: [newNodeId],
		diffSummary: `Added condition node ${newNodeId} under ${parentNodeId}.`
	};
}

export function updateFilterCondition(
	tree: FilterNode,
	input: { nodeId: ResourceId; condition: Condition }
): FilterTreeOpResult {
	const existing = findNode(tree, input.nodeId);
	if (!existing) {
		return unknownNodeFailure(tree, input.nodeId);
	}
	if (existing.kind !== 'condition') {
		return {
			ok: false,
			message: `Node ${input.nodeId} is a group, not a condition; use group/reorder/set_enabled to edit it.`
		};
	}
	const result = transformNodeById(tree, input.nodeId, (node) =>
		node.kind === 'condition' ? { ...node, condition: input.condition } : node
	);
	return {
		ok: true,
		tree: result.node,
		affectedIds: [input.nodeId],
		diffSummary: `Updated condition on node ${input.nodeId}.`
	};
}

export function removeFilterNode(
	tree: FilterNode,
	input: { nodeId: ResourceId }
): FilterTreeOpResult {
	const existing = findNode(tree, input.nodeId);
	if (!existing) {
		return unknownNodeFailure(tree, input.nodeId);
	}
	if (input.nodeId === tree.nodeId) {
		return { ok: false, message: 'The root node cannot be removed.' };
	}
	const result = removeNodeById(tree, input.nodeId);
	return {
		ok: true,
		tree: result.node,
		affectedIds: [input.nodeId],
		diffSummary: `Removed node ${input.nodeId} and its subtree.`
	};
}

export function groupFilterNodes(
	tree: FilterNode,
	ids: IdSequencer,
	input: { nodeIds: ResourceId[]; op: GroupOp }
): FilterTreeOpResult {
	const { nodeIds, op } = input;
	if (nodeIds.length < 2) {
		return { ok: false, message: 'Grouping requires at least two sibling node ids.' };
	}
	// A grouping request always holds >= 2 children, and a "not" group must
	// hold exactly one (AC7) -- the two never intersect, so this is rejected
	// before any tree walk or id mint rather than built and then discarded.
	if (op === 'not') {
		return {
			ok: false,
			message: 'A "not" group must hold exactly one child; grouping always holds two or more.'
		};
	}
	if (new Set(nodeIds).size !== nodeIds.length) {
		return { ok: false, message: 'Grouping node ids must not repeat.' };
	}
	const allIds = collectNodeIds(tree);
	const unknown = nodeIds.filter((id) => !allIds.includes(id));
	if (unknown.length > 0) {
		return {
			ok: false,
			message: `Unknown node id(s): ${unknown.join(', ')}.`,
			validNodeIds: allIds
		};
	}
	if (nodeIds.includes(tree.nodeId)) {
		return { ok: false, message: 'The root node cannot be grouped.' };
	}
	const parent = locateSiblingParent(tree, nodeIds);
	if (!parent) {
		return { ok: false, message: 'Grouping node ids that are not siblings is rejected.' };
	}
	const grouped: FilterNode[] = [];
	for (const id of nodeIds) {
		const child = parent.children.find((c) => c.nodeId === id);
		if (!child) {
			return { ok: false, message: `Unknown node id(s): ${id}.`, validNodeIds: allIds };
		}
		grouped.push(child);
	}
	const newGroupId = ids.next('filter');
	const newGroup: GroupNode = {
		nodeId: newGroupId,
		kind: 'group',
		op,
		children: grouped,
		enabled: true
	};
	// The lowest original index among the grouped ids is never preceded by
	// another grouped id, so every element before it in `parent.children`
	// survives the splice -- inserting at that same index needs no
	// adjustment for what got removed.
	const firstIndex = Math.min(
		...nodeIds.map((id) => parent.children.findIndex((c) => c.nodeId === id))
	);
	const result = transformGroupChildren(tree, parent.nodeId, (children) => {
		const remaining = children.filter((c) => !nodeIds.includes(c.nodeId));
		return [...remaining.slice(0, firstIndex), newGroup, ...remaining.slice(firstIndex)];
	});
	return {
		ok: true,
		tree: result.node,
		affectedIds: [newGroupId, ...nodeIds],
		diffSummary: `Grouped ${nodeIds.length} node(s) under a new "${op}" group ${newGroupId}.`
	};
}

export function setFilterNodeEnabled(
	tree: FilterNode,
	input: { nodeId: ResourceId; enabled: boolean }
): FilterTreeOpResult {
	const existing = findNode(tree, input.nodeId);
	if (!existing) {
		return unknownNodeFailure(tree, input.nodeId);
	}
	const result = transformNodeById(tree, input.nodeId, (node) => ({
		...node,
		enabled: input.enabled
	}));
	return {
		ok: true,
		tree: result.node,
		affectedIds: [input.nodeId],
		diffSummary: `${input.enabled ? 'Enabled' : 'Disabled'} node ${input.nodeId}.`
	};
}

export function reorderFilterChildren(
	tree: FilterNode,
	input: { parentNodeId?: ResourceId; orderedNodeIds: ResourceId[] }
): FilterTreeOpResult {
	const parentNodeId = input.parentNodeId ?? tree.nodeId;
	const parent = findNode(tree, parentNodeId);
	if (!parent) {
		return unknownNodeFailure(tree, parentNodeId);
	}
	if (parent.kind !== 'group') {
		return {
			ok: false,
			message: `Node ${parentNodeId} is a condition, not a group; it has no children to reorder.`
		};
	}
	const currentIds = parent.children.map((c) => c.nodeId);
	const sameSet =
		currentIds.length === input.orderedNodeIds.length &&
		new Set(input.orderedNodeIds).size === input.orderedNodeIds.length &&
		currentIds.every((id) => input.orderedNodeIds.includes(id));
	if (!sameSet) {
		return {
			ok: false,
			message: `orderedNodeIds must be exactly the current children of ${parentNodeId}: ${currentIds.join(', ')}.`
		};
	}
	const byId = new Map(parent.children.map((c) => [c.nodeId, c] as const));
	const reordered: FilterNode[] = [];
	for (const id of input.orderedNodeIds) {
		const child = byId.get(id);
		if (child) {
			reordered.push(child);
		}
	}
	const result = transformGroupChildren(tree, parentNodeId, () => reordered);
	return {
		ok: true,
		tree: result.node,
		affectedIds: [parentNodeId, ...input.orderedNodeIds],
		diffSummary: `Reordered children of ${parentNodeId}.`
	};
}
