// The `edit_alert_draft` tool (T-1014-8, AC9). tool-spec.md names only
// create_alert_draft for the create half; this ships as its own small tool,
// named after edit_filter_tree's convention, because AC9 requires editing to
// exist and no other tool in this ticket's or T-1014-9's surface covers it.
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
import { readAlert, toWireAlert } from '../domain/alert';
import {
	ALERTS_EDIT_CONDITIONS_KIND,
	ensureEditAlertDraftOperation,
	prepareEditAlertDraft
} from '../application/editAlertDraft';

export const EDIT_ALERT_DRAFT_TOOL_NAME = 'edit_alert_draft';

export interface EditAlertDraftDeps {
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
	alert_id?: string;
	name?: string;
	screener_id?: string;
	conditions?: unknown;
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

function editAlertDraft(deps: EditAlertDraftDeps) {
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
			const outcome = await prepareEditAlertDraft(
				{
					alert_id: input.alert_id,
					...(input.name !== undefined ? { name: input.name } : {}),
					...(input.screener_id !== undefined ? { screener_id: input.screener_id } : {}),
					...(input.conditions !== undefined ? { conditions: input.conditions } : {})
				},
				doc,
				{ ...(deps.catalog ? { registry: deps.catalog } : {}) }
			);
			if (!outcome.ok) {
				return invalid(outcome.issues);
			}
			const envelope = applyOperations(
				[{ kind: ALERTS_EDIT_CONDITIONS_KIND, input: outcome.prepared }],
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
			const alert = nextDoc ? readAlert(nextDoc, outcome.prepared.alertId) : null;
			return ok({
				...toWireEnvelope(envelope),
				alert_id: outcome.prepared.alertId,
				alert: alert ? toWireAlert(alert) : null
			});
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const DESCRIPTION =
	'Edits an alert draft: rename it, or replace its conditions with a new screener_id snapshot or ' +
	'a new set of typed conditions (give at most one of the two; omit both to only rename). A ' +
	'draft, or an alert with a pending activation request, can be edited; editing always leaves it ' +
	'a draft -- this tool cannot arm anything. Editing an alert with a pending activation request ' +
	'invalidates that request: a fresh enable_alert call and a fresh confirmation are required to ' +
	'arm it afterward. Returns the mutation envelope with the edited alert; the undo_token restores ' +
	'the prior draft.';

export function buildEditAlertDraftTool(deps: EditAlertDraftDeps): ToolSpec {
	ensureEditAlertDraftOperation(deps.registry, { clock: deps.clock });
	return {
		name: EDIT_ALERT_DRAFT_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
				alert_id: { type: 'string' },
				name: { type: 'string' },
				screener_id: { type: 'string' },
				conditions: { type: 'array', items: { type: 'object' } },
				expected_revision: { type: 'number' },
				idempotency_key: { type: 'string' }
			},
			required: ['alert_id']
		},
		available: () => true,
		execute: editAlertDraft(deps)
	};
}
