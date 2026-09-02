// Pure presentation logic for the `similar_opportunities` panel (T-1012-6).
//
// No I/O, no Svelte -- this is what the panel test suite exercises directly,
// per this project's convention of unit-testing the logic and leaving
// rendered-in-browser verification to ticket close.
import type {
	FeatureFamily,
	FeatureWeightSet,
	MarketDataProvenance,
	Normalization,
	SimilarityCandidate,
	SimilarityRun
} from '../../domain/contract';

const DEFAULT_TOP_FAMILIES = 3;

// Defensive, not trust-the-caller: a run's candidates are supposed to already
// be ranked (T-1012-2 AC3), but AC1 is this panel's own guarantee, so it sorts
// again rather than assuming the input is already in order.
export function rankCandidates(run: SimilarityRun): SimilarityCandidate[] {
	return [...run.candidates].sort((a, b) => b.score - a.score);
}

// The families that drove a candidate's score the most, for display only --
// weight * measured similarity, over only the families available for this
// candidate. This is an estimate for a compact panel row, not a reconciling
// breakdown; that is `explain_similarity`'s job (T-1012-5), not this panel's.
export function topContributingFamilies(
	candidate: SimilarityCandidate,
	weights: FeatureWeightSet,
	limit = DEFAULT_TOP_FAMILIES
): FeatureFamily[] {
	const available = Object.keys(candidate.perFamilySimilarity) as FeatureFamily[];
	return available
		.map((family) => ({
			family,
			estimate: weights[family] * (candidate.perFamilySimilarity[family] ?? 0)
		}))
		.sort((a, b) => b.estimate - a.estimate)
		.slice(0, limit)
		.map((entry) => entry.family);
}

// null candidates never render (AC2) -- true only when every family is
// unavailable, which score_candidate's construction (T-1012-1) never
// actually produces for a scored candidate, but a defensively-empty
// perFamilySimilarity is still handled rather than assumed impossible.
export function hasFeatureContext(candidate: SimilarityCandidate): boolean {
	return Object.keys(candidate.perFamilySimilarity).length > 0;
}

// Distinguishes "the run came back with nothing" (AC6, carries the run's own
// warning text) from "no run is bound to this panel yet" -- the caller must
// tell the two apart itself; this only formats the first case's message.
export function emptyRunMessage(run: SimilarityRun): string | null {
	if (run.candidates.length > 0) {
		return null;
	}
	return run.warnings.length > 0
		? run.warnings.join(' ')
		: 'No candidates matched this search, and no reason was given.';
}

function formatLiveness(provenance: MarketDataProvenance): string {
	if (provenance.liveness === 'delayed') {
		return `delayed by ${provenance.delaySeconds}s`;
	}
	return provenance.liveness;
}

// One line per fact, in the order the tool-spec's provenance rule lists them,
// so a reader can check every required field is actually present (AC3) -- not
// a single dense sentence a reader would have to parse to verify completeness.
export function formatProvenance(provenance: MarketDataProvenance): string[] {
	const lines = [
		`As of ${provenance.asOf}`,
		`Source: ${provenance.sourceLabel}`,
		`Status: ${formatLiveness(provenance)}`,
		`Timezone: ${provenance.timezone}`
	];
	if (provenance.currency !== undefined) {
		lines.push(`Currency: ${provenance.currency}`);
	}
	if (provenance.priceAdjustment !== undefined) {
		lines.push(`Price basis: ${provenance.priceAdjustment}`);
	}
	lines.push(`Engine: ${provenance.engineVersion}`);
	return lines;
}

export function formatNormalization(normalization: Normalization): string {
	return `${normalization.mode} (anchored at ${normalization.anchor})`;
}

export function formatScore(score: number): string {
	return `${Math.round(score * 100)}%`;
}
