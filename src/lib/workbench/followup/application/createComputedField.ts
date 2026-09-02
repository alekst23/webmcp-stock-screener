// The `followup.create_computed_field` operation (T-1014-2, AC1, AC2, AC5-
// AC11). Mirrors alerts/application/createAlertDraft.ts's shape: a
// synchronous `prepareCreateComputedField` (no async data source needed --
// unlike alert preview, expression validation is pure) resolves and
// validates the expression before the tool calls `applyOperations`; the
// registered operation's `apply()` is then a pure, synchronous write.
import type { CatalogRegistry } from '../../../catalog/registry';
import type { IdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { MutationDraft } from '../../application/revisionService';
import {
	findComputedFieldByName,
	writeComputedField,
	type ComputedFieldRecord
} from '../domain/computedField';
import type { ExpressionValidationError } from '../domain/expressionErrors';
import { validateExpression } from '../domain/expressionValidator';
import type { ValidatedExpression } from '../domain/expressionModel';
import { mintComputedFieldId } from '../domain/followupIds';
import { composeWorkspaceCatalogRegistry } from '../domain/workspaceCatalog';

export const CREATE_COMPUTED_FIELD_KIND = 'followup.create_computed_field';

export interface CreateComputedFieldInput {
	name: string;
	expression: ValidatedExpression;
}

function nameIssues(name: unknown): string[] {
	return typeof name === 'string' && name.trim().length > 0
		? []
		: ['name: expected a non-empty string.'];
}

// AC11: a name collision is rejected explicitly, naming the existing
// field's id, rather than silently creating a second field under the same
// name or overwriting the first.
function collisionIssues(name: string, doc: WorkspaceDocument): string[] {
	const existing = findComputedFieldByName(doc, name);
	return existing
		? [
				`name: "${name}" is already used by computed field "${existing.id}". Choose a ` +
					'different name, or use the existing field.'
			]
		: [];
}

// Re-derives the structural half of what prepareCreateComputedField already
// checked, over the already-resolved input -- a caller reaching the
// registry directly (bypassing the tool's prepare step) cannot store a
// field this workspace would not accept.
function validateCreateComputedField(
	input: CreateComputedFieldInput,
	doc: WorkspaceDocument
): string[] {
	return [...nameIssues(input.name), ...collisionIssues(input.name, doc)];
}

function applyCreateComputedField(
	input: CreateComputedFieldInput,
	doc: WorkspaceDocument,
	ids: IdSequencer,
	now: string
): MutationDraft {
	const fieldId = mintComputedFieldId(ids);
	const record: ComputedFieldRecord = {
		id: fieldId,
		workspaceId: doc.id,
		name: input.name,
		expression: input.expression,
		createdAt: now,
		updatedAt: now
	};
	const nextDoc = writeComputedField(doc, record);
	return {
		document: nextDoc,
		affectedIds: [fieldId],
		diffSummary: `Created computed field ${fieldId} ("${input.name}"), type ${input.expression.resultType}.`,
		// A create only ever adds one map entry, so the pre-create document is
		// exactly its own inverse (AC10's base case) -- reference-consistency
		// beyond that is changeHistory.ts's existing "undo only targets the
		// newest change" rule, not something this operation needs to know
		// about.
		inverse: {
			document: doc,
			affectedIds: [fieldId],
			diffSummary: `Removed computed field ${fieldId}.`
		}
	};
}

export function createCreateComputedFieldOperation(deps: {
	clock: Clock;
}): OperationDefinition<CreateComputedFieldInput> {
	return {
		kind: CREATE_COMPUTED_FIELD_KIND,
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				expression: { type: 'object' }
			},
			required: ['name', 'expression']
		},
		validate: validateCreateComputedField,
		describe: (input) => `Create computed field "${input.name}" (${input.expression.resultType}).`,
		apply: (input, doc, ids) => applyCreateComputedField(input, doc, ids, deps.clock.now())
	};
}

export function ensureCreateComputedFieldOperation(
	registry: OperationRegistry,
	deps: { clock: Clock }
): void {
	if (!registry.get(CREATE_COMPUTED_FIELD_KIND)) {
		registry.register(createCreateComputedFieldOperation(deps));
	}
}

export interface PrepareCreateComputedFieldOutcome {
	ok: true;
	prepared: CreateComputedFieldInput;
}

export type PrepareCreateComputedFieldFailure =
	| { ok: false; kind: 'issues'; issues: string[] }
	| { ok: false; kind: 'expression'; error: ExpressionValidationError };

// The validation half: resolves the workspace-composed catalog and runs
// T-1014-1's validateExpression unchanged (AC5, AC6, AC7 inherited
// verbatim). A malformed body (a string, an array, free-form text of any
// kind) fails structurally before any node is ever evaluated -- see
// expressionValidator.ts's isPlainObject guard.
export function prepareCreateComputedField(
	rawInput: { name: unknown; expression: unknown },
	doc: WorkspaceDocument,
	options?: { registry?: CatalogRegistry }
): PrepareCreateComputedFieldOutcome | PrepareCreateComputedFieldFailure {
	// Collision-checking deliberately lives only in validateCreateComputedField
	// (run inside applyOperations -> revisionService.commit's mutate, which an
	// idempotency-key replay never re-enters) -- not here. A repeated request
	// under the same idempotency_key must resolve as a replay (AC9), not as a
	// "name already used by the record that request itself created" rejection
	// (AC11); collision-checking pre-applyOperations would see the first
	// call's own effect and reject the second, defeating replay.
	const nameCheck = nameIssues(rawInput.name);
	if (nameCheck.length > 0) {
		return { ok: false, kind: 'issues', issues: nameCheck };
	}
	const registry = options?.registry ?? composeWorkspaceCatalogRegistry(doc);
	const result = validateExpression(rawInput.expression, registry);
	if (!result.valid) {
		return { ok: false, kind: 'expression', error: result.error };
	}
	return {
		ok: true,
		prepared: { name: (rawInput.name as string).trim(), expression: result.expression }
	};
}
