// Similarity feature and scoring contract (EPIC-1012).
//
// The TypeScript encoding of the shared vocabulary every ticket in this epic
// reads: feature families, weight sets, feature vectors, scoring, candidates,
// explanations, runs. The Python encoding is
// backend/domain/models/similarity.py. One contract, two encodings: the two
// are not required to interoperate directly (no shared computation path
// crosses the HTTP boundary), only to each independently satisfy their own
// reconciliation guarantee (AC5).
//
// Domain layer: pure types, pure functions, no I/O.
import type { InstrumentRef, Normalization } from '../../chart/domain/instrument';
import type { MarketDataProvenance } from '../../domain/provenance';
import { toWireProvenance } from '../../domain/provenance';
import type { WireError } from '../../domain/errors';
import type { ResourceId } from '../../domain/ids';

export type { InstrumentRef, Normalization } from '../../chart/domain/instrument';
export type { MarketDataProvenance } from '../../domain/provenance';

// The six comparable feature families a similarity score decomposes into. A
// closed union, not an ad-hoc string, so a typo in a family name is a type
// error rather than a silently-ignored weight or a candidate quietly missing
// a dimension (AC1).
export type FeatureFamily =
	'price_shape' | 'volume' | 'volatility' | 'relative_strength' | 'studies' | 'pattern_structure';

export const FEATURE_FAMILIES: readonly FeatureFamily[] = [
	'price_shape',
	'volume',
	'volatility',
	'relative_strength',
	'studies',
	'pattern_structure'
];

const FEATURE_FAMILY_SET: ReadonlySet<string> = new Set(FEATURE_FAMILIES);

export function isFeatureFamily(value: unknown): value is FeatureFamily {
	return typeof value === 'string' && FEATURE_FAMILY_SET.has(value);
}

const DEFAULT_WEIGHT = 1 / FEATURE_FAMILIES.length;

// A search scope selects other instruments, other historical windows of the
// same instrument, or both -- and a run states which was applied. Added here
// as a same-epic follow-on to the Python side's own T-1012-2 addition of the
// identical field to domain/models/similarity.py's SimilarityRun; T-1012-1's
// original TS SimilarityRun had no field for it (epic Open Question 1).
export type SearchScope = 'cross_instrument' | 'same_instrument_windows' | 'both';

// A historical window a candidate or reference setup covers. Deliberately
// smaller than chart/domain/capturedSetup.ts's `SetupWindow` (no session, no
// barCount) -- a similarity candidate window is a search result, not a
// captured chart state, and does not carry fields this epic never renders.
export interface WindowRef {
	start: string;
	end: string;
	timeframe: string;
}

// Thrown, not returned, matching capturedSetup.ts's `CaptureSetupError`
// convention: a caller that ignored an invalid weight set would otherwise
// carry on with a value that violates AC10.
export class SimilarityWeightError extends Error {
	readonly field: string;

	constructor(field: string, message: string) {
		super(message);
		this.name = 'SimilarityWeightError';
		this.field = field;
	}

	toWireError(): WireError {
		return { error: 'invalid_feature_weight', message: this.message, field: this.field };
	}
}

// A plain, round-trippable value -- returned to a caller and later supplied
// back unchanged (AC2), never a stateful builder.
export type FeatureWeightSet = Readonly<Record<FeatureFamily, number>>;

// Builds a complete weight set from a caller-supplied partial one, defaulting
// every unspecified family to equal weight (epic Open Question 3).
//
// @throws {SimilarityWeightError} naming the offending entry, for an unknown
// family name, a negative weight, or a result that cannot be normalized (all
// weights zero) -- never silently coerced (AC10).
export function makeFeatureWeightSet(
	partial?: Partial<Record<string, number>> | null
): FeatureWeightSet {
	const weights = Object.fromEntries(
		FEATURE_FAMILIES.map((family) => [family, DEFAULT_WEIGHT])
	) as Record<FeatureFamily, number>;
	for (const [name, value] of Object.entries(partial ?? {})) {
		if (value === undefined) {
			continue;
		}
		if (!isFeatureFamily(name)) {
			throw new SimilarityWeightError(name, `Unknown feature family: "${name}".`);
		}
		if (value < 0) {
			throw new SimilarityWeightError(
				name,
				`Weight for "${name}" must not be negative, got ${value}.`
			);
		}
		weights[name] = value;
	}
	if (Object.values(weights).reduce((sum, w) => sum + w, 0) <= 0) {
		throw new SimilarityWeightError('*', 'Weights cannot be normalized: every weight is zero.');
	}
	return weights;
}

