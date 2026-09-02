// `set_screener_ranking` (T-1009-5): declares how a screener's matches are
// ordered -- by one or more weighted fields, a tie-break, and a result
// limit -- or clears the ranking back to the documented default order.
// Stores and validates the declaration only; T-1009-7's evaluation engine
// is what actually orders matches by it.
//
// API layer: field existence and numeric-ness are checked here against the
// catalog registry (screener/ranking.ts is pure and does not import it);
// everything else routes through EPIC-1006's RevisionService.commit via
// recordCommit, the program's single write path.

import { builtinCatalogRegistry, type CatalogRegistry } from '../../catalog/registry';
import type { CatalogItem } from '../../catalog/types';
import type { RankingSpec } from '../../screener/definition';
import {
	isClearRankingInput,
	validateRankingDeclaration,
	type RankingDeclarationInput,
	type RankingFieldInput,
	type RankingTieBreakInput
} from '../../screener/ranking';
import { readScreener, writeScreener } from '../../screener/state';
import { recordCommit } from '../../workbench/application/changeHistory';
import { OperationValidationError } from '../../workbench/domain/errors';
import { toWireEnvelope } from '../../workbench/domain/mutation';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import { fail, ok } from '../tools';
import type { ToolResult, ToolSpec } from '../types';
import {
	readOptionalNumber,
	readOptionalString,
	readString,
	resolveWorkspaceId,
	toErrorResult
} from './support';

const DESCRIPTION =
	"Sets how a screener's matches are ordered: one field, or several weighted fields " +
	'combined into a composite score after percentile-rank (or a declared alternative) ' +
	'normalization makes their differing units comparable; an optional tie-break field ' +
	'and direction; and a result limit. Every value is echoed back exactly as stored. ' +
	'Omit "fields" (or pass an empty array) to clear the ranking, which leaves the ' +
	'screener in the documented "no ranking set" state -- a run then reports ' +
	'ranking_applied: false and uses the default order. Every field named must be a ' +
	'known, numeric catalog field; an unknown or non-numeric field is rejected naming ' +
	'it, and the previously stored ranking is left unchanged. Accepts expected_revision ' +
	'and idempotency_key and returns the mutation envelope with an undo token.';

const RANKING_FIELD_SCHEMA = {
	type: 'object',
	properties: {
		field_id: { type: 'string', description: 'A numeric catalog field ID, e.g. "field.volume".' },
		direction: { type: 'string', enum: ['asc', 'desc'] },
		weight: { type: 'number', description: 'Defaults to 1. Ignored when ranking by one field.' }
	},
	required: ['field_id']
};

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		screener_id: { type: 'string' },
		fields: {
			type: 'array',
			items: RANKING_FIELD_SCHEMA,
			description: 'Omit or pass [] to clear the ranking.'
		},
		tie_break: {
			type: 'object',
			properties: {
				field_id: { type: 'string' },
				direction: { type: 'string', enum: ['asc', 'desc'] }
			},
			required: ['field_id']
		},
		limit: { type: 'integer', minimum: 1, description: 'Maximum matches a run returns.' },
		normalization: {
			type: 'string',
			enum: ['percentile_rank', 'z_score', 'min_max'],
			description:
				'How differing units are made comparable before weighting. Defaults to percentile_rank.'
		},
		expected_revision: { type: 'number' },
		idempotency_key: { type: 'string' }
	},
	required: ['screener_id']
};

interface RawInput {
	workspace_id?: unknown;
	screener_id?: unknown;
	fields?: unknown;
	tie_break?: unknown;
	limit?: unknown;
	normalization?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
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

// undefined (key absent) and null both mean "clear" (see
// ranking.ts's isClearRankingInput); an array -- even an empty one --
// carries through so a malformed entry still produces a validation issue
// rather than silently vanishing.
function parseFieldsInput(raw: unknown): RankingFieldInput[] | null | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (raw === null) {
		return null;
	}
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.map(toFieldInput);
}

