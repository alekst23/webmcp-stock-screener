// T-1014-3: the "edit" and "accept" halves of derive_filters_from_setup.
//
// Editing a draft (AC5) reuses EPIC-1009's own pure filterTree.ts functions
// -- they operate on any FilterNode, not specifically a screener's, so this
// is consumption of that public contract rather than a modification of it.
// Accepting a draft (AC6/AC10) replaces a target screener's filterTree with
// the draft's tree wholesale, as one reversible EPIC-1006 change.
//
// Application layer: orchestrates EPIC-1009's filter-tree domain and
// EPIC-1006's operation registry. No I/O beyond the injected Clock.
import { builtinCatalogRegistry, type CatalogRegistry } from '../../../catalog/registry';
import {
	findDisallowedConditionFields,
	validateCondition
} from '../../../screener/conditionValidation';
import { normalizeCondition, type Condition } from '../../../screener/conditions';
import type { FilterNode, GroupOp } from '../../../screener/definition';
import {
	addFilterNode,
	groupFilterNodes,
	removeFilterNode,
	reorderFilterChildren,
	setFilterNodeEnabled,
	updateFilterCondition,
	type FilterTreeOpFailure,
	type FilterTreeOpResult
} from '../../../screener/filterTree';
import { readScreener, writeScreener } from '../../../screener/state';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { MutationDraft } from '../../application/revisionService';
import { OperationValidationError } from '../../domain/errors';
import type { IdSequencer, ResourceId } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { DraftConditionProvenance, FilterDraft } from '../domain/filterDraft';
import { readFilterDraft, writeFilterDraft } from '../domain/filterDraft';

export const EDIT_FILTER_DRAFT_KIND = 'screener.edit_filter_draft';
export const ACCEPT_FILTER_DRAFT_KIND = 'screener.accept_filter_draft';

const DRAFT_OPERATIONS = ['add', 'update', 'remove', 'group', 'set_enabled', 'reorder'] as const;
export type DraftOperation = (typeof DRAFT_OPERATIONS)[number];

export function isDraftOperation(value: unknown): value is DraftOperation {
	return typeof value === 'string' && (DRAFT_OPERATIONS as readonly string[]).includes(value);
}

export interface EditFilterDraftInput {
	draftId: ResourceId;
	operation: DraftOperation;
	nodeId?: ResourceId;
	parentNodeId?: ResourceId;
	nodeIds?: ResourceId[];
	groupOp?: GroupOp;
	condition?: unknown;
	enabled?: boolean;
	orderedNodeIds?: ResourceId[];
}

type ParsedCondition = { ok: true; condition: Condition } | FilterTreeOpFailure;

// Mirrors editFilterTree.ts's own parseConditionInput (T-1009-6): a stray
// field is rejected before normalizeCondition would otherwise silently drop
// it, and every add/update into a draft is validated against the catalog
// exactly like an edit to a live screener -- a draft's conditions are the
// same typed model, not a looser one (AC2).
function parseConditionInput(raw: unknown, registry: CatalogRegistry): ParsedCondition {
	const disallowed = findDisallowedConditionFields(raw);
	if (disallowed.length > 0) {
		return {
			ok: false,
			message: `condition carries field(s) not part of its condition model: ${disallowed.join(', ')}.`
		};
	}
	const condition = normalizeCondition(raw);
	if (!condition) {
		return {
			ok: false,
			message: 'condition did not parse into one of the eight known condition types.'
		};
	}
	const problems = validateCondition(condition, { registry });
	if (problems.length > 0) {
		return { ok: false, message: problems.map((p) => p.message).join(' ') };
	}
	return { ok: true, condition };
}

function collectNodeIds(node: FilterNode, out: ResourceId[] = []): ResourceId[] {
	out.push(node.nodeId);
	if (node.kind === 'group') {
		for (const child of node.children) {
			collectNodeIds(child, out);
		}
	}
	return out;
}

