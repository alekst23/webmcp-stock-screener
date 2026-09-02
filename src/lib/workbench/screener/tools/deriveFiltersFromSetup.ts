// The `derive_filters_from_setup` tool (T-1014-3). `docs/reference/tool-spec.md`
// names exactly one tool for this capability; `operation` picks which of the
// three registered operations runs, mirroring edit_filter_tree's own
// operation-enum shape (T-1009-4) rather than inventing three separate tool
// names:
//
//   - 'derive' (default): turn a captured setup into a new draft.
//   - 'edit':   mutate an existing draft's tree in place (AC5).
//   - 'accept': replace a target screener's filter tree with the draft's,
//               as one reversible change (AC6/AC10).
//
// Every operation runs through the registered `screener.*` operations via
// EPIC-1006's `applyOperations`, so each also becomes usable through
// EPIC-1013's generic preview_workspace_changes / apply_previewed_changes
// with no separate apply path of this ticket's own.
import { fail, ok } from '../../../webmcp/tools';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import type { CatalogRegistry } from '../../../catalog/registry';
import type { GroupOp } from '../../../screener/definition';
import { applyOperations } from '../../application/operationRegistry';
import type { OperationRegistry } from '../../application/operationRegistry';
import type { ChangeHistory } from '../../application/changeHistory';
import type { RevisionService } from '../../application/revisionService';
import {
	IdempotencyConflictError,
	OperationValidationError,
	RevisionConflictError,
	StorageWriteError,
	UndoTokenError
} from '../../domain/errors';
import { parseId, type IdSequencer, type ResourceId } from '../../domain/ids';
import { toWireEnvelope } from '../../domain/mutation';
import type { MutationEnvelope } from '../../domain/mutation';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import { readFilterDraft, toWireFilterDraft } from '../domain/filterDraft';
import {
	DERIVE_FILTER_DRAFT_KIND,
	ensureDeriveFilterDraftOperation
} from '../application/deriveFilters';
import {
	ACCEPT_FILTER_DRAFT_KIND,
	EDIT_FILTER_DRAFT_KIND,
	ensureAcceptFilterDraftOperation,
	ensureEditFilterDraftOperation,
	isDraftOperation
} from '../application/filterDraftOperations';

export const DERIVE_FILTERS_FROM_SETUP_TOOL_NAME = 'derive_filters_from_setup';

export interface DeriveFiltersFromSetupDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	clock: Clock;
	ids: IdSequencer;
	catalog?: CatalogRegistry;
}

const TOOL_OPERATIONS = ['derive', 'edit', 'accept'] as const;
type ToolOperation = (typeof TOOL_OPERATIONS)[number];

function isToolOperation(value: unknown): value is ToolOperation {
	return typeof value === 'string' && (TOOL_OPERATIONS as readonly string[]).includes(value);
}