function parseTieBreakInput(raw: unknown): RankingTieBreakInput | null | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (raw === null) {
		return null;
	}
	const record = isRecord(raw) ? raw : {};
	return {
		fieldId: typeof record.field_id === 'string' ? record.field_id : '',
		direction: toDirection(record.direction)
	};
}

function parseDeclaration(input: RawInput): RankingDeclarationInput {
	return {
		fields: parseFieldsInput(input.fields),
		tieBreak: parseTieBreakInput(input.tie_break),
		limit: typeof input.limit === 'number' ? input.limit : undefined,
		normalization: typeof input.normalization === 'string' ? input.normalization : undefined
	};
}

interface FieldCheckFailure {
	fieldId: string;
	message: string;
	suggestions: string[];
}

// AC5: a ranking field not in the catalog is rejected naming it, with
// nearest-ID suggestions so a near-miss is correctable in one turn (the
// convention search_catalog/describe_catalog_item already use). Also
// enforces the design point that a ranking field must be numeric --
// ordering by a string or enum field has no defined meaning.
function checkNumericField(registry: CatalogRegistry, fieldId: string): FieldCheckFailure | null {
	const item: CatalogItem | undefined = registry.getCatalogItem(fieldId);
	if (!item) {
		return {
			fieldId,
			message: `Unknown ranking field: "${fieldId}".`,
			suggestions: registry.suggestCatalogIds(fieldId)
		};
	}
	if (item.kind !== 'field') {
		return {
			fieldId,
			message: `"${fieldId}" is a ${item.kind}, not a field, and cannot be used for ranking.`,
			suggestions: []
		};
	}
	if (item.valueType !== 'number') {
		return {
			fieldId,
			message:
				`Ranking field "${fieldId}" is of type "${item.valueType}"; ranking requires a ` +
				'numeric field.',
			suggestions: []
		};
	}
	return null;
}

// Every named field_id -- ranking fields and the tie-break -- is checked
// against the catalog before any structural validation runs, so a call
// naming both an unknown field and a bad limit still reports the unknown
// field (the more specific, self-correcting problem).
function checkCatalogFields(
	registry: CatalogRegistry,
	declaration: RankingDeclarationInput
): { issues: string[]; suggestions: Record<string, string[]> } {
	const issues: string[] = [];
	const suggestions: Record<string, string[]> = {};

	for (const field of declaration.fields ?? []) {
		const fieldId = field.fieldId.trim();
		if (!fieldId) {
			continue; // reported by validateRankingDeclaration's own shape check
		}
		const failure = checkNumericField(registry, fieldId);
		if (failure) {
			issues.push(failure.message);
			suggestions[fieldId] = failure.suggestions;
		}
	}

	const tieBreakFieldId = declaration.tieBreak?.fieldId?.trim();
	if (declaration.tieBreak && !tieBreakFieldId) {
		issues.push('tie_break requires a non-empty field_id.');
	} else if (tieBreakFieldId) {
		const failure = checkNumericField(registry, tieBreakFieldId);
		if (failure) {
			issues.push(failure.message);
			suggestions[tieBreakFieldId] = failure.suggestions;
		}
	}

	return { issues, suggestions };
}

function toWireRanking(ranking: RankingSpec | null): Record<string, unknown> | null {
	if (!ranking) {
		return null;
	}
	return {
		fields: ranking.fields.map((field) => ({
			field_id: field.fieldId,
			direction: field.direction,
			weight: field.weight
		})),
		tie_break: ranking.tieBreak
			? { field_id: ranking.tieBreak.fieldId, direction: ranking.tieBreak.direction }
			: null,
		limit: ranking.limit,
		normalization: ranking.normalization
	};
}

function historyDeps(deps: WorkbenchDeps) {
	return { history: deps.history, revisionService: deps.revisions, clock: deps.clock };
}

