// define_screener's ranking payload (T-0026-1): builds a RankingSpec from
// the wire `ranking` object plus a top-level `limit` convenience field
// ("make it top 20" is one call, not a patch to a nested ranking.limit).
// Field existence and numeric-ness need the catalog registry, so -- like
// set_screener_ranking.ts, whose checks this mirrors -- that check lives
// here at the tool layer; screener/ranking.ts's validateRankingDeclaration
// (reused, not reimplemented) owns everything decidable from the
// declaration alone.

import type { CatalogRegistry } from '../../catalog/registry';
import { problem, unknownItemProblem } from '../../screener/conditionValidation.shared';
import type { RankingSpec } from '../../screener/definition';
import {
	validateRankingDeclaration,
	type RankingDeclarationInput,
	type RankingFieldInput,
	type RankingTieBreakInput
} from '../../screener/ranking';
import { PROBLEM_CODES, type ValidationProblem } from '../../screener/validation';

export interface RankingWireInput {
	fields?: unknown;
	tie_break?: unknown;
	normalization?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toDirection(value: unknown): 'asc' | 'desc' | undefined {
	return value === 'asc' || value === 'desc' ? value : undefined;
}

function toFieldInput(value: unknown): RankingFieldInput {
	const record = isRecord(value) ? value : {};
	return {
		fieldId: typeof record.field_id === 'string' ? record.field_id : '',
		direction: toDirection(record.direction),
		weight: typeof record.weight === 'number' ? record.weight : undefined
	};
}

function parseFieldsInput(raw: unknown): RankingFieldInput[] {
	return Array.isArray(raw) ? raw.map(toFieldInput) : [];
}

function parseTieBreakInput(raw: unknown): RankingTieBreakInput | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const fieldId = typeof raw.field_id === 'string' ? raw.field_id : '';
	return fieldId ? { fieldId, direction: toDirection(raw.direction) } : undefined;
}

// AC4/AC5 (set_screener_ranking's own convention, reused here): an unknown
// or non-numeric ranking field is rejected naming it, with nearest-ID
// suggestions where the registry can offer one.
function checkNumericField(registry: CatalogRegistry, fieldId: string): ValidationProblem | null {
	const item = registry.getCatalogItem(fieldId);
	if (!item) {
		return unknownItemProblem(undefined, 'ranking field', fieldId, registry);
	}
	if (item.kind !== 'field') {
		return problem(
			'blocking',
			PROBLEM_CODES.invalidParameter,
			undefined,
			`"${fieldId}" is a ${item.kind}, not a field, and cannot be used for ranking.`
		);
	}
	if (item.valueType !== 'number') {
		return problem(
			'blocking',
			PROBLEM_CODES.invalidParameter,
			undefined,
			`Ranking field "${fieldId}" is of type "${item.valueType}"; ranking requires a numeric field.`
		);
	}
	return null;
}

function checkCatalogFields(
	registry: CatalogRegistry,
	declaration: RankingDeclarationInput
): ValidationProblem[] {
	const problems: ValidationProblem[] = [];
	for (const field of declaration.fields ?? []) {
		const fieldId = field.fieldId.trim();
		if (!fieldId) {
			continue; // reported by validateRankingDeclaration's own shape check
		}
		const failure = checkNumericField(registry, fieldId);
		if (failure) {
			problems.push(failure);
		}
	}
	const tieBreakFieldId = declaration.tieBreak?.fieldId?.trim();
	if (tieBreakFieldId) {
		const failure = checkNumericField(registry, tieBreakFieldId);
		if (failure) {
			problems.push(failure);
		}
	}
	return problems;
}

function issuesToProblems(issues: string[]): ValidationProblem[] {
	return issues.map((message) =>
		problem('blocking', PROBLEM_CODES.invalidParameter, undefined, message)
	);
}

// AC2: an omitted ranking AND an omitted limit resets to "no ranking set" --
// the documented default order, matching definition.ts's `ranking: null`
// convention. A limit supplied on its own (no ranking fields) still builds
// a RankingSpec so the caller's requested cap is stored and echoed back,
// rather than being silently dropped the way set_screener_ranking's
// fields-only "clear" convention would.
export function buildRankingSpec(
	rankingRaw: unknown,
	limitRaw: unknown,
	registry: CatalogRegistry,
	problems: ValidationProblem[]
): RankingSpec | null {
	const wire = (isRecord(rankingRaw) ? rankingRaw : {}) as RankingWireInput;
	const fields = parseFieldsInput(wire.fields);
	const tieBreak = parseTieBreakInput(wire.tie_break);
	const limit = typeof limitRaw === 'number' ? limitRaw : undefined;
	const normalization = typeof wire.normalization === 'string' ? wire.normalization : undefined;

	if (fields.length === 0 && limit === undefined && !tieBreak) {
		return null;
	}

	const declaration: RankingDeclarationInput = { fields, tieBreak, limit, normalization };
	const catalogProblems = checkCatalogFields(registry, declaration);
	if (catalogProblems.length > 0) {
		problems.push(...catalogProblems);
		return null;
	}

	const validated = validateRankingDeclaration(declaration);
	if (!validated.ok) {
		problems.push(...issuesToProblems(validated.issues));
		return null;
	}
	return validated.ranking;
}
