// The seven Context, Workspace and Persistence tools (T-1006-8) -- the
// wiring ticket and the composition root sibling epics plug their own
// build<Area>Tools(deps) into. Exposes the infrastructure T-1006-1..7
// built over the existing ToolSpec/ToolResult contract
// (src/lib/webmcp/types.ts), alongside -- never modifying -- the shipping
// 11-tool surface.
import { fail, ok } from '../../webmcp/tools';
import type { ToolResult, ToolSpec } from '../../webmcp/types';
import {
	IdempotencyConflictError,
	OperationValidationError,
	RevisionConflictError,
	StorageWriteError,
	UndoTokenError
} from '../domain/errors';
import type { IdSequencer } from '../domain/ids';
import { toWireEnvelope } from '../domain/mutation';
import type { ProvenanceSource, WorkspaceRepository } from '../domain/ports';
import { emptyWorkspace } from '../domain/workspace';
import { recordCommit, restoreRevision, undoChange } from '../application/changeHistory';
import type { ChangeHistory } from '../application/changeHistory';
import { fingerprintRequest } from '../application/idempotency';
import type { IdempotencyCache } from '../application/idempotency';
import type { OperationRegistry } from '../application/operationRegistry';
import type { RevisionService } from '../application/revisionService';
import type { Clock } from '../domain/ports';

export interface WorkbenchDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	provenance: ProvenanceSource;
	clock: Clock;
	ids: IdSequencer;
	// save_workspace attaches a name without bumping the revision (Open
	// Question 5), so it can't route through RevisionService.commit's own
	// idempotency check like every other mutating tool -- it replays keys
	// against this cache directly instead.
	idempotency: IdempotencyCache;
}

// Static for now (Open Question 7): no permission model exists yet, and
// trading is deliberately excluded from the whole program's surface.
const PERMISSIONS = {
	trading: false,
	canCreateWorkspace: true,
	canModifyWorkspace: true
};

function historyDeps(deps: WorkbenchDeps) {
	return { history: deps.history, revisionService: deps.revisions, clock: deps.clock };
}

// Maps a typed T-1006-2 error to the tool failure shape; anything else
// falls back to its message.
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

function resolveWorkspaceId(deps: WorkbenchDeps, input: { workspace_id?: unknown }): string | null {
	if (typeof input.workspace_id === 'string') {
		return input.workspace_id;
	}
	return deps.repository.getActiveId();
}

function getAppContext(deps: WorkbenchDeps) {
	// Reads state fresh on every call -- capturing it once at buildWorkbenchTools
	// time would freeze get_app_context's answer at whatever the workspace
	// looked like when the tool list was built.
	return async (): Promise<ToolResult> => {
		const activeId = deps.repository.getActiveId();
		const doc = activeId ? deps.repository.get(activeId) : null;
		const prices = deps.provenance.current('prices');
		return ok({
			activeWorkspaceId: doc?.id ?? null,
			workspaceName: doc?.name ?? null,
			selectedScreenerId: doc?.screenerId ?? null,
			focusedPanelId: doc?.activePanelId ?? null,
			revision: doc?.revision ?? null,
			permissions: PERMISSIONS,
			marketDataLiveness: prices.liveness,
			marketDataDelaySeconds: prices.delaySeconds,
			presentationTimezone: prices.timezone
		});
	};
}

function getCanvasState(deps: WorkbenchDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as { workspace_id?: unknown };
		const id = resolveWorkspaceId(deps, input);
		if (!id) {
			return fail('No active workspace.', { error: 'not_found' });
		}
		const doc = deps.repository.get(id);
		if (!doc) {
			return fail(`Workspace not found: ${id}`, { error: 'not_found' });
		}
		const revisions = deps.repository.listRevisions(id);
		const currentIsNamed = revisions.some((r) => r.revision === doc.revision && r.name !== null);
		return ok({
			id: doc.id,
			name: doc.name,
			revision: doc.revision,
			panels: doc.panels,
			layout: doc.layout,
			links: doc.links,
			activeSymbol: doc.activeSymbol,
			activePanelId: doc.activePanelId,
			screenerId: doc.screenerId,
			hasUnsavedChanges: !currentIsNamed
		});
	};
}