async function execute(
	deps: WorkbenchDeps,
	registry: CatalogRegistry,
	rawInput: unknown
): Promise<ToolResult> {
	const input = (rawInput ?? {}) as RawInput;

	const workspaceId = resolveWorkspaceId(deps, input);
	if (!workspaceId) {
		return fail('No active workspace.', { error: 'not_found' });
	}
	const doc = deps.repository.get(workspaceId);
	if (!doc) {
		return fail(`Workspace not found: ${workspaceId}`, { error: 'not_found' });
	}

	const screenerId = readString(input.screener_id);
	if (!screenerId) {
		return fail('set_screener_ranking requires a non-empty "screener_id".', {
			error: 'invalid_input'
		});
	}
	if (!readScreener(doc, screenerId)) {
		return fail(`Screener not found: ${screenerId}`, { error: 'not_found', screenerId });
	}

	const declaration = parseDeclaration(input);
	let nextRanking: RankingSpec | null;

	if (isClearRankingInput(declaration)) {
		nextRanking = null;
	} else {
		const { issues: catalogIssues, suggestions } = checkCatalogFields(registry, declaration);
		if (catalogIssues.length > 0) {
			const message = catalogIssues.join(' ');
			// `error` is the machine code and must not be clobbered by the human
			// message -- fail()'s extra object is spread over `{ error: message }`,
			// so the message has to be carried under its own `message` key here,
			// matching WireError's convention (workbench/domain/errors.ts).
			return fail(message, {
				error: 'unknown_catalog_item',
				message,
				issues: catalogIssues,
				suggestions
			});
		}

		const validated = validateRankingDeclaration(declaration);
		if (!validated.ok) {
			const message = validated.issues.join(' ');
			return fail(message, {
				error: 'operation_validation_error',
				message,
				issues: validated.issues
			});
		}
		nextRanking = validated.ranking;
	}

	try {
		const envelope = recordCommit(historyDeps(deps), {
			workspaceId,
			context: {
				expectedRevision: readOptionalNumber(input.expected_revision),
				idempotencyKey: readOptionalString(input.idempotency_key),
				actor: 'agent'
			},
			operationKind: 'screener.set_screener_ranking',
			requestInput: { screenerId, ranking: nextRanking },
			mutate: (currentDoc) => {
				const screener = readScreener(currentDoc, screenerId);
				if (!screener) {
					throw new OperationValidationError([`Screener not found: ${screenerId}`]);
				}
				// The screener's own revision (definition.ts's ScreenerDefinition.revision)
				// advances here; RevisionService.commit separately advances
				// WorkspaceDocument.revision, the one expected_revision checks --
				// two independent counters, per technical.md.
				const updatedScreener = {
					...screener,
					ranking: nextRanking,
					revision: screener.revision + 1
				};
				const nextDoc = writeScreener(currentDoc, updatedScreener);
				return {
					document: nextDoc,
					affectedIds: [screenerId],
					diffSummary: nextRanking
						? `Set ranking on screener ${screenerId} (${nextRanking.fields.length} field(s), ` +
							`limit ${nextRanking.limit}, ${nextRanking.normalization}).`
						: `Cleared ranking on screener ${screenerId}.`,
					inverse: {
						document: { ...currentDoc },
						affectedIds: [screenerId],
						diffSummary: `Reverted the ranking change on screener ${screenerId}.`
					}
				};
			}
		});

		const resultDoc = deps.repository.get(workspaceId);
		const resultScreener = resultDoc ? readScreener(resultDoc, screenerId) : null;
		return ok({
			...toWireEnvelope(envelope),
			screener_id: screenerId,
			screener_revision: resultScreener?.revision ?? null,
			ranking: toWireRanking(resultScreener?.ranking ?? null)
		});
	} catch (err) {
		return toErrorResult(err);
	}
}

// `registry` defaults to the built-in catalog, matching
// webmcp/discovery/group.ts's pattern -- a parameter, not a module-level
// import inside the handler, so a test can drive this tool against a small
// fixed inventory.
export function createSetScreenerRankingTool(
	deps: WorkbenchDeps,
	registry: CatalogRegistry = builtinCatalogRegistry
): ToolSpec {
	return {
		name: 'set_screener_ranking',
		description: DESCRIPTION,
		inputSchema: INPUT_SCHEMA,
		available: () => true,
		execute: (input) => execute(deps, registry, input)
	};
}
