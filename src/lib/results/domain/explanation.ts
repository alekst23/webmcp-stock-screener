// The per-instrument result explanation (T-1010-3): the typed, auditable
// record of why one instrument matched or was rejected by a pinned screener
// run -- every filter condition's actual value and outcome, mirroring the
// filter tree's AND/OR/NOT structure, plus how each ranking field
// contributed to the instrument's score. T-1010-5 assembles a value of this
// shape from a stored ScreenerRun (run.ts's FilterNodeEvaluation and
// ScreenerMatch.rankingValues); this module owns only the shape and the pure
// helpers that make that assembly straightforward -- never the assembly
// itself, and never a read of a run, a screener, or market data.
//
// Split by concern, mirroring EPIC-1009's own conditionEvaluation.ts /
// .catalog.ts / .shared.ts split: this file owns the core shape, outcome
// resolution and the invariant-enforcing constructor; restateCondition/
// describeConditionOperator live in explanationRestatement.ts, ranking
// contribution arithmetic in explanationRanking.ts, and wire serialization
// in explanationWire.ts.
//
// Domain layer: no I/O, no import from infra (src/lib/screener/engine/*) or
// from src/lib/webmcp/. Consumes EPIC-1009's filter-tree and ranking types
// (src/lib/screener/{definition,conditions}.ts) rather than redefining them.

import type { ResourceId } from '../../workbench/domain/ids';
import type { MarketDataProvenance } from '../../workbench/domain/provenance';
import type { Revision } from '../../workbench/domain/workspace';
import type { Condition } from '../../screener/conditions';
import type { GroupOp } from '../../screener/definition';
import type { RankingExplanation } from './explanationRanking';

// ---------------------------------------------------------------------------
// Outcome vocabulary (AC4)
// ---------------------------------------------------------------------------

// A discriminated union, not a boolean plus a nullable reason: this makes
// "indeterminate without a reason" and "fail carrying a reason meant for
// indeterminate" both unrepresentable, rather than relying on callers to
// keep the two in sync by convention.
export type ConditionOutcome =
	{ status: 'pass' } | { status: 'fail' } | { status: 'indeterminate'; reason: string };

export function passOutcome(): ConditionOutcome {
	return { status: 'pass' };
}

export function failOutcome(): ConditionOutcome {
	return { status: 'fail' };
}

export function indeterminateOutcome(reason: string): ConditionOutcome {
	return { status: 'indeterminate', reason };
}

// ---------------------------------------------------------------------------
// Filter tree explanation (AC2, AC3, AC6)
// ---------------------------------------------------------------------------

export interface ActualValue {
	value: number | string | boolean;
	unit: string | null;
}

// A leaf condition node. `condition` is EPIC-1009's own typed Condition --
// already the "threshold or comparison operand" for every one of the eight
// families (AC2) -- rather than a parallel, hand-flattened shape that could
// drift from it. `operatorLabel` and `restatement` are derived from it by
// explanationRestatement.ts's pure helpers.
//
// Invariant (enforced by makeResultExplanation, not just documented): both
// `actualValue` and `outcome` are null exactly when `enabled` is false. A
// disabled condition was never evaluated (engine/tree.ts skips it entirely),
// so it has nothing to report beyond the tree shape itself (AC6) -- this is
// a third, distinct state from a genuine indeterminate outcome, never a
// fabricated one.
export interface ConditionExplanation {
	nodeId: ResourceId;
	kind: 'condition';
	enabled: boolean;
	condition: Condition;
	operatorLabel: string | null;
	restatement: string;
	actualValue: ActualValue | null;
	outcome: ConditionOutcome | null;
	// Which bar within the temporal window the event occurred on (0 = most
	// recent bar), for a `temporal` condition. Optional: the engine that
	// currently produces evaluations (engine/conditionEvaluation.ts's
	// evaluateTemporal) does not compute or expose this index today, only a
	// pass/fail signal -- this field exists so a future producer has
	// somewhere to put it, without this model fabricating a value now.
	occurredBarsAgo?: number;
}

// A group node (AND/OR/NOT). Same enabled/outcome invariant as a condition
// node. `children` recurses to arbitrary depth (AC3).
export interface GroupExplanation {
	nodeId: ResourceId;
	kind: 'group';
	op: GroupOp;
	enabled: boolean;
	children: FilterNodeExplanation[];
	outcome: ConditionOutcome | null;
	// Present (T-1010-5, AC11) when a response-size bound forced this
	// group's `children` to be cut short -- names how many trailing child
	// nodes beneath this group were omitted, rather than silently dropping
	// them or returning an unbounded tree. Absent (never present-but-zero)
	// when nothing under this group was truncated. Applied by
	// explanationBound.ts strictly after this shape has already been
	// validated by makeResultExplanation, never re-checked by it.
	truncatedChildCount?: number;
}

export type FilterNodeExplanation = ConditionExplanation | GroupExplanation;

// ---------------------------------------------------------------------------
// Group outcome resolution (AC5)
// ---------------------------------------------------------------------------

function firstIndeterminateReason(outcomes: readonly ConditionOutcome[]): string | null {
	const reasons = outcomes
		.filter(
			(outcome): outcome is Extract<ConditionOutcome, { status: 'indeterminate' }> =>
				outcome.status === 'indeterminate'
		)
		.map((outcome) => outcome.reason);
	return reasons.length > 0 ? reasons.join('; ') : null;
}

