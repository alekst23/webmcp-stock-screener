// Ranking field contribution arithmetic (T-1010-3 AC7): pure port of
// engine/ranking.ts's normalize()/directedContribution() math (domain
// cannot import that infra file). Kept formula-identical -- including
// percentile_rank's tie handling, z_score's population-variance stddev,
// min_max's degenerate-range fallback to 0.5, and the 'asc' direction
// inversion rule -- so that recomputing from a pinned run's own
// `rankingValues` plus its `RankingSpec` reproduces the run's actual
// `compositeScore`.
//
// Domain layer: no I/O, no import from infra or from src/lib/webmcp/.

import type { RankingNormalization } from '../../screener/definition';

export interface RankingFieldContribution {
	fieldId: string;
	// null when the field's raw value was unavailable for this instrument --
	// distinct from a genuine zero, matching engine/ranking.ts's
	// "unavailable field contributes nothing to the composite score" rule.
	rawValue: number | null;
	normalizedValue: number | null;
	weight: number;
	direction: 'asc' | 'desc';
	contribution: number | null;
}

// compositeScore is always a number here (never null): the RankingExplanation
// object being present at all already signals ranking applied to this
// instrument (see ResultExplanation.ranking in explanation.ts for the null
// case).
export interface RankingExplanation {
	fields: RankingFieldContribution[];
	normalization: RankingNormalization;
	compositeScore: number;
	// Present (T-1010-5, AC11) when a response-size bound cut `fields` short.
	// `compositeScore` always stays the true, untruncated total -- only the
	// per-field itemization is capped -- which is why applying this bound
	// must happen after, and independently of, makeResultExplanation's
	// contribution-sum invariant check (explanationBound.ts never re-invokes
	// it). Absent (never present-but-zero) when nothing was truncated.
	truncatedFieldCount?: number;
}

function percentileRank(values: readonly number[], value: number): number {
	let below = 0;
	let equal = 0;
	for (const other of values) {
		if (other < value) below++;
		else if (other === value) equal++;
	}
	return (below + equal / 2) / values.length;
}

function zScore(values: readonly number[], value: number): number {
	const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
	const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
	const stddev = Math.sqrt(variance);
	return stddev === 0 ? 0 : (value - mean) / stddev;
}

function minMax(values: readonly number[], value: number): number {
	const min = Math.min(...values);
	const max = Math.max(...values);
	return max === min ? 0.5 : (value - min) / (max - min);
}

function normalize(method: RankingNormalization, values: readonly number[], value: number): number {
	if (method === 'z_score') return zScore(values, value);
	if (method === 'min_max') return minMax(values, value);
	return percentileRank(values, value);
}

// A field's 'asc' direction (lower raw value is better) inverts its
// normalized contribution so a higher composite score always means
// "better", regardless of any individual field's direction -- matching
// engine/ranking.ts's directedContribution exactly.
function directedContribution(
	method: RankingNormalization,
	normalized: number,
	direction: 'asc' | 'desc'
): number {
	if (direction === 'desc') return normalized;
	return method === 'z_score' ? -normalized : 1 - normalized;
}

// `peerValues` is the matched set's raw values for this one field --
// callers are expected to include the instrument's own rawValue among them,
// matching engine/ranking.ts's `available` array (normalization is always
// relative to the full comparison set, itself included).
export function computeRankingFieldContribution(
	rawValue: number | null,
	peerValues: readonly number[],
	field: { fieldId: string; weight: number; direction: 'asc' | 'desc' },
	normalization: RankingNormalization
): RankingFieldContribution {
	if (rawValue === null) {
		return {
			fieldId: field.fieldId,
			rawValue: null,
			normalizedValue: null,
			weight: field.weight,
			direction: field.direction,
			contribution: null
		};
	}
	const normalizedValue = normalize(normalization, peerValues, rawValue);
	const contribution =
		field.weight * directedContribution(normalization, normalizedValue, field.direction);
	return {
		fieldId: field.fieldId,
		rawValue,
		normalizedValue,
		weight: field.weight,
		direction: field.direction,
		contribution
	};
}

// Builds every field's contribution and the composite score in one pass, so
// a caller (T-1010-5) never has to re-derive the "sum with no base term"
// combination rule engine/ranking.ts's computeComposite uses.
export function buildRankingExplanation(
	fields: readonly { fieldId: string; weight: number; direction: 'asc' | 'desc' }[],
	rawByField: Readonly<Record<string, number | null>>,
	peerValuesByField: Readonly<Record<string, readonly number[]>>,
	normalization: RankingNormalization
): RankingExplanation {
	const contributions = fields.map((field) =>
		computeRankingFieldContribution(
			rawByField[field.fieldId] ?? null,
			peerValuesByField[field.fieldId] ?? [],
			field,
			normalization
		)
	);
	const compositeScore = contributions.reduce((sum, field) => sum + (field.contribution ?? 0), 0);
	return { fields: contributions, normalization, compositeScore };
}