function runDraftOperation(
	tree: FilterNode,
	ids: IdSequencer,
	input: EditFilterDraftInput,
	registry: CatalogRegistry
): FilterTreeOpResult {
	switch (input.operation) {
		case 'add': {
			if (input.condition === undefined) {
				return { ok: false, message: 'add requires "condition".' };
			}
			const parsed = parseConditionInput(input.condition, registry);
			if (!parsed.ok) {
				return parsed;
			}
			return addFilterNode(tree, ids, {
				...(input.parentNodeId !== undefined ? { parentNodeId: input.parentNodeId } : {}),
				condition: parsed.condition
			});
		}
		case 'update': {
			if (!input.nodeId) {
				return { ok: false, message: 'update requires "node_id".' };
			}
			if (input.condition === undefined) {
				return { ok: false, message: 'update requires "condition".' };
			}
			const parsed = parseConditionInput(input.condition, registry);
			if (!parsed.ok) {
				return parsed;
			}
			return updateFilterCondition(tree, { nodeId: input.nodeId, condition: parsed.condition });
		}
		case 'remove':
			if (!input.nodeId) {
				return { ok: false, message: 'remove requires "node_id".' };
			}
			return removeFilterNode(tree, { nodeId: input.nodeId });
		case 'group':
			if (!input.nodeIds || input.nodeIds.length === 0) {
				return { ok: false, message: 'group requires "node_ids".' };
			}
			return groupFilterNodes(tree, ids, { nodeIds: input.nodeIds, op: input.groupOp ?? 'and' });
		case 'set_enabled':
			if (!input.nodeId) {
				return { ok: false, message: 'set_enabled requires "node_id".' };
			}
			if (input.enabled === undefined) {
				return { ok: false, message: 'set_enabled requires "enabled".' };
			}
			return setFilterNodeEnabled(tree, { nodeId: input.nodeId, enabled: input.enabled });
		case 'reorder':
			if (!input.orderedNodeIds || input.orderedNodeIds.length === 0) {
				return { ok: false, message: 'reorder requires "ordered_node_ids".' };
			}
			return reorderFilterChildren(tree, {
				...(input.parentNodeId !== undefined ? { parentNodeId: input.parentNodeId } : {}),
				orderedNodeIds: input.orderedNodeIds
			});
	}
}

// A node's provenance entry describes the setup characteristic that produced
// its *original* condition (AC3); once the result of an edit no longer
// carries that condition unchanged, keeping the old explanation attached
// would misattribute a hand-edit to the setup. Provenance for a node that no
// longer exists at all (removed, alone or as part of a removed subtree) is
// dropped by the same pass, via the existing-id intersection.
function nextProvenance(
	draft: FilterDraft,
	nextTree: FilterNode,
	operation: DraftOperation,
	updatedNodeId: ResourceId | undefined
): DraftConditionProvenance[] {
	const survivingIds = new Set(collectNodeIds(nextTree));
	return draft.provenance.filter((entry) => {
		if (!survivingIds.has(entry.nodeId)) {
			return false;
		}
		if (operation === 'update' && entry.nodeId === updatedNodeId) {
			return false;
		}
		return true;
	});
}

function validateEditDraftInput(input: EditFilterDraftInput, doc: WorkspaceDocument): string[] {
	const issues: string[] = [];
	if (!input.draftId) {
		issues.push('draft_id is required.');
	} else if (!readFilterDraft(doc, input.draftId)) {
		issues.push(`Unknown draft id: ${input.draftId}.`);
	}
	if (!isDraftOperation(input.operation)) {
		issues.push(
			`Unknown operation "${String(input.operation)}". Valid operations: ${DRAFT_OPERATIONS.join(', ')}.`
		);
	}
	return issues;
}

function applyEditDraft(
	input: EditFilterDraftInput,
	doc: WorkspaceDocument,
	ids: IdSequencer,
	registry: CatalogRegistry
): MutationDraft {
	const draft = readFilterDraft(doc, input.draftId);
	if (!draft) {
		throw new OperationValidationError([`Unknown draft id: ${input.draftId}.`]); // unreachable after validate()
	}
	const result = runDraftOperation(draft.tree, ids, input, registry);
	if (!result.ok) {
		const issues = [result.message];
		if (result.validNodeIds) {
			issues.push(`Valid node ids: ${result.validNodeIds.join(', ') || '(none)'}.`);
		}
		throw new OperationValidationError(issues);
	}
	const nextDraft: FilterDraft = {
		...draft,
		tree: result.tree,
		provenance: nextProvenance(draft, result.tree, input.operation, input.nodeId)
	};
	return {
		document: writeFilterDraft(doc, nextDraft),
		affectedIds: [draft.draftId, ...result.affectedIds],
		diffSummary: `${result.diffSummary} (draft ${draft.draftId})`,
		inverse: {
			document: doc,
			affectedIds: [draft.draftId, ...result.affectedIds],
			diffSummary: `Reverted the ${input.operation} on draft ${draft.draftId}.`
		}
	};
}

