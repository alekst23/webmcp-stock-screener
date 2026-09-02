// `edit_filter_tree`: the six structural operations over a screener's filter
// tree (T-1009-4), routed through EPIC-1006's single write path
// (RevisionService.commit via recordCommit). The pure tree mechanics live in
// src/lib/screener/filterTree.ts; this module only translates the wire input,
// reads/writes the screener inside `mutate(doc)`, and maps a rejection to the
// program's typed error shapes.
import { builtinCatalogRegistry, type CatalogRegistry } from '../../catalog/registry';
import {
	findDisallowedConditionFields,
	validateCondition
} from '../../screener/conditionValidation';
import { normalizeCondition, type Condition } from '../../screener/conditions';
import type { FilterNode, GroupOp, UniverseSpec } from '../../screener/definition';
import {
	addFilterNode,
	groupFilterNodes,
	removeFilterNode,
	reorderFilterChildren,
	setFilterNodeEnabled,
	updateFilterCondition,
	type FilterTreeOpFailure,
	type FilterTreeOpResult
} from '../../screener/filterTree';
import { readScreener, writeScreener } from '../../screener/state';
import type { IdSequencer } from '../../workbench/domain/ids';
import { recordCommit } from '../../workbench/application/changeHistory';
import { OperationValidationError } from '../../workbench/domain/errors';
import { toWireEnvelope } from '../../workbench/domain/mutation';
import type { WorkspaceDocument } from '../../workbench/domain/workspace';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import { fail, ok } from '../tools';
import type { ToolResult, ToolSpec } from '../types';
import { resolveWorkspaceId, toErrorResult } from './support';

const OPERATIONS = ['add', 'update', 'remove', 'group', 'set_enabled', 'reorder'] as const;
type Operation = (typeof OPERATIONS)[number];

function isOperation(value: unknown): value is Operation {
	return typeof value === 'string' && (OPERATIONS as readonly string[]).includes(value);
}

