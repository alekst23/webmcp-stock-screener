// The `enable_alert` tool (T-1014-9 AC1, AC6, AC7, AC11). Wire parsing and
// result shaping only, wrapping the `alerts.enable_activation` operation.
// This tool NEVER arms an alert -- see application/enableAlert.ts's header
// comment -- and the response says so explicitly on every call (AC1),
// whether it is the first request or a re-request after expiry.
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
	ALERTS_ENABLE_ACTIVATION_KIND,
	ensureEnableAlertOperation
} from '../application/enableAlert';

export const ENABLE_ALERT_TOOL_NAME = 'enable_alert';

export interface EnableAlertDeps {
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

const NOT_ARMED_MESSAGE =
	'Not armed. This only records a pending activation request; a human must confirm it in the ' +
	"app's alerts surface -- an explicit confirm or decline gesture the app performs, never a tool " +
	'call -- before the alert can arm and fire.';

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

function enableAlert(deps: EnableAlertDeps) {
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
			return invalid(['alert_id: expected the stable ID of an alert draft.']);
		}
		try {
			const envelope = applyOperations(
				[{ kind: ALERTS_ENABLE_ACTIVATION_KIND, input: { alertId: input.alert_id } }],
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
				alert: alert ? toWireAlert(alert) : null,
				armed: false,
				message: NOT_ARMED_MESSAGE
			});
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const DESCRIPTION =
	'Requests activation for an alert draft. This does NOT arm the alert: it records a pending ' +
	"activation request that a human must explicitly confirm or decline in the app's own alerts " +
	'surface. No tool call, undo, or replay can arm an alert -- only that in-app confirmation can. ' +
	'The response always states plainly that the alert is not armed. Editing the underlying draft ' +
	'while a request is pending invalidates it, requiring a fresh enable_alert call and a fresh ' +
	'confirmation. A pending request also expires after a bounded time and must be re-requested. ' +
	'Returns the mutation envelope; the undo_token clears the pending request (never a path to ' +
	'arming).';

export function buildEnableAlertTool(deps: EnableAlertDeps): ToolSpec {
	ensureEnableAlertOperation(deps.registry, { clock: deps.clock });
	return {
		name: ENABLE_ALERT_TOOL_NAME,
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
		execute: enableAlert(deps)
	};
}