export function createEditFilterDraftOperation(deps: {
	registry?: CatalogRegistry;
}): OperationDefinition<EditFilterDraftInput> {
	const catalog = deps.registry ?? builtinCatalogRegistry;
	return {
		kind: EDIT_FILTER_DRAFT_KIND,
		inputSchema: {
			type: 'object',
			properties: {
				draftId: { type: 'string' },
				operation: { type: 'string', enum: [...DRAFT_OPERATIONS] }
			},
			required: ['draftId', 'operation']
		},
		validate: validateEditDraftInput,
		describe: (input) => `${input.operation} on filter draft ${input.draftId}.`,
		apply: (input, doc, ids) => applyEditDraft(input, doc, ids, catalog)
	};
}

export function ensureEditFilterDraftOperation(
	registry: OperationRegistry,
	deps: { registry?: CatalogRegistry } = {}
): void {
	if (!registry.get(EDIT_FILTER_DRAFT_KIND)) {
		registry.register(createEditFilterDraftOperation(deps));
	}
}

export interface AcceptFilterDraftInput {
	draftId: ResourceId;
	targetScreenerId: ResourceId;
}

function validateAcceptDraftInput(input: AcceptFilterDraftInput, doc: WorkspaceDocument): string[] {
	const issues: string[] = [];
	if (!input.draftId) {
		issues.push('draft_id is required.');
	} else if (!readFilterDraft(doc, input.draftId)) {
		issues.push(`Unknown draft id: ${input.draftId}.`);
	}
	if (!input.targetScreenerId) {
		issues.push('target_screener_id is required.');
	} else if (!readScreener(doc, input.targetScreenerId)) {
		issues.push(`Unknown screener id: ${input.targetScreenerId}.`);
	}
	return issues;
}

// Accepting is deliberately a wholesale replacement, never a merge -- the
// ticket's AC6: "the screener's filter tree becomes the draft's contents".
// The draft's node ids were minted from the same workspace-wide IdSequencer
// a screener's own filter nodes use, so they carry over unchanged rather
// than needing to be re-minted.
function applyAccept(
	input: AcceptFilterDraftInput,
	doc: WorkspaceDocument,
	now: string
): MutationDraft {
	const draft = readFilterDraft(doc, input.draftId);
	const screener = readScreener(doc, input.targetScreenerId);
	if (!draft || !screener) {
		throw new OperationValidationError(['Unknown draft id or screener id.']); // unreachable after validate()
	}
	const nextScreener = { ...screener, filterTree: draft.tree, revision: screener.revision + 1 };
	const acceptedDraft: FilterDraft = {
		...draft,
		acceptedAt: now,
		acceptedScreenerId: input.targetScreenerId
	};
	const nextDoc = writeFilterDraft(writeScreener(doc, nextScreener), acceptedDraft);
	return {
		document: nextDoc,
		affectedIds: [input.targetScreenerId, draft.draftId],
		diffSummary: `Accepted filter draft ${draft.draftId} onto screener ${input.targetScreenerId}.`,
		inverse: {
			// `doc` is the pre-accept document RevisionService.commit loaded --
			// it provably still carries the screener's prior filter tree and the
			// draft's prior (unaccepted) state, so it is exactly what AC10's undo
			// must restore.
			document: doc,
			affectedIds: [input.targetScreenerId, draft.draftId],
			diffSummary: `Reverted screener ${input.targetScreenerId} to its filter tree before accepting draft ${draft.draftId}.`
		}
	};
}

export function createAcceptFilterDraftOperation(deps: {
	clock: Clock;
}): OperationDefinition<AcceptFilterDraftInput> {
	return {
		kind: ACCEPT_FILTER_DRAFT_KIND,
		inputSchema: {
			type: 'object',
			properties: { draftId: { type: 'string' }, targetScreenerId: { type: 'string' } },
			required: ['draftId', 'targetScreenerId']
		},
		validate: validateAcceptDraftInput,
		describe: (input) =>
			`Accept filter draft ${input.draftId} onto screener ${input.targetScreenerId}.`,
		apply: (input, doc) => applyAccept(input, doc, deps.clock.now())
	};
}

export function ensureAcceptFilterDraftOperation(
	registry: OperationRegistry,
	deps: { clock: Clock }
): void {
	if (!registry.get(ACCEPT_FILTER_DRAFT_KIND)) {
		registry.register(createAcceptFilterDraftOperation(deps));
	}
}