interface EditFilterTreeInput {
	workspace_id?: string;
	screener_id?: string;
	operation?: unknown;
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

// Wraps a pure filterTree.ts rejection as the program's typed validation
// error, listing valid node ids back to the agent when the rejection was
// specifically an unknown id (AC8's self-correcting-error convention).
function toRejection(result: Extract<FilterTreeOpResult, { ok: false }>): OperationValidationError {
	const issues = [result.message];
	if (result.validNodeIds) {
		issues.push(
			`Valid node ids: ${result.validNodeIds.length > 0 ? result.validNodeIds.join(', ') : '(none)'}.`
		);
	}
	return new OperationValidationError(issues);
}

type ParsedCondition = { ok: true; condition: Condition } | FilterTreeOpFailure;

// T-1009-6, AC9/AC11: a condition is rejected here -- before addFilterNode /
// updateFilterCondition ever touch the tree -- when it either carries a
// field no condition variant declares (AC11's "no raw SQL/JavaScript"
// property, checked against the raw payload before normalizeCondition would
// otherwise silently drop the stray key) or names a field, operator, study,
// pattern, or interval absent from the catalog, or a parameter outside its
// declared range (AC9/AC10). Every rejection reuses FilterTreeOpFailure, so
// the caller's existing OperationValidationError path (AC9's "tree is left
// unchanged") needs no second error shape.
function parseConditionInput(
	raw: unknown,
	registry: CatalogRegistry,
	universe: UniverseSpec
): ParsedCondition {
	const disallowed = findDisallowedConditionFields(raw);
	if (disallowed.length > 0) {
		return {
			ok: false,
			message:
				`condition carries field(s) not part of its condition model: ${disallowed.join(', ')}. ` +
				'No condition variant accepts a free-form expression, query, or code string.'
		};
	}
	const condition = normalizeCondition(raw);
	if (!condition) {
		return {
			ok: false,
			message: 'condition did not parse into one of the eight known condition types.'
		};
	}
	const problems = validateCondition(condition, { registry, universe });
	if (problems.length > 0) {
		return { ok: false, message: problems.map((problem) => problem.message).join(' ') };
	}
	return { ok: true, condition };
}

function runAdd(
	tree: FilterNode,
	ids: IdSequencer,
	input: EditFilterTreeInput,
	registry: CatalogRegistry,
	universe: UniverseSpec
): FilterTreeOpResult {
	if (input.condition === undefined) {
		return { ok: false, message: 'add requires "condition".' };
	}
	const parsed = parseConditionInput(input.condition, registry, universe);
	if (!parsed.ok) {
		return parsed;
	}
	return addFilterNode(tree, ids, {
		parentNodeId: input.parent_node_id,
		condition: parsed.condition
	});
}

function runUpdate(
	tree: FilterNode,
	input: EditFilterTreeInput,
	registry: CatalogRegistry,
	universe: UniverseSpec
): FilterTreeOpResult {
	if (!input.node_id) {
		return { ok: false, message: 'update requires "node_id".' };
	}
	if (input.condition === undefined) {
		return { ok: false, message: 'update requires "condition".' };
	}
	const parsed = parseConditionInput(input.condition, registry, universe);
	if (!parsed.ok) {
		return parsed;
	}
	return updateFilterCondition(tree, { nodeId: input.node_id, condition: parsed.condition });
}

function runRemove(tree: FilterNode, input: EditFilterTreeInput): FilterTreeOpResult {
	if (!input.node_id) {
		return { ok: false, message: 'remove requires "node_id".' };
	}
	return removeFilterNode(tree, { nodeId: input.node_id });
}

function runGroup(
	tree: FilterNode,
	ids: IdSequencer,
	input: EditFilterTreeInput
): FilterTreeOpResult {
	if (!input.node_ids || input.node_ids.length === 0) {
		return { ok: false, message: 'group requires "node_ids".' };
	}
	return groupFilterNodes(tree, ids, { nodeIds: input.node_ids, op: input.group_op ?? 'and' });
}

function runSetEnabled(tree: FilterNode, input: EditFilterTreeInput): FilterTreeOpResult {
	if (!input.node_id) {
		return { ok: false, message: 'set_enabled requires "node_id".' };
	}
	if (input.enabled === undefined) {
		return { ok: false, message: 'set_enabled requires "enabled".' };
	}
	return setFilterNodeEnabled(tree, { nodeId: input.node_id, enabled: input.enabled });
}

function runReorder(tree: FilterNode, input: EditFilterTreeInput): FilterTreeOpResult {
	if (!input.ordered_node_ids || input.ordered_node_ids.length === 0) {
		return { ok: false, message: 'reorder requires "ordered_node_ids".' };
	}
	return reorderFilterChildren(tree, {
		parentNodeId: input.parent_node_id,
		orderedNodeIds: input.ordered_node_ids
	});
}

function runOperation(
	tree: FilterNode,
	input: EditFilterTreeInput,
	ids: IdSequencer,
	operation: Operation,
	registry: CatalogRegistry,
	universe: UniverseSpec
): FilterTreeOpResult {
	switch (operation) {
		case 'add':
			return runAdd(tree, ids, input, registry, universe);
		case 'update':
			return runUpdate(tree, input, registry, universe);
		case 'remove':
			return runRemove(tree, input);
		case 'group':
			return runGroup(tree, ids, input);
		case 'set_enabled':
			return runSetEnabled(tree, input);
		case 'reorder':
			return runReorder(tree, input);
	}
}

// The mutate() callback RevisionService.commit() invokes with the current
// document. Throwing here (unknown screener, or a filterTree.ts rejection)
// leaves the document and its revision untouched -- commit()'s own
// guarantee, reused rather than reimplemented (AC9).
function mutateFilterTree(
	doc: WorkspaceDocument,
	screenerId: string,
	input: EditFilterTreeInput,
	operation: Operation,
	ids: IdSequencer,
	registry: CatalogRegistry
) {
	const screener = readScreener(doc, screenerId);
	if (!screener) {
		throw new OperationValidationError([`Unknown screener id: ${screenerId}.`]);
	}
	const result = runOperation(
		screener.filterTree,
		input,
		ids,
		operation,
		registry,
		screener.universe
	);
	if (!result.ok) {
		throw toRejection(result);
	}
	// screener.revision is a screener-local counter, separate from
	// WorkspaceDocument.revision -- commit() advances the latter (and checks
	// expected_revision against it) once this mutate() returns; this bump is
	// the former's own advance.
	const nextScreener = { ...screener, filterTree: result.tree, revision: screener.revision + 1 };
	return {
		document: writeScreener(doc, nextScreener),
		affectedIds: result.affectedIds,
		diffSummary: result.diffSummary,
		// `doc` is the pre-mutation document RevisionService.commit loaded --
		// it provably still carries this screener's prior filter tree, so it
		// is exactly the state undo must restore to (T-1009-10 AC5; matches
		// createScreener.ts's and setScreenerUniverse.ts's own inverse). This
		// was missing before this ticket: every other screener mutation tool
		// sets an inverse, but this one never did, so edit_filter_tree's
		// undo_token was always null -- a genuine bug relative to
		// technical.md's "every mutation tool ... returns ... undo_token".
		inverse: {
			document: doc,
			affectedIds: result.affectedIds,
			diffSummary: `Reverted the ${operation} on screener ${screenerId}.`
		}
	};
}

function editFilterTree(deps: WorkbenchDeps, registry: CatalogRegistry) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as EditFilterTreeInput;
		if (!input.screener_id) {
			const err = new OperationValidationError(['screener_id is required.']);
			return fail(err.message, err.toWireError());
		}
		if (!isOperation(input.operation)) {
			const err = new OperationValidationError([
				`Unknown operation "${String(input.operation)}". Valid operations: ${OPERATIONS.join(', ')}.`
			]);
			return fail(err.message, err.toWireError());
		}
		const workspaceId = resolveWorkspaceId(deps, input);
		if (!workspaceId) {
			return fail('No active workspace.', { error: 'not_found' });
		}
		const operation = input.operation;
		const screenerId = input.screener_id;
		try {
			const envelope = recordCommit(
				{ history: deps.history, revisionService: deps.revisions, clock: deps.clock },
				{
					workspaceId,
					context: {
						expectedRevision: input.expected_revision,
						idempotencyKey: input.idempotency_key,
						actor: 'agent'
					},
					operationKind: 'screener.edit_filter_tree',
					requestInput: input,
					mutate: (doc) => mutateFilterTree(doc, screenerId, input, operation, deps.ids, registry)
				}
			);
			return ok(toWireEnvelope(envelope));
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		screener_id: { type: 'string' },
		operation: { type: 'string', enum: [...OPERATIONS] },
		node_id: { type: 'string', description: 'Required by update, remove, and set_enabled.' },
		parent_node_id: {
			type: 'string',
			description: 'add/reorder: the group to act on. Defaults to the root group.'
		},
		node_ids: {
			type: 'array',
			items: { type: 'string' },
			description:
				'group: two or more sibling node ids, in the order they should appear in the new group.'
		},
		group_op: {
			type: 'string',
			enum: ['and', 'or', 'not'],
			description:
				'group: the new group operator. Defaults to "and". "not" requires exactly one node id.'
		},
		condition: {
			type: 'object',
			description: 'add/update: one of the eight typed condition variants from the catalog.'
		},
		enabled: { type: 'boolean', description: 'set_enabled: the new enabled state for the node.' },
		ordered_node_ids: {
			type: 'array',
			items: { type: 'string' },
			description: 'reorder: every current child of the target group, in the desired order.'
		},
		expected_revision: { type: 'number' },
		idempotency_key: { type: 'string' }
	},
	required: ['screener_id', 'operation']
};

// `registry` defaults to the built-in catalog (T-1009-6) so existing call
// sites need not change; tests can inject a fixture registry instead.
export function createEditFilterTreeTool(
	deps: WorkbenchDeps,
	registry: CatalogRegistry = builtinCatalogRegistry
): ToolSpec {
	return {
		name: 'edit_filter_tree',
		description:
			'Add, update, remove, group, enable/disable, or reorder nodes in a filter tree by node ' +
			'id. Groups nest AND/OR/NOT to arbitrary depth; a "not" group must hold exactly one ' +
			'child. add/update reject a condition naming a field, operator, study, pattern, or ' +
			'interval absent from the catalog, or a parameter outside its declared range. Node ids ' +
			'never change except for the node removed or newly created. Returns the mutation ' +
			'envelope; accepts expected_revision and idempotency_key.',
		inputSchema: INPUT_SCHEMA,
		available: () => true,
		execute: editFilterTree(deps, registry)
	};
}
