// The `create_custom_study` tool (T-1014-2, AC3, AC4, AC5-AC11). Wire
// parsing and result shaping only, mirroring tools/createComputedField.ts.
import type { CatalogRegistry } from '../../../catalog/registry';
import { fail, ok } from '../../../webmcp/toolResult';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import {
	IdempotencyConflictError,
	OperationValidationError,
	RevisionConflictError,
	StorageWriteError,
	UndoTokenError
} from '../../domain/errors';
import type { IdSequencer } from '../../domain/ids';
import { toWireEnvelope } from '../../domain/mutation';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { ChangeHistory } from '../../application/changeHistory';
import { applyOperations } from '../../application/operationRegistry';
import type { OperationRegistry } from '../../application/operationRegistry';
import type { RevisionService } from '../../application/revisionService';
import { readCustomStudy, toWireCustomStudy } from '../domain/customStudy';
import {
	CREATE_CUSTOM_STUDY_KIND,
	ensureCreateCustomStudyOperation,
	prepareCreateCustomStudy
} from '../application/createCustomStudy';

export const CREATE_CUSTOM_STUDY_TOOL_NAME = 'create_custom_study';

export interface CreateCustomStudyDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	clock: Clock;
	ids: IdSequencer;
	catalog?: CatalogRegistry;
}

interface WireInput {
	workspace_id?: string;
	name?: string;
	expression?: unknown;
	parameters?: unknown;
	expected_revision?: number;
	idempotency_key?: string;
}

function toErrorResult(err: unknown): ToolResult {
	if (
		err instanceof RevisionConflictError ||
		err instanceof IdempotencyConflictError ||
		err instanceof UndoTokenError ||
		err instanceof OperationValidationError ||
		err instanceof StorageWriteError
	) {
		return fail(err.message, err.toWireError());
	}
	return fail(err instanceof Error ? err.message : String(err));
}

function notFound(message: string): ToolResult {
	return fail(message, { error: 'not_found', message });
}

function invalid(issues: string[]): ToolResult {
	const message = issues.join('; ');
	return fail(message, { error: 'invalid_request', message, issues });
}

function createCustomStudy(deps: CreateCustomStudyDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as WireInput;
		const workspaceId = input.workspace_id ?? deps.repository.getActiveId();
		if (!workspaceId) {
			return notFound('No active workspace.');
		}
		const doc = deps.repository.get(workspaceId);
		if (!doc) {
			return notFound(`Workspace "${workspaceId}" was not found.`);
		}
		try {
			const outcome = prepareCreateCustomStudy(
				{ name: input.name, expression: input.expression, parameters: input.parameters },
				doc,
				{ ...(deps.catalog ? { registry: deps.catalog } : {}) }
			);
			if (!outcome.ok) {
				return outcome.kind === 'expression'
					? fail(outcome.error.message, outcome.error.toWireError())
					: invalid(outcome.issues);
			}
			const envelope = applyOperations(
				[{ kind: CREATE_CUSTOM_STUDY_KIND, input: outcome.prepared }],
				{
					expectedRevision: input.expected_revision,
					idempotencyKey: input.idempotency_key,
					actor: 'agent'
				},
				{
					registry: deps.registry,
					workspaceId,
					history: deps.history,
					revisionService: deps.revisions,
					clock: deps.clock,
					ids: deps.ids
				}
			);
			const nextDoc = deps.repository.get(workspaceId);
			// applyOperations ran exactly one operation, so affectedIds carries
			// exactly the one id applyCreateCustomStudy minted.
			const studyId = envelope.affectedIds[0] ?? '';
			const study = nextDoc ? readCustomStudy(nextDoc, studyId) : null;
			return ok({
				...toWireEnvelope(envelope),
				custom_study_id: studyId,
				custom_study: study ? toWireCustomStudy(study) : null
			});
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const DESCRIPTION =
	'Creates a custom study: a named, ID-addressable study defined by a typed expression tree over ' +
	'permitted catalog series and functions -- never a string of code -- plus declared parameters ' +
	'with defaults and valid ranges. The expression and every declared parameter are validated ' +
	'against the catalog before anything is stored (unknown fields/functions/arguments, type/unit ' +
	'mismatches, out-of-range parameters and cost limits are all rejected) and never evaluated as ' +
	'SQL, JavaScript or any other free-form text. Once created, the study appears in the catalog, ' +
	'describing its parameters, ranges, defaults, outputs and units the same way a built-in study ' +
	'does, and can be added to a chart or used in a study-output filter condition, addressed by ' +
	'the returned custom_study_id. Returns the mutation envelope with the new custom_study_id in ' +
	'affected_ids and an undo_token that removes it.';

export function buildCreateCustomStudyTool(deps: CreateCustomStudyDeps): ToolSpec {
	ensureCreateCustomStudyOperation(deps.registry, { clock: deps.clock });
	return {
		name: CREATE_CUSTOM_STUDY_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
				name: { type: 'string' },
				expression: {
					type: 'object',
					description: 'A T-1014-1 typed expression tree: {kind, ...}, never a string of code.'
				},
				parameters: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							nodePath: {
								type: 'string',
								description: 'Dotted path to a function_call node, e.g. "root" or "root.left".'
							},
							argName: { type: 'string' },
							range: {
								type: 'object',
								properties: { min: { type: 'number' }, max: { type: 'number' } }
							}
						},
						required: ['name', 'nodePath', 'argName']
					},
					description:
						"Optional. Each entry exposes one function_call argument as the study's own " +
						'named, overridable parameter; its default is whatever literal the expression ' +
						'already carries there.'
				},
				expected_revision: { type: 'number' },
				idempotency_key: { type: 'string' }
			},
			required: ['name', 'expression']
		},
		available: () => true,
		execute: createCustomStudy(deps)
	};
}
