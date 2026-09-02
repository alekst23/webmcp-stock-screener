// Applying a RankingSpec to a matched instrument set (T-1009-7 AC5, AC6,
// AC7, AC8): reads each ranking field's raw value, normalizes it within the
// matched set, combines by weight and direction into a composite score, and
// orders the result deterministically. This module does not decide *which*
// instruments matched (tree.ts) or how many are returned (engine.ts applies
// the result limit) -- it only orders and scores.
//
// Infra layer: implements evaluation behind the domain port (ports.ts);
// domain code does not import this file.

import { DEFAULT_RANKING_LIMIT } from '../ranking';
import type { RankingField, RankingSpec } from '../definition';
import type { ScreenerMarketData } from '../ports';

export interface RankedInstrument {
	instrumentId: string;
	compositeScore: number | null;
	rankingValues: Record<string, number | null>;
}

export interface RankingOutcome {
	ranked: RankedInstrument[];
	rankingApplied: boolean;
	normalization: string | null;
	limit: number;
	// field ids with at least one unavailable (null) raw value somewhere in
	// the matched set -- feeds engine.ts's AC11 warning.
	unavailableFieldIds: string[];
}

// No ranking set: instrument ID ascending is the documented, deterministic
// default order (AC6) -- stable across repeated runs (AC7) without needing
// any market-data read.
function defaultOrder(instrumentIds: readonly string[]): RankingOutcome {
	const ranked = [...instrumentIds]
		.sort((a, b) => a.localeCompare(b))
		.map((instrumentId) => ({ instrumentId, compositeScore: null, rankingValues: {} }));
	return {
		ranked,
		rankingApplied: false,
		normalization: null,
		limit: DEFAULT_RANKING_LIMIT,
		unavailableFieldIds: []
	};
}

async function readFieldValues(
	instrumentIds: readonly string[],
	fieldId: string,
	marketData: ScreenerMarketData
): Promise<Map<string, number | null>> {
	const values = new Map<string, number | null>();
	for (const instrumentId of instrumentIds) {
		const raw = await marketData.getFieldValue(instrumentId, fieldId);
		values.set(instrumentId, typeof raw === 'number' ? raw : null);
	}
	return values;
}

// percentile_rank: (count strictly below + half the ties) / n -- lands in
// [0, 1] and is well-defined even for n === 1 (yields 0.5, "no comparison
// possible"), so it needs no special-cased n===1 branch.
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

function normalize(
	method: RankingSpec['normalization'],
	values: readonly number[],
	value: number
): number {
	if (method === 'z_score') return zScore(values, value);
	if (method === 'min_max') return minMax(values, value);
	return percentileRank(values, value);
}

// A field's 'asc' direction (lower raw value is better) inverts its
// normalized contribution so a higher composite score always means
// "better", regardless of any individual field's direction.
function directedContribution(
	method: RankingSpec['normalization'],
	normalized: number,
	direction: 'asc' | 'desc'
): number {
	if (direction === 'desc') return normalized;
	return method === 'z_score' ? -normalized : 1 - normalized;
}

interface FieldNormalization {
	field: RankingField;
	rawByInstrument: Map<string, number | null>;
}

async function loadFieldNormalizations(
	instrumentIds: readonly string[],
	fields: readonly RankingField[],
	marketData: ScreenerMarketData
): Promise<FieldNormalization[]> {
	const result: FieldNormalization[] = [];
	for (const field of fields) {
		result.push({
			field,
			rawByInstrument: await readFieldValues(instrumentIds, field.fieldId, marketData)
		});
	}
	return result;
}

function computeComposite(
	instrumentId: string,
	normalizations: readonly FieldNormalization[],
	method: RankingSpec['normalization'],
	unavailableFieldIds: Set<string>
): { compositeScore: number; rankingValues: Record<string, number | null> } {
	const rankingValues: Record<string, number | null> = {};
	let compositeScore = 0;
	for (const { field, rawByInstrument } of normalizations) {
		const raw = rawByInstrument.get(instrumentId) ?? null;
		rankingValues[field.fieldId] = raw;
		if (raw === null) {
			unavailableFieldIds.add(field.fieldId);
			continue;
		}
		const available = [...rawByInstrument.values()].filter((v): v is number => v !== null);
		const normalized = normalize(method, available, raw);
		compositeScore += field.weight * directedContribution(method, normalized, field.direction);
	}
	return { compositeScore, rankingValues };
}

function orderRanked(
	ranked: readonly RankedInstrument[],
	tieBreakValues: Map<string, number | null> | null,
	tieBreakDirection: 'asc' | 'desc'
): RankedInstrument[] {
	return [...ranked].sort((a, b) => {
		const scoreDiff = (b.compositeScore ?? 0) - (a.compositeScore ?? 0);
		if (scoreDiff !== 0) return scoreDiff;
		if (tieBreakValues) {
			const av = tieBreakValues.get(a.instrumentId);
			const bv = tieBreakValues.get(b.instrumentId);
			if (av !== null && av !== undefined && bv !== null && bv !== undefined && av !== bv) {
				return tieBreakDirection === 'asc' ? av - bv : bv - av;
			}
		}
		// Final, always-decisive tiebreaker so repeated runs over the same
		// data produce the same order (AC7).
		return a.instrumentId.localeCompare(b.instrumentId);
	});
}

export async function applyRanking(
	instrumentIds: readonly string[],
	ranking: RankingSpec | null,
	marketData: ScreenerMarketData
): Promise<RankingOutcome> {
	if (ranking === null || ranking.fields.length === 0) {
		return defaultOrder(instrumentIds);
	}
	const unavailableFieldIds = new Set<string>();
	const normalizations = await loadFieldNormalizations(instrumentIds, ranking.fields, marketData);
	const ranked = instrumentIds.map((instrumentId) => {
		const { compositeScore, rankingValues } = computeComposite(
			instrumentId,
			normalizations,
			ranking.normalization,
			unavailableFieldIds
		);
		return { instrumentId, compositeScore, rankingValues };
	});

	let tieBreakValues: Map<string, number | null> | null = null;
	let tieBreakDirection: 'asc' | 'desc' = 'desc';
	if (ranking.tieBreak) {
		tieBreakValues = await readFieldValues(instrumentIds, ranking.tieBreak.fieldId, marketData);
		tieBreakDirection = ranking.tieBreak.direction;
	}

	return {
		ranked: orderRanked(ranked, tieBreakValues, tieBreakDirection),
		rankingApplied: true,
		normalization: ranking.normalization,
		limit: ranking.limit,
		unavailableFieldIds: [...unavailableFieldIds]
	};
}
