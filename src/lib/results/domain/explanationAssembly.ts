// Assembles T-1010-3's ResultExplanation model from a pinned ScreenerRun's
// own stored data (T-1010-5). Pure domain logic: walks the *definition's*
// FilterNode tree (never the evaluation map alone, so a disabled node --
// which tree.ts never evaluates -- still appears per AC1's "none omitted"),
// looks up each enabled leaf's FilterNodeEvaluation, and recomputes a
// group's outcome via explanation.ts's own resolveGroupOutcome rather than
// trusting the group's stored boolean `passed` (which cannot represent
// indeterminate at all -- see resolveGroupOutcome's own doc comment).
//
// Domain layer: no I/O, no import from infra (screener/engine/*) or from
// src/lib/webmcp/. Consumes screener/run.ts's already-pinned data only.

import type { ResourceId } from '../../workbench/domain/ids';
import type { FilterNode, RankingField } from '../../screener/definition';
import type { FilterNodeEvaluation, ScreenerRun } from '../../screener/run';
import {
	failOutcome,
	indeterminateOutcome,
	passOutcome,
	resolveGroupOutcome,
	type ActualValue,
	type ConditionExplanation,
	type ConditionOutcome,
	type FilterNodeExplanation,
	type GroupExplanation
} from './explanation';
import { buildRankingExplanation, type RankingExplanation } from './explanationRanking';
import { describeCondition } from './explanationRestatement';

function outcomeFromEvaluation(evaluation: FilterNodeEvaluation): ConditionOutcome {
	if (evaluation.dataUnavailable) {
		return indeterminateOutcome(
			evaluation.detail ?? 'The input this condition reads was unavailable for this instrument.'
		);
	}
	return evaluation.passed ? passOutcome() : failOutcome();
}

function actualValueFrom(evaluation: FilterNodeEvaluation): ActualValue | null {
	return evaluation.value === null
		? null
		: { value: evaluation.value, unit: evaluation.unit ?? null };
}

// `ancestorEnabled` folds every ancestor group's enabled state into this
// node's effective enabled state: engine/tree.ts's walk() never recurses
// into a disabled node, so a leaf nested inside a disabled group has
// exactly as little to report as a directly-disabled leaf -- treating only
// the node's own literal `enabled` flag would claim an outcome exists for a
// node that was never actually run, violating explanation.ts's own
// documented (if not fully enforced) invariant.
function assembleNode(
	node: FilterNode,
	evaluations: Readonly<Record<ResourceId, FilterNodeEvaluation>>,
	ancestorEnabled: boolean
): FilterNodeExplanation {
	const enabled = node.enabled && ancestorEnabled;
	if (node.kind === 'condition') {
		const { restatement, operatorLabel } = describeCondition(node.condition);
		const evaluation = enabled ? evaluations[node.nodeId] : undefined;
		const base: ConditionExplanation = {
			nodeId: node.nodeId,
			kind: 'condition',
			enabled,
			condition: node.condition,
			operatorLabel,
			restatement,
			actualValue: null,
			outcome: null
		};
		if (!enabled) {
			return base;
		}
		if (!evaluation) {
			// Should not happen: the tree and the evaluations come from the same
			// pinned run. Guarded rather than assumed -- report honestly rather
			// than fabricating a pass/fail.
			return {
				...base,
				outcome: indeterminateOutcome('No evaluation was recorded for this node in the pinned run.')
			};
		}
		return {
			...base,
			actualValue: actualValueFrom(evaluation),
			outcome: outcomeFromEvaluation(evaluation)
		};
	}
	const children = node.children.map((child) => assembleNode(child, evaluations, enabled));
	const group: GroupExplanation = {
		nodeId: node.nodeId,
		kind: 'group',
		op: node.op,
		enabled,
		children,
		outcome: null
	};
	if (!enabled) {
		return group;
	}
	const childOutcomes = children
		.filter(
			(child): child is FilterNodeExplanation & { outcome: ConditionOutcome } =>
				child.outcome !== null
		)
		.map((child) => child.outcome);
	return { ...group, outcome: resolveGroupOutcome(node.op, childOutcomes) };
}

export function assembleFilterTree(
	filterTree: FilterNode,
	evaluations: Readonly<Record<ResourceId, FilterNodeEvaluation>>
): FilterNodeExplanation {
	return assembleNode(filterTree, evaluations, true);
}

// Reconstructs the exact matched-set distribution engine/ranking.ts
// normalized each field against: the returned top-N (`run.matches`) is only
// part of the matched set once truncated by the ranking limit, so a
// returned instrument's own normalized value cannot be recomputed correctly
// from `run.matches` alone -- the truncated-but-matched entries in
// `run.rejectedEvaluations` carry the rest (see RejectedCandidate in
// run.ts).
function peerValuesForField(run: ScreenerRun, fieldId: string): number[] {
	const values: number[] = [];
	for (const match of run.matches) {
		const raw = match.rankingValues[fieldId];
		if (typeof raw === 'number') values.push(raw);
	}
	for (const candidate of Object.values(run.rejectedEvaluations)) {
		const raw = candidate.rankingValues?.[fieldId];
		if (typeof raw === 'number') values.push(raw);
	}
	return values;
}

// Only called for a 'result'-standing instrument (a rejected standing,
// including a matched-but-truncated one, gets `ranking: null` per
// explanation.ts's own invariant -- makeResultExplanation rejects a
// rejected standing carrying non-null ranking).
export function assembleRanking(
	run: ScreenerRun,
	rankingValues: Record<string, number | null>
): RankingExplanation | null {
	if (!run.rankingSpec || run.rankingSpec.fields.length === 0) {
		return null;
	}
	const fields: { fieldId: string; weight: number; direction: RankingField['direction'] }[] =
		run.rankingSpec.fields;
	const peerValuesByField: Record<string, readonly number[]> = {};
	for (const field of fields) {
		peerValuesByField[field.fieldId] = peerValuesForField(run, field.fieldId);
	}
	return buildRankingExplanation(
		fields,
		rankingValues,
		peerValuesByField,
		run.rankingSpec.normalization
	);
}