interface WireInput {
	workspace_id?: string;
	operation?: unknown;
	// derive
	setup_id?: string;
	target_screener_id?: string;
	// edit
	draft_id?: string;
	edit_operation?: unknown;
	node_id?: string;
	parent_node_id?: string;
	node_ids?: string[];
	group_op?: GroupOp;
	condition?: unknown;
	enabled?: boolean;
	ordered_node_ids?: string[];
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

function isDraftId(id: ResourceId): boolean {
	const parsed = parseId(id);
	return parsed?.kind === 'filter' && parsed.discriminator === 'draft';
}

function operationsDeps(deps: DeriveFiltersFromSetupDeps) {
	return {
		registry: deps.registry,
		history: deps.history,
		revisionService: deps.revisions,
		clock: deps.clock,
		ids: deps.ids
	};
}

function envelopePayload(
	envelope: MutationEnvelope,
	extra: Record<string, unknown>
): Record<string, unknown> {
	return { ...toWireEnvelope(envelope), ...extra };
}

function runDerive(
	deps: DeriveFiltersFromSetupDeps,
	workspaceId: string,
	input: WireInput
): ToolResult {
	if (!input.setup_id) {
		const err = new OperationValidationError(['setup_id is required for operation "derive".']);
		return fail(err.message, err.toWireError());
	}
	const envelope = applyOperations(
		[
			{
				kind: DERIVE_FILTER_DRAFT_KIND,
				input: {
					setupId: input.setup_id,
					...(input.target_screener_id !== undefined
						? { targetScreenerId: input.target_screener_id }
						: {})
				}
			}
		],
		{
			expectedRevision: input.expected_revision,
			idempotencyKey: input.idempotency_key,
			actor: 'agent'
		},
		{ ...operationsDeps(deps), workspaceId }
	);
	const draftId = envelope.affectedIds.find(isDraftId) ?? null;
	const doc = deps.repository.get(workspaceId);
	const draft = draftId && doc ? readFilterDraft(doc, draftId) : null;
	return ok(
		envelopePayload(envelope, {
			draft_id: draftId,
			draft: draft ? toWireFilterDraft(draft) : null
		})
	);
}

function runEdit(
	deps: DeriveFiltersFromSetupDeps,
	workspaceId: string,
	input: WireInput
): ToolResult {
	if (!input.draft_id) {
		const err = new OperationValidationError(['draft_id is required for operation "edit".']);
		return fail(err.message, err.toWireError());
	}
	if (!isDraftOperation(input.edit_operation)) {
		const err = new OperationValidationError([
			`edit_operation "${String(input.edit_operation)}" is not one of add, update, remove, group, ` +
				'set_enabled, reorder.'
		]);
		return fail(err.message, err.toWireError());
	}
	const draftId = input.draft_id;
	const envelope = applyOperations(
		[
			{
				kind: EDIT_FILTER_DRAFT_KIND,
				input: {
					draftId,
					operation: input.edit_operation,
					...(input.node_id !== undefined ? { nodeId: input.node_id } : {}),
					...(input.parent_node_id !== undefined ? { parentNodeId: input.parent_node_id } : {}),
					...(input.node_ids !== undefined ? { nodeIds: input.node_ids } : {}),
					...(input.group_op !== undefined ? { groupOp: input.group_op } : {}),
					...(input.condition !== undefined ? { condition: input.condition } : {}),
					...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
					...(input.ordered_node_ids !== undefined
						? { orderedNodeIds: input.ordered_node_ids }
						: {})
				}
			}
		],
		{
			expectedRevision: input.expected_revision,
			idempotencyKey: input.idempotency_key,
			actor: 'agent'
		},
		{ ...operationsDeps(deps), workspaceId }
	);
	const doc = deps.repository.get(workspaceId);
	const draft = doc ? readFilterDraft(doc, draftId) : null;
	return ok(
		envelopePayload(envelope, { draft_id: draftId, draft: draft ? toWireFilterDraft(draft) : null })
	);
}

function runAccept(
	deps: DeriveFiltersFromSetupDeps,
	workspaceId: string,
	input: WireInput
): ToolResult {
	if (!input.draft_id) {
		const err = new OperationValidationError(['draft_id is required for operation "accept".']);
		return fail(err.message, err.toWireError());
	}
	if (!input.target_screener_id) {
		const err = new OperationValidationError([
			'target_screener_id is required for operation "accept".'
		]);
		return fail(err.message, err.toWireError());
	}
	const envelope = applyOperations(
		[
			{
				kind: ACCEPT_FILTER_DRAFT_KIND,
				input: { draftId: input.draft_id, targetScreenerId: input.target_screener_id }
			}
		],
		{
			expectedRevision: input.expected_revision,
			idempotencyKey: input.idempotency_key,
			actor: 'agent'
		},
		{ ...operationsDeps(deps), workspaceId }
	);
	return ok(
		envelopePayload(envelope, { draft_id: input.draft_id, screener_id: input.target_screener_id })
	);
}

function deriveFiltersFromSetup(deps: DeriveFiltersFromSetupDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as WireInput;
		const operation = input.operation === undefined ? 'derive' : input.operation;
		if (!isToolOperation(operation)) {
			const err = new OperationValidationError([
				`Unknown operation "${String(operation)}". Valid operations: ${TOOL_OPERATIONS.join(', ')}.`
			]);
			return fail(err.message, err.toWireError());
		}
		const workspaceId = input.workspace_id ?? deps.repository.getActiveId();
		if (!workspaceId) {
			return fail('No active workspace.', { error: 'not_found' });
		}
		try {
			switch (operation) {
				case 'derive':
					return runDerive(deps, workspaceId, input);
				case 'edit':
					return runEdit(deps, workspaceId, input);
				case 'accept':
					return runAccept(deps, workspaceId, input);
			}
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		operation: {
			type: 'string',
			enum: [...TOOL_OPERATIONS],
			description: 'Defaults to "derive".'
		},
		setup_id: { type: 'string', description: 'derive: the captured setup to derive a draft from.' },
		target_screener_id: {
			type: 'string',
			description:
				'derive: optional hint carried onto the draft. accept: required, the screener whose ' +
				"filter tree becomes the draft's contents."
		},
		draft_id: { type: 'string', description: 'edit/accept: the draft to act on.' },
		edit_operation: {
			type: 'string',
			enum: ['add', 'update', 'remove', 'group', 'set_enabled', 'reorder'],
			description: 'edit: which structural change to make to the draft, as in edit_filter_tree.'
		},
		node_id: { type: 'string', description: 'edit: required by update, remove, and set_enabled.' },
		parent_node_id: {
			type: 'string',
			description: "edit add/reorder: defaults to the draft's root."
		},
		node_ids: {
			type: 'array',
			items: { type: 'string' },
			description: 'edit group: two or more sibling node ids.'
		},
		group_op: {
			type: 'string',
			enum: ['and', 'or', 'not'],
			description: 'edit group: defaults to "and".'
		},
		condition: {
			type: 'object',
			description: 'edit add/update: one of the eight typed condition variants from the catalog.'
		},
		enabled: {
			type: 'boolean',
			description: 'edit set_enabled: the new enabled state for the node.'
		},
		ordered_node_ids: {
			type: 'array',
			items: { type: 'string' },
			description: 'edit reorder: every current child of the target group, in the desired order.'
		},
		expected_revision: { type: 'number' },
		idempotency_key: { type: 'string' }
	}
};

const DESCRIPTION =
	'Convert a captured chart setup into an editable draft filter tree (operation "derive", the ' +
	'default), never applying it to a live screener directly. Each derived condition uses the ' +
	"screener's typed condition model (scalar, range, series_comparison, temporal, event_relative, " +
	'pattern, relative, study_output) and states which characteristic of the setup produced it. A ' +
	'condition referencing data unavailable for this project is included disabled rather than' +
	' silently dropped, with a warning naming it; a setup with nothing derivable returns an empty ' +
	'draft with a warning, not an error. operation "edit" updates, removes, disables, or regroups a ' +
	'condition in an existing draft -- the result is still a draft. operation "accept" replaces a ' +
	"named target screener's filter tree with the draft's contents as one reversible change. Every " +
	'operation accepts expected_revision and idempotency_key and returns the mutation envelope.';

export function buildDeriveFiltersFromSetupTool(deps: DeriveFiltersFromSetupDeps): ToolSpec {
	ensureDeriveFilterDraftOperation(deps.registry, {
		clock: deps.clock,
		...(deps.catalog ? { registry: deps.catalog } : {})
	});
	ensureEditFilterDraftOperation(deps.registry, {
		...(deps.catalog ? { registry: deps.catalog } : {})
	});
	ensureAcceptFilterDraftOperation(deps.registry, { clock: deps.clock });
	return {
		name: DERIVE_FILTERS_FROM_SETUP_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: INPUT_SCHEMA,
		available: () => true,
		execute: deriveFiltersFromSetup(deps)
	};
}
