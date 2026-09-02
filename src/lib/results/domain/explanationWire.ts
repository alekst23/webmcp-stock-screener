// Wire serialization for ResultExplanation (T-1010-3): kept as its own
// module, mirroring run.ts's toWireScreenerRun convention of keeping
// serialization alongside the domain shape it serializes -- pure data
// shaping, no I/O, so T-1010-5's use case does not have to invent wire
// shaping of its own.
//
// Domain layer: no I/O, no import from infra or from src/lib/webmcp/.

import { toWireProvenance } from '../../workbench/domain/provenance';
import type {
	ActualValue,
	ConditionOutcome,
	FilterNodeExplanation,
	ResultExplanation
} from './explanation';
import type { RankingExplanation, RankingFieldContribution } from './explanationRanking';

function withoutUndefined<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function toWireOutcome(outcome: ConditionOutcome | null): Record<string, unknown> | null {
	if (outcome === null) return null;
	if (outcome.status === 'indeterminate') {
		return { status: outcome.status, reason: outcome.reason };
	}
	return { status: outcome.status };
}

function toWireActualValue(actualValue: ActualValue | null): Record<string, unknown> | null {
	if (actualValue === null) return null;
	return { value: actualValue.value, unit: actualValue.unit };
}

function toWireFilterNodeExplanation(node: FilterNodeExplanation): Record<string, unknown> {
	if (node.kind === 'condition') {
		return withoutUndefined({
			node_id: node.nodeId,
			kind: node.kind,
			enabled: node.enabled,
			condition: node.condition,
			operator_label: node.operatorLabel,
			restatement: node.restatement,
			actual_value: toWireActualValue(node.actualValue),
			outcome: toWireOutcome(node.outcome),
			occurred_bars_ago: node.occurredBarsAgo
		});
	}
	return withoutUndefined({
		node_id: node.nodeId,
		kind: node.kind,
		op: node.op,
		enabled: node.enabled,
		outcome: toWireOutcome(node.outcome),
		children: node.children.map(toWireFilterNodeExplanation),
		truncated_child_count: node.truncatedChildCount
	});
}

function toWireRankingFieldContribution(field: RankingFieldContribution): Record<string, unknown> {
	return {
		field_id: field.fieldId,
		raw_value: field.rawValue,
		normalized_value: field.normalizedValue,
		weight: field.weight,
		direction: field.direction,
		contribution: field.contribution
	};
}

function toWireRankingExplanation(ranking: RankingExplanation): Record<string, unknown> {
	return withoutUndefined({
		fields: ranking.fields.map(toWireRankingFieldContribution),
		normalization: ranking.normalization,
		composite_score: ranking.compositeScore,
		truncated_field_count: ranking.truncatedFieldCount
	});
}

export function toWireResultExplanation(explanation: ResultExplanation): Record<string, unknown> {
	return {
		instrument_id: explanation.instrumentId,
		run_id: explanation.runId,
		screener_id: explanation.screenerId,
		screener_revision: explanation.screenerRevision,
		filter_tree: toWireFilterNodeExplanation(explanation.filterTree),
		ranking: explanation.ranking ? toWireRankingExplanation(explanation.ranking) : null,
		standing: { status: explanation.standing.status, rank: explanation.standing.rank },
		provenance: toWireProvenance(explanation.provenance)
	};
}