// One embedding per available family. A family absent from this record is
// unavailable for the setup it describes -- never present with a zero-valued
// embedding standing in for "no data".
export type FeatureVector = Partial<Record<FeatureFamily, readonly number[]>>;

export interface SimilarityScore {
	overall: number;
	perFamilySimilarity: Partial<Record<FeatureFamily, number>>;
	weightApplied: Partial<Record<FeatureFamily, number>>;
	contributions: Partial<Record<FeatureFamily, number>>;
	unavailableFamilies: FeatureFamily[];
}

// True when the per-family contributions sum to the overall score within
// `tolerance` -- the epic's central auditability guarantee (AC5), checkable
// by any reader of the response.
export function reconciles(score: SimilarityScore, tolerance = 1e-9): boolean {
	const total = Object.values(score.contributions).reduce((sum, c) => sum + (c ?? 0), 0);
	return Math.abs(total - score.overall) <= tolerance;
}

// Cosine similarity between two same-length feature embeddings, rescaled from
// [-1, 1] to [0, 1] so a family's similarity is never negative -- a merely
// dissimilar (not anti-correlated) family should not subtract from an
// otherwise-positive score when weighted and summed.
//
// @throws {Error} if the two embeddings have different, or zero, length.
export function perFamilySimilarity(
	reference: readonly number[],
	candidate: readonly number[]
): number {
	if (reference.length !== candidate.length) {
		throw new Error(
			`Reference and candidate feature vectors must have matching length, got ` +
				`${reference.length} and ${candidate.length}.`
		);
	}
	if (reference.length === 0) {
		throw new Error('Feature vectors must not be empty.');
	}
	// Lengths are already verified equal above, so this index is safe -- one
	// assertion here rather than one at every access below.
	const pairs = reference.map((r, i) => [r, candidate[i] as number] as const);
	let dot = 0;
	let refNormSq = 0;
	let candNormSq = 0;
	for (const [r, c] of pairs) {
		dot += r * c;
		refNormSq += r * r;
		candNormSq += c * c;
	}
	const refNorm = Math.sqrt(refNormSq);
	const candNorm = Math.sqrt(candNormSq);
	if (refNorm === 0 || candNorm === 0) {
		return 0;
	}
	const cosine = Math.max(-1, Math.min(1, dot / (refNorm * candNorm)));
	return (cosine + 1) / 2;
}

// Pure function of a reference feature vector, a candidate feature vector,
// and a weight set (AC6) -- no data access, no clock, no randomness, so the
// same three inputs always yield the same score and the same contributions.
//
// Families present in both vectors are scored and their weights renormalized
// over just that available subset, so a family missing from either side is
// excluded from the weighted score rather than scored as zero. The overall
// score is literally the sum of the contributions, not a separately computed
// number that happens to match -- this is what makes AC5's reconciliation
// guarantee hold by construction.
//
// @throws {Error} if no family is available in both vectors, or the
// available families carry no positive weight.
export function scoreCandidate(
	reference: FeatureVector,
	candidate: FeatureVector,
	weights: FeatureWeightSet
): SimilarityScore {
	const available = FEATURE_FAMILIES.filter(
		(family) => reference[family] !== undefined && candidate[family] !== undefined
	);
	const unavailableFamilies = FEATURE_FAMILIES.filter((family) => !available.includes(family));
	if (available.length === 0) {
		throw new Error('No feature family is available in both the reference and candidate vectors.');
	}
	const availableWeightTotal = available.reduce((sum, family) => sum + weights[family], 0);
	if (availableWeightTotal <= 0) {
		throw new Error('No positive weight among the available feature families.');
	}

	const perFamilySimilarityResult: Partial<Record<FeatureFamily, number>> = {};
	const weightApplied: Partial<Record<FeatureFamily, number>> = {};
	const contributions: Partial<Record<FeatureFamily, number>> = {};
	for (const family of available) {
		const similarity = perFamilySimilarity(
			reference[family] as readonly number[],
			candidate[family] as readonly number[]
		);
		const normalizedWeight = weights[family] / availableWeightTotal;
		perFamilySimilarityResult[family] = similarity;
		weightApplied[family] = normalizedWeight;
		contributions[family] = normalizedWeight * similarity;
	}
	const overall = Object.values(contributions).reduce((sum, c) => sum + (c ?? 0), 0);

	return {
		overall,
		perFamilySimilarity: perFamilySimilarityResult,
		weightApplied,
		contributions,
		unavailableFamilies
	};
}

