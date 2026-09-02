// Boolean combination over the nested filter tree (T-1009-7 AC3, AC4, AC9):
// walks a FilterNode for one instrument, evaluating every enabled leaf
// condition (conditionEvaluation.ts) and combining group results by their
// declared op, to arbitrary depth. Retains a FilterNodeEvaluation for every
// enabled node -- groups included -- so a group's own pass/fail (not just
// its leaves) is explainable later (AC9); a disabled node, leaf or group, is
// skipped entirely: no recursion into it, no FilterNodeEvaluation, and no
// effect on its parent's combination (AC4).
//
// Infra layer: implements evaluation behind the domain port (ports.ts);
// domain code does not import this file.

import type { ResourceId } from '../../workbench/domain/ids';
import type { FilterNode, GroupOp } from '../definition';
import type { FilterNodeEvaluation } from '../run';
import { evaluateCondition, type ConditionEvalDeps } from './conditionEvaluation';

export interface TreeEvalResult {
	passed: boolean;
	nodeEvaluations: Record<ResourceId, FilterNodeEvaluation>;
	// Node ids where at least one referenced field/series/pattern/study was
	// unavailable for this instrument -- feeds engine.ts's per-node AC11
	// warning aggregation across the universe.
	unavailableNodeIds: ResourceId[];
}

// A group with zero enabled children -- every child disabled, or a
// genuinely empty group (the default screener's root) -- is vacuously true
// for every op. This is a single rule applied uniformly to AND, OR and NOT
// rather than three special cases: "nothing to require" (AND), "nothing to
// find" (OR), and "nothing to negate" (NOT) all mean the same thing here --
// no evidence against a match, so the tree does not eliminate it.
function combine(op: GroupOp, childResults: readonly boolean[]): boolean {
	if (childResults.length === 0) {
		return true;
	}
	if (op === 'and') {
		return childResults.every(Boolean);
	}
	if (op === 'or') {
		return childResults.some(Boolean);
	}
	// 'not': normalizeGroupNode/parseGroupNode enforce at most one child.
	return !childResults[0];
}

function summarizeGroup(op: GroupOp, childResults: readonly boolean[]): string {
	const passedCount = childResults.filter(Boolean).length;
	return `${op}: ${passedCount}/${childResults.length} enabled child(ren) passed`;
}

async function walk(
	node: FilterNode,
	instrumentId: string,
	deps: ConditionEvalDeps,
	nodeEvaluations: Record<ResourceId, FilterNodeEvaluation>,
	unavailableNodeIds: ResourceId[]
): Promise<boolean> {
	if (!node.enabled) {
		return true; // Skipped entirely; the caller never sees this node.
	}
	if (node.kind === 'condition') {
		const result = await evaluateCondition(node.condition, instrumentId, deps);
		nodeEvaluations[node.nodeId] = {
			nodeId: node.nodeId,
			passed: result.passed,
			value: result.value,
			unit: result.unit,
			detail: result.detail
		};
		if (result.dataUnavailable) {
			unavailableNodeIds.push(node.nodeId);
		}
		return result.passed;
	}
	const childResults: boolean[] = [];
	for (const child of node.children) {
		childResults.push(await walk(child, instrumentId, deps, nodeEvaluations, unavailableNodeIds));
	}
	const passed = combine(node.op, childResults);
	nodeEvaluations[node.nodeId] = {
		nodeId: node.nodeId,
		passed,
		value: null,
		detail: summarizeGroup(node.op, childResults)
	};
	return passed;
}

export async function evaluateFilterTree(
	root: FilterNode,
	instrumentId: string,
	deps: ConditionEvalDeps
): Promise<TreeEvalResult> {
	const nodeEvaluations: Record<ResourceId, FilterNodeEvaluation> = {};
	const unavailableNodeIds: ResourceId[] = [];
	const passed = await walk(root, instrumentId, deps, nodeEvaluations, unavailableNodeIds);
	return { passed, nodeEvaluations, unavailableNodeIds };
}
