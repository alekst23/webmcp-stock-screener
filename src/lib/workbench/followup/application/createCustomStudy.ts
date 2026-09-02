// The `followup.create_custom_study` operation (T-1014-2, AC3, AC4, AC5-
// AC11). Same three-phase shape as createComputedField.ts, plus resolving
// the declared parameter bindings against the validated expression
// (customStudyParameters.ts#resolveParameterDeclarations) before anything
// is stored.
import type { CatalogRegistry } from '../../../catalog/registry';
import type { IdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { MutationDraft } from '../../application/revisionService';
import {
	findCustomStudyByName,
	writeCustomStudy,
	type CustomStudyRecord
} from '../domain/customStudy';
import {
	resolveParameterDeclarations,
	type RawParameterDeclaration
} from '../domain/customStudyParameters';
import type { ExpressionValidationError } from '../domain/expressionErrors';
import { validateExpression } from '../domain/expressionValidator';
import type { ValidatedExpression } from '../domain/expressionModel';
import { mintCustomStudyId } from '../domain/followupIds';
import { composeWorkspaceCatalogRegistry } from '../domain/workspaceCatalog';

export const CREATE_CUSTOM_STUDY_KIND = 'followup.create_custom_study';

export interface CreateCustomStudyInput {
	name: string;
	expression: ValidatedExpression;
	parameters: CustomStudyRecord['parameters'];
	catalogParameters: CustomStudyRecord['catalogParameters'];
}

function nameIssues(name: unknown): string[] {
	return typeof name === 'string' && name.trim().length > 0
		? []
		: ['name: expected a non-empty string.'];
}

// AC11, same discipline as create_computed_field: an explicit rejection
// naming the collision, never a silent overwrite or an ambiguous duplicate.
function collisionIssues(name: string, doc: WorkspaceDocument): string[] {
	const existing = findCustomStudyByName(doc, name);
	return existing
		? [
				`name: "${name}" is already used by custom study "${existing.id}". Choose a different ` +
					'name, or use the existing study.'
			]
		: [];
}

function validateCreateCustomStudy(
	input: CreateCustomStudyInput,
	doc: WorkspaceDocument
): string[] {
	return [...nameIssues(input.name), ...collisionIssues(input.name, doc)];
}

function applyCreateCustomStudy(
	input: CreateCustomStudyInput,
	doc: WorkspaceDocument,
	ids: IdSequencer,
	now: string
): MutationDraft {
	const studyId = mintCustomStudyId(ids);
	const record: CustomStudyRecord = {
		id: studyId,
		workspaceId: doc.id,
		name: input.name,
		expression: input.expression,
		parameters: input.parameters,
		catalogParameters: input.catalogParameters,
		createdAt: now,
		updatedAt: now
	};
	const nextDoc = writeCustomStudy(doc, record);
	return {
		document: nextDoc,
		affectedIds: [studyId],
		diffSummary: `Created custom study ${studyId} ("${input.name}"), ${input.parameters.length} parameter(s).`,
		inverse: {
			document: doc,
			affectedIds: [studyId],
			diffSummary: `Removed custom study ${studyId}.`
		}
	};
}

export function createCreateCustomStudyOperation(deps: {
	clock: Clock;
}): OperationDefinition<CreateCustomStudyInput> {
	return {
		kind: CREATE_CUSTOM_STUDY_KIND,
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				expression: { type: 'object' },
				parameters: { type: 'array' }
			},
			required: ['name', 'expression']
		},
		validate: validateCreateCustomStudy,
		describe: (input) => `Create custom study "${input.name}" (${input.expression.resultType}).`,
		apply: (input, doc, ids) => applyCreateCustomStudy(input, doc, ids, deps.clock.now())
	};
}

export function ensureCreateCustomStudyOperation(
	registry: OperationRegistry,
	deps: { clock: Clock }
): void {
	if (!registry.get(CREATE_CUSTOM_STUDY_KIND)) {
		registry.register(createCreateCustomStudyOperation(deps));
	}
}

export interface PrepareCreateCustomStudyOutcome {
	ok: true;
	prepared: CreateCustomStudyInput;
}

export type PrepareCreateCustomStudyFailure =
	| { ok: false; kind: 'issues'; issues: string[] }
	| { ok: false; kind: 'expression'; error: ExpressionValidationError };

function normalizeRawParameters(value: unknown): RawParameterDeclaration[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter(
		(item): item is RawParameterDeclaration =>
			typeof item === 'object' &&
			item !== null &&
			typeof (item as RawParameterDeclaration).name === 'string' &&
			typeof (item as RawParameterDeclaration).nodePath === 'string' &&
			typeof (item as RawParameterDeclaration).argName === 'string'
	);
}

// The validation half: expression first (AC5-AC7, inherited verbatim from
// T-1014-1), then the declared parameter bindings against the now-validated
// tree (AC3). Either failure mode is reported before anything is stored.
export function prepareCreateCustomStudy(
	rawInput: { name: unknown; expression: unknown; parameters?: unknown },
	doc: WorkspaceDocument,
	options?: { registry?: CatalogRegistry }
): PrepareCreateCustomStudyOutcome | PrepareCreateCustomStudyFailure {
	// Collision-checking deliberately lives only in validateCreateCustomStudy
	// (run inside applyOperations -> revisionService.commit's mutate, skipped
	// entirely on an idempotency-key replay) -- not here. See
	// createComputedField.ts's identical note for why: pre-applyOperations
	// collision-checking would see a replay's own prior effect and reject the
	// second call, defeating AC9's replay guarantee.
	const nameCheck = nameIssues(rawInput.name);
	if (nameCheck.length > 0) {
		return { ok: false, kind: 'issues', issues: nameCheck };
	}
	const registry = options?.registry ?? composeWorkspaceCatalogRegistry(doc);
	const result = validateExpression(rawInput.expression, registry);
	if (!result.valid) {
		return { ok: false, kind: 'expression', error: result.error };
	}
	const declarations = normalizeRawParameters(rawInput.parameters);
	if (
		declarations.length !== (Array.isArray(rawInput.parameters) ? rawInput.parameters.length : 0)
	) {
		return {
			ok: false,
			kind: 'issues',
			issues: ['parameters: each entry must be an object with name, nodePath and argName.']
		};
	}
	const resolved = resolveParameterDeclarations(declarations, result.expression, registry);
	if (!resolved.ok) {
		return { ok: false, kind: 'issues', issues: resolved.issues };
	}
	return {
		ok: true,
		prepared: {
			name: (rawInput.name as string).trim(),
			expression: result.expression,
			parameters: resolved.parameters,
			catalogParameters: resolved.catalogParameters
		}
	};
}
