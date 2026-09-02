// The `create_computed_field` tool (T-1014-2, AC1, AC2, AC5-AC11). Wire
// parsing and result shaping only -- every decision about what makes a
// field valid lives in the application layer this wraps.
import type { CatalogRegistry } from '../../../catalog/registry';
import { fail, ok } from '../../../webmcp/tools';
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
import { readComputedField, toWireComputedField } from '../domain/computedField';
import {
	CREATE_COMPUTED_FIELD_KIND,
	ensureCreateComputedFieldOperation,
	prepareCreateComputedField
} from '../application/createComputedField';

export const CREATE_COMPUTED_FIELD_TOOL_NAME = 'create_computed_field';

export interface CreateComputedFieldDeps {
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

function createComputedField(deps: CreateComputedFieldDeps) {
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
			const outcome = prepareCreateComputedField(
				{ name: input.name, expression: input.expression },
				doc,
				{ ...(deps.catalog ? { registry: deps.catalog } : {}) }
			);
			if (!outcome.ok) {
				return outcome.kind === 'expression'
					? fail(outcome.error.message, outcome.error.toWireError())
					: invalid(outcome.issues);
			}
			const envelope = applyOperations(
				[{ kind: CREATE_COMPUTED_FIELD_KIND, input: outcome.prepared }],
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
			// exactly the one id applyCreateComputedField minted.
			const fieldId = envelope.affectedIds[0] ?? '';
			const field = nextDoc ? readComputedField(nextDoc, fieldId) : null;
			return ok({
				...toWireEnvelope(envelope),
				computed_field_id: fieldId,
				computed_field: field ? toWireComputedField(field) : null
			});
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const DESCRIPTION =
	'Creates a computed field: a named, ID-addressable derived value defined by a typed ' +
	'expression tree over permitted catalog fields, studies, indicators and patterns -- never a ' +
	'string of code. The expression is validated against the catalog (unknown fields/functions, ' +
	'type/unit mismatches and cost limits are all rejected before anything is stored) and never ' +
	'evaluated as SQL, JavaScript or any other free-form text. Once created, the field is usable ' +
	'anywhere a built-in catalog field is: a results-table column, a ranking input, or a filter ' +
	"condition operand, addressed by the returned computed_field_id. A row where the field's value " +
	'cannot be determined (missing data, division by zero) reports "not available" rather than ' +
	'failing the run. Returns the mutation envelope with the new computed_field_id in affected_ids ' +
	'and an undo_token that removes it.';

export function buildCreateComputedFieldTool(deps: CreateComputedFieldDeps): ToolSpec {
	ensureCreateComputedFieldOperation(deps.registry, { clock: deps.clock });
	return {
		name: CREATE_COMPUTED_FIELD_TOOL_NAME,
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
				expected_revision: { type: 'number' },
				idempotency_key: { type: 'string' }
			},
			required: ['name', 'expression']
		},
		available: () => true,
		execute: createComputedField(deps)
	};
}
