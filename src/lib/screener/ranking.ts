// Validation and normalization of a ranking declaration (T-1009-5): the
// rules a `set_screener_ranking` call must satisfy before its declaration
// is stored on a screener. Field existence against the catalog and the
// numeric-type check are the tool layer's job -- they need the catalog
// registry, which this module deliberately does not import (this module is
// pure and takes only what the caller already typed in). This module owns
// everything decidable from the declaration alone: shape, the result limit,
// and whether the weights can be normalized into a composite score. Shaped
// so T-1009-7's evaluation engine can consume the resulting RankingSpec
// without re-deriving any of these rules itself.
//
// Domain layer: no I/O, no import from src/lib/webmcp/.

import {
	DEFAULT_RANKING_NORMALIZATION,
	RANKING_NORMALIZATIONS,
	type RankingField,
	type RankingNormalization,
	type RankingSpec,
	type RankingTieBreak
} from './definition';

export const DEFAULT_RANKING_LIMIT = 100;

export interface RankingFieldInput {
	fieldId: string;
	direction?: 'asc' | 'desc';
	weight?: number;
}

export interface RankingTieBreakInput {
	fieldId: string;
	direction?: 'asc' | 'desc';
}

// The already-parsed (camelCase) shape of a caller's declaration, before
// field existence is checked. An absent or empty `fields` is the AC7
// "clear the ranking" signal -- see `isClearRankingInput`.
export interface RankingDeclarationInput {
	fields?: RankingFieldInput[] | null;
	tieBreak?: RankingTieBreakInput | null;
	limit?: number;
	normalization?: string;
}

export type RankingValidationResult =
	{ ok: true; ranking: RankingSpec } | { ok: false; issues: string[] };

function isPositiveInteger(value: number): boolean {
	return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

// AC6: weights that are all zero, all negative, or non-finite give the
// composite score no fixed point to scale from, so they cannot be
// normalized. A single-field ranking's implicit weight of 1 always passes.
export function canNormalizeWeights(fields: readonly RankingField[]): boolean {
	if (fields.length === 0) {
		return true; // nothing to normalize -- not this function's problem
	}
	if (fields.some((field) => !Number.isFinite(field.weight))) {
		return false;
	}
	return fields.some((field) => field.weight > 0);
}

// AC7: an input naming no ranking fields clears the ranking rather than
// being validated as an (empty, meaningless) ranking -- the caller signals
// "no ranking" the same way the stored state represents it: nothing there.
export function isClearRankingInput(input: RankingDeclarationInput): boolean {
	return !input.fields || input.fields.length === 0;
}

function normalizeDirection(value: unknown): 'asc' | 'desc' {
	return value === 'asc' ? 'asc' : 'desc';
}

function buildField(input: RankingFieldInput, issues: string[]): RankingField | null {
	const fieldId = input.fieldId?.trim();
	if (!fieldId) {
		issues.push('Each ranking field requires a non-empty field_id.');
		return null;
	}
	const weight = input.weight ?? 1;
	if (!Number.isFinite(weight)) {
		issues.push(
			`Ranking field "${fieldId}" has a non-finite weight: ${JSON.stringify(input.weight)}.`
		);
		return null;
	}
	return { fieldId, direction: normalizeDirection(input.direction), weight };
}

function buildTieBreak(input: RankingTieBreakInput | null | undefined): RankingTieBreak | null {
	const fieldId = input?.fieldId?.trim();
	if (!fieldId) {
		return null;
	}
	return { fieldId, direction: normalizeDirection(input?.direction) };
}

function resolveNormalization(value: string | undefined): RankingNormalization {
	if (value === undefined) {
		return DEFAULT_RANKING_NORMALIZATION;
	}
	return (RANKING_NORMALIZATIONS as readonly string[]).includes(value)
		? (value as RankingNormalization)
		: DEFAULT_RANKING_NORMALIZATION;
}

// Validates and builds a RankingSpec from an already-parsed declaration.
// Never called for a clearing input (see `isClearRankingInput`) -- callers
// route that case straight to `ranking: null` without invoking this.
// Does not check field existence or numeric-ness against the catalog
// (AC5): that requires the catalog registry, which lives at the tool
// layer. Call this only after the caller has confirmed every named
// field_id names a known, numeric field.
export function validateRankingDeclaration(
	input: RankingDeclarationInput
): RankingValidationResult {
	const issues: string[] = [];
	const fields: RankingField[] = [];
	for (const raw of input.fields ?? []) {
		const field = buildField(raw, issues);
		if (field) {
			fields.push(field);
		}
	}
	if (issues.length > 0) {
		return { ok: false, issues };
	}

	if (!canNormalizeWeights(fields)) {
		return {
			ok: false,
			issues: [
				'Ranking weights cannot be normalized into a composite score: at least one field ' +
					'must carry a finite, positive weight.'
			]
		};
	}

	const requestedLimit = input.limit ?? DEFAULT_RANKING_LIMIT;
	if (!isPositiveInteger(requestedLimit)) {
		return {
			ok: false,
			issues: [`Ranking limit must be a positive integer; received ${JSON.stringify(input.limit)}.`]
		};
	}

	return {
		ok: true,
		ranking: {
			fields,
			tieBreak: buildTieBreak(input.tieBreak),
			limit: requestedLimit,
			normalization: resolveNormalization(input.normalization)
		}
	};
}