export interface SimilarityCandidate {
	// A stable, run-scoped string -- never a bare ticker. Deliberately not a
	// `ResourceId` from ids.ts: extending that closed `ResourceKind` union
	// would be an edit to EPIC-1006's shared contract file, out of scope for
	// a "new files only" ticket. Grammar: `{runId}_candidate_{n}`. See this
	// ticket's Solution Approach (docs/plan/EPIC-1012/T-1012-1-*.md) for the
	// note to T-1012-2/3's implementers.
	candidateId: string;
	instrument: InstrumentRef;
	window: WindowRef;
	score: number;
	perFamilySimilarity: Partial<Record<FeatureFamily, number>>;
	unavailableFamilies: FeatureFamily[];
}

export interface SimilarityExplanation {
	candidateId: string;
	overallScore: number;
	weightApplied: Partial<Record<FeatureFamily, number>>;
	perFamilySimilarity: Partial<Record<FeatureFamily, number>>;
	contributions: Partial<Record<FeatureFamily, number>>;
	unavailableFamilies: FeatureFamily[];
}

export function explanationReconciles(
	explanation: SimilarityExplanation,
	tolerance = 1e-9
): boolean {
	const total = Object.values(explanation.contributions).reduce((sum, c) => sum + (c ?? 0), 0);
	return Math.abs(total - explanation.overallScore) <= tolerance;
}

// Builds the explanation for one candidate directly from the `SimilarityScore`
// that scored it -- the same object `scoreCandidate` returned, never
// recomputed, so an explanation can never disagree with the score it explains.
export function toExplanation(candidateId: string, score: SimilarityScore): SimilarityExplanation {
	return {
		candidateId,
		overallScore: score.overall,
		weightApplied: score.weightApplied,
		perFamilySimilarity: score.perFamilySimilarity,
		contributions: score.contributions,
		unavailableFamilies: score.unavailableFamilies
	};
}

// A pinned, identified search result (AC8): a stable run ID, the reference
// setup it came from, the weight set used, the normalization settings
// applied, the market-data provenance, and its ranked candidates.
//
// `runId` is a `ResourceId` of the existing `'run'` kind (ids.ts), minted as
// `ids.next('run', 'similarity')` at the call site that constructs a run --
// not in this ticket, which only types the field.
export interface SimilarityRun {
	runId: ResourceId;
	referenceSetupId: ResourceId;
	scope: SearchScope;
	weights: FeatureWeightSet;
	normalization: Normalization;
	provenance: MarketDataProvenance;
	candidates: SimilarityCandidate[];
	warnings: string[];
}

// ---------------------------------------------------------------------------
// Outbound wire serialization (T-1012-4/5's tool results). One snake_case
// serializer per entity, matching capturedSetup.ts's toWireCapturedSetup
// precedent of a domain-owned wire serializer rather than each tool
// hand-rolling its own.
// ---------------------------------------------------------------------------

function toWireInstrumentRef(ref: InstrumentRef): Record<string, unknown> {
	return {
		instrument_id: ref.instrumentId,
		symbol: ref.symbol,
		exchange: ref.exchange,
		asset_type: ref.assetType
	};
}

function toWireWindowRef(window: WindowRef): Record<string, unknown> {
	return { start: window.start, end: window.end, timeframe: window.timeframe };
}

function toWireNormalization(normalization: Normalization): Record<string, unknown> {
	return { mode: normalization.mode, anchor: normalization.anchor };
}

export function toWireCandidate(candidate: SimilarityCandidate): Record<string, unknown> {
	return {
		candidate_id: candidate.candidateId,
		instrument: toWireInstrumentRef(candidate.instrument),
		window: toWireWindowRef(candidate.window),
		score: candidate.score,
		per_family_similarity: candidate.perFamilySimilarity,
		unavailable_families: candidate.unavailableFamilies
	};
}

export function toWireSimilarityRun(run: SimilarityRun): Record<string, unknown> {
	return {
		run_id: run.runId,
		reference_setup_id: run.referenceSetupId,
		scope: run.scope,
		weights: run.weights,
		normalization: toWireNormalization(run.normalization),
		provenance: toWireProvenance(run.provenance),
		candidates: run.candidates.map(toWireCandidate),
		warnings: run.warnings
	};
}

export function toWireExplanation(explanation: SimilarityExplanation): Record<string, unknown> {
	return {
		candidate_id: explanation.candidateId,
		overall_score: explanation.overallScore,
		weight_applied: explanation.weightApplied,
		per_family_similarity: explanation.perFamilySimilarity,
		contributions: explanation.contributions,
		unavailable_families: explanation.unavailableFamilies
	};
}