function createWorkspace(deps: WorkbenchDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = rawInput as { name: string; template_id?: string; idempotency_key?: string };
		const id = deps.ids.next('workspace');
		try {
			// template_id is accepted (per the design doc's tool table) but no
			// sibling epic ships real templates yet -- every workspace starts
			// blank until one does; out of scope note in the ticket doc.
			const envelope = recordCommit(historyDeps(deps), {
				workspaceId: id,
				context: { idempotencyKey: input.idempotency_key, actor: 'agent' },
				operationKind: 'workbench.create_workspace',
				requestInput: { name: input.name, templateId: input.template_id },
				mutate: () => ({
					document: emptyWorkspace(id, input.name, deps.clock.now()),
					affectedIds: [id],
					diffSummary: `Created workspace "${input.name}".`
				})
			});
			deps.repository.setActiveId(id);
			return ok(toWireEnvelope(envelope));
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

function saveWorkspace(deps: WorkbenchDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = rawInput as {
			workspace_id?: string;
			name: string;
			expected_revision?: number;
			idempotency_key?: string;
		};
		const id = resolveWorkspaceId(deps, input);
		if (!id) {
			return fail('No active workspace to save.', { error: 'not_found' });
		}
		const doc = deps.repository.get(id);
		if (!doc) {
			return fail(`Workspace not found: ${id}`, { error: 'not_found' });
		}
		if (input.expected_revision !== undefined && input.expected_revision !== doc.revision) {
			const err = new RevisionConflictError(input.expected_revision, doc.revision, [id]);
			return fail(err.message, err.toWireError());
		}
		// Naming attaches to the current revision rather than opening a second
		// numbering scheme (epic Open Question 5) -- no revision bump, so this
		// bypasses RevisionService.commit's own idempotency/history plumbing
		// and updates the existing snapshot's name directly. It still honors
		// idempotency_key (via the shared cache) and still appends to change
		// history, so a replayed save and a listed save behave like every
		// other enveloped tool despite not bumping the revision.
		const fingerprint = fingerprintRequest('workbench.save_workspace', {
			workspaceId: id,
			name: input.name,
			expectedRevision: input.expected_revision ?? null
		});
		try {
			if (input.idempotency_key) {
				const cached = deps.idempotency.lookup(input.idempotency_key, fingerprint);
				if (cached) {
					return ok(toWireEnvelope(cached));
				}
			}
			deps.repository.putRevision({
				workspaceId: id,
				revision: doc.revision,
				name: input.name,
				savedAt: deps.clock.now(),
				document: doc
			});
			const envelope = {
				changeId: deps.ids.next('change'),
				newRevision: doc.revision,
				affectedIds: [id],
				diffSummary: `Saved workspace as "${input.name}".`,
				warnings: [],
				undoToken: null
			};
			if (input.idempotency_key) {
				deps.idempotency.remember(input.idempotency_key, fingerprint, envelope);
			}
			deps.history.append({
				changeId: envelope.changeId,
				workspaceId: id,
				revision: envelope.newRevision,
				at: deps.clock.now(),
				actor: 'agent',
				diffSummary: envelope.diffSummary,
				affectedIds: envelope.affectedIds,
				undoToken: null,
				undoState: 'none'
			});
			return ok(toWireEnvelope(envelope));
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

function undoChangeTool(deps: WorkbenchDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = rawInput as { undo_token: string };
		try {
			const envelope = undoChange(input.undo_token, {
				...historyDeps(deps),
				context: { actor: 'agent' }
			});
			return ok(toWireEnvelope(envelope));
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

function getChangeHistory(deps: WorkbenchDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as {
			workspace_id?: string;
			limit?: number;
			before_revision?: number;
		};
		const id = resolveWorkspaceId(deps, input);
		if (!id) {
			return fail('No active workspace.', { error: 'not_found' });
		}
		const records = deps.history.list(id, { limit: input.limit, before: input.before_revision });
		return ok(
			records.map((r) => ({
				changeId: r.changeId,
				revision: r.revision,
				at: r.at,
				actor: r.actor,
				diffSummary: r.diffSummary,
				affectedIds: r.affectedIds,
				undoState: r.undoState
			}))
		);
	};
}

function restoreWorkspaceRevision(deps: WorkbenchDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = rawInput as {
			workspace_id?: string;
			revision: number;
			expected_revision?: number;
			idempotency_key?: string;
		};
		const id = resolveWorkspaceId(deps, input);
		if (!id) {
			return fail('No active workspace.', { error: 'not_found' });
		}
		try {
			const envelope = restoreRevision(
				id,
				input.revision,
				{
					expectedRevision: input.expected_revision,
					idempotencyKey: input.idempotency_key,
					actor: 'agent'
				},
				{ ...historyDeps(deps), repository: deps.repository }
			);
			return ok(toWireEnvelope(envelope));
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const always = () => true;

export function buildWorkbenchTools(deps: WorkbenchDeps): ToolSpec[] {
	return [
		{
			name: 'get_app_context',
			description:
				'Returns the active workspace, selected screener, focused panel, static permissions, ' +
				"market-data delay and presentation timezone, and the workspace's current revision.",
			inputSchema: { type: 'object', properties: {} },
			available: always,
			execute: getAppContext(deps)
		},
		{
			name: 'get_canvas_state',
			description:
				"Returns a workspace's panels, layout, links, active symbol, screener binding and " +
				'whether it has changes not saved under a name. Every item carries its stable id. ' +
				'Defaults to the active workspace.',
			inputSchema: {
				type: 'object',
				properties: {
					workspace_id: { type: 'string', description: 'Defaults to the active workspace.' }
				}
			},
			available: always,
			execute: getCanvasState(deps)
		},
		{
			name: 'create_workspace',
			description:
				'Creates a new workspace (blank, or from template_id once a sibling epic ships one), ' +
				'gives it a stable id at revision 1, and makes it the active workspace. Returns the ' +
				'mutation envelope; the new id is in affected_ids.',
			inputSchema: {
				type: 'object',
				properties: {
					name: { type: 'string' },
					template_id: { type: 'string' },
					idempotency_key: { type: 'string' }
				},
				required: ['name']
			},
			available: always,
			execute: createWorkspace(deps)
		},
		{
			name: 'save_workspace',
			description:
				"Attaches a name to the workspace's current revision (does not create a new revision). " +
				'Returns the mutation envelope. Defaults to the active workspace.',
			inputSchema: {
				type: 'object',
				properties: {
					workspace_id: { type: 'string' },
					name: { type: 'string' },
					expected_revision: { type: 'number' },
					idempotency_key: { type: 'string' }
				},
				required: ['name']
			},
			available: always,
			execute: saveWorkspace(deps)
		},
		{
			name: 'undo_change',
			description:
				'Reverses exactly the change that returned undo_token, producing a new, higher ' +
				'revision. Returns the mutation envelope for the reversal.',
			inputSchema: {
				type: 'object',
				properties: { undo_token: { type: 'string' } },
				required: ['undo_token']
			},
			available: always,
			execute: undoChangeTool(deps)
		},
		{
			name: 'get_change_history',
			description:
				'Lists past changes for a workspace, newest first, with an optional limit and an ' +
				'optional revision to start before. Defaults to the active workspace.',
			inputSchema: {
				type: 'object',
				properties: {
					workspace_id: { type: 'string' },
					limit: { type: 'number' },
					before_revision: { type: 'number' }
				}
			},
			available: always,
			execute: getChangeHistory(deps)
		},
		{
			name: 'restore_workspace_revision',
			description:
				'Restores a workspace to an earlier, previously saved revision, moving it forward to a ' +
				"new revision equal to that snapshot's content. Returns the mutation envelope; itself " +
				'undoable. Defaults to the active workspace.',
			inputSchema: {
				type: 'object',
				properties: {
					workspace_id: { type: 'string' },
					revision: { type: 'number' },
					expected_revision: { type: 'number' },
					idempotency_key: { type: 'string' }
				},
				required: ['revision']
			},
			available: always,
			execute: restoreWorkspaceRevision(deps)
		}
	];
}
