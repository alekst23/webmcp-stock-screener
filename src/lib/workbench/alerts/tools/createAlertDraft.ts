// The `create_alert_draft` tool (T-1014-8, AC1-3, AC11). Wire parsing and
// result shaping only -- every decision about what makes a draft valid, or
// previewable, lives in the application layer this wraps.
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
import { isResourceId, type IdSequencer } from '../../domain/ids';
import { toWireEnvelope } from '../../domain/mutation';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { ChangeHistory } from '../../application/changeHistory';
import { applyOperations } from '../../application/operationRegistry';
import type { OperationRegistry } from '../../application/operationRegistry';
import type { RevisionService } from '../../application/revisionService';
import { readAlert, toWireAlert } from '../domain/alert';
import {
	ALERTS_CREATE_DRAFT_KIND,
	ensureCreateAlertDraftOperation,
	prepareCreateAlertDraft
} from '../application/createAlertDraft';

export const CREATE_ALERT_DRAFT_TOOL_NAME = 'create_alert_draft';

export interface CreateAlertDraftDeps {
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

function createAlertDraft(deps: CreateAlertDraftDeps) {
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
			const outcome = await prepareCreateAlertDraft(
				{
					name: input.name,
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
				[{ kind: ALERTS_CREATE_DRAFT_KIND, input: outcome.prepared }],
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
			const alertId = envelope.affectedIds.find((id) => isResourceId(id, 'alert')) ?? '';
			const alert = nextDoc ? readAlert(nextDoc, alertId) : null;
			return ok({
				...toWireEnvelope(envelope),
				alert_id: alertId,
				alert: alert ? toWireAlert(alert) : null
			});
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const DESCRIPTION =
	'Creates an alert draft: a named, ID-addressable description of what would fire and on what ' +
	"conditions, in the draft state. Accepts either screener_id (a snapshot of that screener's " +
	'current filter tree and universe is frozen onto the draft) or conditions (a set of EPIC-1009 ' +
	'typed conditions, ANDed together) -- exactly one of the two. A draft is inert: it evaluates ' +
	'nothing, fires nothing, and emits no notification. It cannot be armed by this or any other ' +
	"tool call; only a human, in the app's own alerts surface, can arm an alert. Use preview_alert " +
	'to see what it would have fired on. Returns the mutation envelope with the new alert_id in ' +
	'affected_ids and an undo_token that discards the draft.';

export function buildCreateAlertDraftTool(deps: CreateAlertDraftDeps): ToolSpec {
	ensureCreateAlertDraftOperation(deps.registry, { clock: deps.clock });
	return {
		name: CREATE_ALERT_DRAFT_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
				name: { type: 'string' },
				screener_id: {
					type: 'string',
					description:
						'A screener whose current filter tree and universe are frozen onto the draft.'
				},
				conditions: {
					type: 'array',
					items: { type: 'object' },
					description: 'A set of typed conditions (EPIC-1009 model), ANDed together.'
				},
				expected_revision: { type: 'number' },
				idempotency_key: { type: 'string' }
			},
			required: ['name']
		},
		available: () => true,
		execute: createAlertDraft(deps)
	};
}