// Kleene strong three-valued logic: AND fails on any fail, else is
// indeterminate on any indeterminate, else passes; OR passes on any pass,
// else is indeterminate on any indeterminate, else fails; NOT flips
// pass/fail and passes indeterminate straight through. Zero children (every
// child disabled, or a genuinely empty group) is vacuously pass, matching
// engine/tree.ts's own empty-children rule uniformly across every op.
//
// This is a strict generalization of engine/tree.ts's boolean `combine()`:
// the two agree exactly whenever no child is indeterminate, and can only
// diverge on a child the engine's own boolean model currently collapses to
// "fail" in place of "unknown" -- this function is what lets an explanation
// say "unknown" instead of repeating that collapse (AC5).
export function resolveGroupOutcome(
	op: GroupOp,
	childOutcomes: readonly ConditionOutcome[]
): ConditionOutcome {
	if (childOutcomes.length === 0) {
		return passOutcome();
	}
	if (op === 'not') {
		// isNotArityValid guarantees a 'not' group holds at most one child, and
		// the zero-children case already returned above -- exactly one here.
		const child = childOutcomes[0] as ConditionOutcome;
		if (child.status === 'indeterminate') {
			return child;
		}
		return child.status === 'pass' ? failOutcome() : passOutcome();
	}
	const hasFail = childOutcomes.some((outcome) => outcome.status === 'fail');
	const hasPass = childOutcomes.some((outcome) => outcome.status === 'pass');
	const indeterminateReason = firstIndeterminateReason(childOutcomes);
	if (op === 'and') {
		if (hasFail) return failOutcome();
		if (indeterminateReason !== null) return indeterminateOutcome(indeterminateReason);
		return passOutcome();
	}
	// 'or'
	if (hasPass) return passOutcome();
	if (indeterminateReason !== null) return indeterminateOutcome(indeterminateReason);
	return failOutcome();
}

// ---------------------------------------------------------------------------
// Standing (AC8) and the whole explanation (AC1, AC9, AC10)
// ---------------------------------------------------------------------------

// A discriminated union rather than two independently-nullable fields, so
// "rejected but somehow ranked" is not representable.
export type ResultStanding =
	{ status: 'result'; rank: number } | { status: 'rejected'; rank: null };

export function resultStanding(rank: number): ResultStanding {
	return { status: 'result', rank };
}

export function rejectedStanding(): ResultStanding {
	return { status: 'rejected', rank: null };
}

// The whole per-instrument explanation. `provenance` is one record for the
// whole explanation (AC9), mirroring ScreenerRun.provenance's
// single-record-per-run design rather than duplicating it per value: every
// value in one pinned run shares identical provenance by construction.
export interface ResultExplanation {
	instrumentId: string;
	runId: ResourceId;
	screenerId: ResourceId;
	screenerRevision: Revision;
	filterTree: FilterNodeExplanation;
	// null when the screener had no ranking configured, or when this
	// instrument was rejected -- a rejected instrument is never ranked at
	// all (engine/engine.ts only ranks the matched set).
	ranking: RankingExplanation | null;
	standing: ResultStanding;
	provenance: MarketDataProvenance;
}

const FLOAT_EPSILON = 1e-9;

function assertNodeInvariant(node: FilterNodeExplanation, path: string): void {
	if (node.enabled && node.outcome === null) {
		throw new Error(
			`makeResultExplanation: enabled node ${path} (${node.nodeId}) must carry an outcome.`
		);
	}
	if (!node.enabled && node.outcome !== null) {
		throw new Error(
			`makeResultExplanation: disabled node ${path} (${node.nodeId}) must not carry an outcome.`
		);
	}
	if (node.kind === 'condition') {
		if (!node.enabled && node.actualValue !== null) {
			throw new Error(
				`makeResultExplanation: disabled condition ${path} (${node.nodeId}) must not carry ` +
					`an actual value.`
			);
		}
		return;
	}
	node.children.forEach((child, index) => assertNodeInvariant(child, `${path}[${index}]`));
}

// Invariant-enforcing constructor (mirrors run.ts's makeScreenerRun style --
// this is a cross-epic boundary type). Throws as a programming-error guard
// on data an assembler is expected to have already computed correctly, not
// as a typed validation result for agent-supplied input.
export function makeResultExplanation(input: ResultExplanation): ResultExplanation {
	assertNodeInvariant(input.filterTree, 'filterTree');
	if (input.standing.status === 'rejected' && input.ranking !== null) {
		throw new Error(
			'makeResultExplanation: a rejected instrument was never ranked; ranking must be null.'
		);
	}
	if (input.standing.status === 'result' && !Number.isInteger(input.standing.rank)) {
		throw new Error(
			`makeResultExplanation: a result's rank must be a positive integer, got ` +
				`${input.standing.rank}.`
		);
	}
	if (input.ranking) {
		const summedContributions = input.ranking.fields.reduce(
			(sum, field) => sum + (field.contribution ?? 0),
			0
		);
		if (Math.abs(summedContributions - input.ranking.compositeScore) > FLOAT_EPSILON) {
			throw new Error(
				`makeResultExplanation: ranking contributions sum to ${summedContributions}, but ` +
					`compositeScore is ${input.ranking.compositeScore}.`
			);
		}
	}
	return input;
}
