// Bounding a ResultExplanation's size (T-1010-5, AC11): a filter tree or
// ranking configuration large enough to exceed the response bound is
// truncated with an explicit marker naming what was omitted, rather than
// silently dropped or returned unbounded. Applied strictly *after*
// explanation.ts's makeResultExplanation has already validated the
// fully-assembled, untruncated explanation -- so T-1010-3's AC7
// contribution-sum invariant is checked against the true data, not a
// partial one -- and never re-invokes that constructor itself.
//
// Domain layer: no I/O, no import from infra or from src/lib/webmcp/.

import type { FilterNodeExplanation } from './explanation';
import type { RankingExplanation } from './explanationRanking';

// Real filter trees and ranking configs observed anywhere in this codebase
// (every fixture, every test) are a handful to a few dozen nodes/fields --
// these bounds are generous relative to that, chosen so ordinary usage
// never truncates and only pathological input gets an explicit, bounded
// response instead of an unbounded one.
export const DEFAULT_MAX_FILTER_TREE_NODES = 500;
export const DEFAULT_MAX_RANKING_FIELDS = 50;

function boundNode(
	node: FilterNodeExplanation,
	budget: { remaining: number }
): FilterNodeExplanation {
	if (node.kind === 'condition') {
		return node;
	}
	const children: FilterNodeExplanation[] = [];
	let omittedChildCount = 0;
	for (const child of node.children) {
		if (budget.remaining <= 0) {
			omittedChildCount += 1;
			continue;
		}
		budget.remaining -= 1;
		children.push(boundNode(child, budget));
	}
	return omittedChildCount > 0
		? { ...node, children, truncatedChildCount: omittedChildCount }
		: { ...node, children };
}

// `maxNodes` bounds the whole tree, root included. Walks pre-order with a
// shared budget; the first group whose children would exceed the remaining
// budget has its children list cut there and gains `truncatedChildCount` --
// every node beneath an omitted child is implied-omitted by its absence, so
// no deeper marker is needed.
export function boundFilterTree(
	root: FilterNodeExplanation,
	maxNodes: number = DEFAULT_MAX_FILTER_TREE_NODES
): FilterNodeExplanation {
	const budget = { remaining: Math.max(0, maxNodes - 1) };
	return boundNode(root, budget);
}

// Slices `fields` to `maxFields`, keeping the true, untruncated
// `compositeScore` (the total stays correct; only the itemized breakdown is
// capped).
export function boundRankingExplanation(
	ranking: RankingExplanation,
	maxFields: number = DEFAULT_MAX_RANKING_FIELDS
): RankingExplanation {
	if (ranking.fields.length <= maxFields) {
		return ranking;
	}
	const omitted = ranking.fields.length - maxFields;
	return { ...ranking, fields: ranking.fields.slice(0, maxFields), truncatedFieldCount: omitted };
}
