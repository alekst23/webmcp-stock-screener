// Weight refinement from accepted/rejected matches (T-1014-4). Domain
// layer: pure construction and arithmetic, no I/O -- the application layer
// supplies the source run's weights and candidates; this module never reads
// a workspace, calls the similarity API, or knows about panels.
//
// The rule is deliberately transparent rather than an optimizer: each
// weight moves toward the accepted matches' measured strength on that
// family and away from the rejected matches' measured strength, bounded so
// one refinement can never swing a weight far on a handful of examples.
// Every value it produces is traceable to the arithmetic that produced it,
// which is what makes AC2 ("every weight that changed, before and after")
// auditable rather than asserted.
import type { WireError } from '../../../domain/errors';
import {
	FEATURE_FAMILIES,
	makeFeatureWeightSet,
	type FeatureFamily,
	type FeatureWeightSet
} from '../../domain/contract';

// Bounds how far a single refinement can move any one weight -- small
// feedback sets (the common case: a researcher marking a handful of
// matches) overfit easily, so a refinement nudges rather than snaps to
// whatever the sample says.
const MAX_STEP = 0.15;

// Below this many total judgments, the feedback set is smaller than the
// number of dimensions it is adjusting -- worth a warning, not a refusal.
const MIN_CONFIDENT_JUDGMENTS = FEATURE_FAMILIES.length;

export interface WeightChange {
	feature: FeatureFamily;
	before: number;
	after: number;
}

export type SimilarityRefinementErrorReason =
	'feedback_required' | 'conflicting_match' | 'unknown_match';

// Thrown, not returned: a caller that ignored a validation failure would
// otherwise carry on and adjust weights or run a search from feedback that
// was never actually valid (AC4, AC6, AC7).
export class SimilarityRefinementError extends Error {
	readonly reason: SimilarityRefinementErrorReason;
	readonly matchIds: string[];

	constructor(reason: SimilarityRefinementErrorReason, message: string, matchIds: string[] = []) {
		super(message);
		this.name = 'SimilarityRefinementError';
		this.reason = reason;
		this.matchIds = matchIds;
	}

	toWireError(): WireError {
		return {
			error: `similarity_refinement_${this.reason}`,
			message: this.message,
			reason: this.reason,
			match_ids: this.matchIds
		};
	}
}

// Validates the feedback set on its own terms, before anything else about
// a refinement runs -- AC4/AC6/AC7 all require that a rejected call leaves
// weights untouched and issues no search, which only holds if this throws
// before any of that starts.
//
// @throws {SimilarityRefinementError} `feedback_required` when both lists
// are empty, `conflicting_match` naming any id marked both accepted and
// rejected, or `unknown_match` naming any id absent from
// `knownCandidateIds`.
export function validateFeedback(
	acceptedIds: readonly string[],
	rejectedIds: readonly string[],
	knownCandidateIds: ReadonlySet<string>
): void {
	if (acceptedIds.length === 0 && rejectedIds.length === 0) {
		throw new SimilarityRefinementError(
			'feedback_required',
			'Refinement requires at least one accepted or rejected match -- neither was given.'
		);
	}
	const acceptedSet = new Set(acceptedIds);
	const conflicting = [...new Set(rejectedIds.filter((id) => acceptedSet.has(id)))];
	if (conflicting.length > 0) {
		throw new SimilarityRefinementError(
			'conflicting_match',
			`Match(es) marked both accepted and rejected: ${conflicting.join(', ')}.`,
			conflicting
		);
	}
	const unknown = [
		...new Set([...acceptedIds, ...rejectedIds].filter((id) => !knownCandidateIds.has(id)))
	];
	if (unknown.length > 0) {
		throw new SimilarityRefinementError(
			'unknown_match',
			`Match ID(s) do not belong to this search: ${unknown.join(', ')}.`,
			unknown
		);
	}
}

// The mean of each family's measured similarity across a set of matches --
// a family absent from every vector in the set is simply absent from the
// result, never treated as a measured zero.
function averageByFamily(
	vectors: readonly Partial<Record<FeatureFamily, number>>[]
): Partial<Record<FeatureFamily, number>> {
	const sums: Partial<Record<FeatureFamily, number>> = {};
	const counts: Partial<Record<FeatureFamily, number>> = {};
	for (const vector of vectors) {
		for (const family of FEATURE_FAMILIES) {
			const value = vector[family];
			if (value === undefined) {
				continue;
			}
			sums[family] = (sums[family] ?? 0) + value;
			counts[family] = (counts[family] ?? 0) + 1;
		}
	}
	const averages: Partial<Record<FeatureFamily, number>> = {};
	for (const family of FEATURE_FAMILIES) {
		const count = counts[family];
		if (count) {
			averages[family] = (sums[family] as number) / count;
		}
	}
	return averages;
}

export interface RefinementOutcome {
	weights: FeatureWeightSet;
	changes: WeightChange[];
	warnings: string[];
}

// Pure function of a weight set and two sets of measured per-family
// similarities. Never reads a run, never calls the search API -- the
// application layer supplies the vectors and re-searches with the result.
//
// @throws {SimilarityWeightError} if the adjustment would leave every
// weight at zero (propagated from `makeFeatureWeightSet`, not
// re-implemented here).
export function refineWeights(
	currentWeights: FeatureWeightSet,
	acceptedVectors: readonly Partial<Record<FeatureFamily, number>>[],
	rejectedVectors: readonly Partial<Record<FeatureFamily, number>>[]
): RefinementOutcome {
	const acceptedAvg = averageByFamily(acceptedVectors);
	const rejectedAvg = averageByFamily(rejectedVectors);
	const adjusted: Record<FeatureFamily, number> = { ...currentWeights };
	const changes: WeightChange[] = [];
	const warnings: string[] = [];

	for (const family of FEATURE_FAMILIES) {
		const delta = (acceptedAvg[family] ?? 0) - (rejectedAvg[family] ?? 0);
		if (delta === 0) {
			continue;
		}
		const before = currentWeights[family];
		const raw = before + MAX_STEP * delta;
		const after = Math.max(0, raw);
		if (after !== raw) {
			warnings.push(
				`Weight for "${family}" would have gone below its declared minimum (0); clamped to 0.`
			);
		}
		if (after !== before) {
			adjusted[family] = after;
			changes.push({ feature: family, before, after });
		}
	}

	if (acceptedVectors.length === 0 && rejectedVectors.length > 0) {
		warnings.push(
			'Refinement is one-sided: only rejected matches were supplied, so weights moved away from ' +
				'the rejected matches’ distinguishing features with no accepted matches to confirm the direction.'
		);
	}

	const judgmentCount = acceptedVectors.length + rejectedVectors.length;
	if (judgmentCount < MIN_CONFIDENT_JUDGMENTS) {
		warnings.push(
			`Refined from ${judgmentCount} judged match(es) against ${FEATURE_FAMILIES.length} feature ` +
				'families -- a small feedback set like this overfits easily.'
		);
	}

	// Reused, not re-implemented: the contract's own guard against negative
	// or all-zero weights is what actually enforces "stays inside the
	// declared valid bounds" (AC8) for this function's output.
	return { weights: makeFeatureWeightSet(adjusted), changes, warnings };
}

export function toWireWeightChange(change: WeightChange): Record<string, unknown> {
	return { feature: change.feature, before: change.before, after: change.after };
}
