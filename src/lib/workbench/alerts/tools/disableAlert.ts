// The `disable_alert` tool (T-1014-9 AC8, AC9, AC11). Wire parsing and
// result shaping only, wrapping the `alerts.disable_activation` operation.
// Unlike enable_alert, this needs no human confirmation: disarming only
// ever reduces what an agent can cause.
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
import { readAlert, toWireAlert } from '../domain/alert';
import {
	ALERTS_DISABLE_ACTIVATION_KIND,
	ensureDisableAlertOperation
} from '../application/disableAlert';

export const DISABLE_ALERT_TOOL_NAME = 'disable_alert';

export interface DisableAlertDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	clock: Clock;
	ids: IdSequencer;
}

interface WireInput {
	workspace_id?: string;
	alert_id?: string;
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

function disableAlert(deps: DisableAlertDeps) {
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
		if (typeof input.alert_id !== 'string' || input.alert_id.length === 0) {
			return invalid(['alert_id: expected the stable ID of an alert.']);
		}
		try {
			const envelope = applyOperations(
				[{ kind: ALERTS_DISABLE_ACTIVATION_KIND, input: { alertId: input.alert_id } }],
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
			const alert = nextDoc ? readAlert(nextDoc, input.alert_id) : null;
			return ok({
				...toWireEnvelope(envelope),
				alert_id: input.alert_id,
				alert: alert ? toWireAlert(alert) : null
			});
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const DESCRIPTION =
	'Disarms an alert immediately, with no human confirmation required -- disarming only ever ' +
	'reduces what an agent can cause. Calling it on an already-disarmed alert succeeds without ' +
	'error and leaves it disarmed. Calling it on a draft or a pending activation request is ' +
	'rejected: disable_alert only applies to an alert that is (or was) armed. Returns the mutation ' +
	"envelope; the undo_token is always null -- disabling can never be undone through this tool, " +
	'so an agent can never use undo to work back toward armed.';

export function buildDisableAlertTool(deps: DisableAlertDeps): ToolSpec {
	ensureDisableAlertOperation(deps.registry, { clock: deps.clock });
	return {
		name: DISABLE_ALERT_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
				alert_id: { type: 'string' },
				expected_revision: { type: 'number' },
				idempotency_key: { type: 'string' }
			},
			required: ['alert_id']
		},
		available: () => true,
		execute: disableAlert(deps)
	};
}
