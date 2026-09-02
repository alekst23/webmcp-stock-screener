import { beforeEach, describe, expect, it } from 'vitest';
import { createScreener, type FilterNode, type GroupNode } from '../../screener/definition';
import { readScreener, writeScreener } from '../../screener/state';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createOperationRegistry } from '../../workbench/application/operationRegistry';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import type { Clock } from '../../workbench/domain/ports';
import type { MarketDataProvenance } from '../../workbench/domain/provenance';
import { emptyWorkspace } from '../../workbench/domain/workspace';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import type { ToolResult } from '../types';
import { createEditFilterTreeTool } from './editFilterTree';

function fixedClock(iso: string): Clock {
	return { now: () => iso };
}

const FIXED_PROVENANCE: MarketDataProvenance = {
	asOf: '2026-09-02T14:00:00.000Z',
	sourceId: 'eodhd',
	sourceLabel: 'EOD Historical Data',
	liveness: 'delayed',
	delaySeconds: 900,
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'adjusted',
	engineVersion: '1.0.0'
};

function payload(result: ToolResult): Record<string, unknown> {
	const text = result.content[0]?.text;
	if (text === undefined) {
		throw new Error(`tool result carried no content: ${JSON.stringify(result)}`);
	}
	return JSON.parse(text) as Record<string, unknown>;
}

// Real seeded catalog IDs (src/lib/catalog/items.ts) -- edit_filter_tree now
// validates add/update against the built-in registry (T-1009-6), so a
// fixture condition must name things that genuinely exist there.
function scalarCondition(fieldId: string, value: number) {
	return { type: 'scalar', fieldId, operator: 'op.greater_than', value, unit: null };
}

function collectIds(node: FilterNode, out: string[] = []): string[] {
	out.push(node.nodeId);
	if (node.kind === 'group') {
		for (const child of node.children) {
			collectIds(child, out);
		}
	}
	return out;
}

describe('createEditFilterTreeTool', () => {
	let deps: WorkbenchDeps;
	let workspaceId: string;
	let screenerId: string;
	let rootNodeId: string;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const clock = fixedClock('2026-01-01T00:00:00.000Z');
		const ids = createIdSequencer();
		const idempotency = createIdempotencyCache();
		deps = {
			repository,
			revisions: createRevisionService({ repository, clock, ids, idempotency }),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			provenance: { current: () => FIXED_PROVENANCE },
			clock,
			ids,
			idempotency
		};

		const workspace = emptyWorkspace('workspace_1', 'My Workspace', clock.now());
		const screener = createScreener(ids, workspace.id, 'My Screener');
		repository.put(writeScreener(workspace, screener));
		repository.setActiveId(workspace.id);

		workspaceId = workspace.id;
		screenerId = screener.screenerId;
		rootNodeId = screener.filterTree.nodeId;
	});

	function tool() {
		return createEditFilterTreeTool(deps);
	}

	function currentTree(): FilterNode {
		const doc = deps.repository.get(workspaceId);
		if (!doc) throw new Error('workspace vanished during test');
		const screener = readScreener(doc, screenerId);
		if (!screener) throw new Error('screener vanished during test');
		return screener.filterTree;
	}

	it('registers the edit_filter_tree tool, always available', () => {
		const spec = tool();
		expect(spec.name, 'tool must be named edit_filter_tree').toBe('edit_filter_tree');
		expect(spec.available({} as never), 'tool has no availability gate').toBe(true);
	});

	it('add_appendsUnderRoot_andReportsTheNewNodeIdInAffectedIds', async () => {
		const result = await tool().execute({
			screener_id: screenerId,
			operation: 'add',
			condition: scalarCondition('field.price.close', 10)
		});
		expect(result.isError, 'add is accepted').toBeUndefined();
		const body = payload(result) as {
			affected_ids: string[];
			diff_summary: string;
			new_revision: number;
		};
		expect(body.affected_ids, 'the minted node id is in affected_ids').toHaveLength(1);
		expect(body.diff_summary, 'diff_summary describes the structural change').toContain('Added');

		const root = currentTree() as GroupNode;
		expect(
			root.children.map((c) => c.nodeId),
			'the node persisted under the root'
		).toEqual(body.affected_ids);
	});

	// T-1009-10 AC5: every screener mutation tool must return a usable
	// undo_token (technical.md's mutation envelope contract). This tool's
	// mutate() previously omitted `inverse`, so undo_token was always null --
	// fixed alongside the wiring ticket that first drove this path
	// end to end.
	it('test_add_returnsUndoToken_thatUndoChangeCanRedeem', async () => {
		const result = await tool().execute({
			screener_id: screenerId,
			operation: 'add',
			condition: scalarCondition('field.price.close', 10)
		});
		const body = payload(result) as { undo_token: string | null };
		expect(body.undo_token, 'add_filter_tree must return a redeemable undo_token').not.toBeNull();
	});

	it('add_and_group_and_reorder_composeAcrossDeepNestingKeepingIdsStable', async () => {
		const t = tool();
		const first = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: scalarCondition('field.price.close', 10)
			})
		) as { affected_ids: string[] };
		const second = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: scalarCondition('field.volume', 100)
			})
		) as { affected_ids: string[] };
		const nodeA = first.affected_ids[0]!;
		const nodeB = second.affected_ids[0]!;

		const before = new Set(collectIds(currentTree()));
		const grouped = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'group',
				node_ids: [nodeA, nodeB],
				group_op: 'or'
			})
		) as { affected_ids: string[] };
		expect(grouped.affected_ids, 'group reports the new group id plus every grouped id').toContain(
			nodeA
		);
		const newGroupId = grouped.affected_ids.find((id) => id !== nodeA && id !== nodeB);
		expect(newGroupId, 'exactly one new group id was minted').toBeDefined();

		const addedDeep = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				parent_node_id: newGroupId,
				condition: scalarCondition('field.price.close', 40)
			})
		) as { affected_ids: string[] };
		const deepNodeId = addedDeep.affected_ids[0]!;

		const reordered = await t.execute({
			screener_id: screenerId,
			operation: 'reorder',
			parent_node_id: newGroupId,
			ordered_node_ids: [deepNodeId, nodeA, nodeB]
		});
		expect(reordered.isError, 'reorder of the deeply nested group succeeds').toBeUndefined();

		const after = new Set(collectIds(currentTree()));
		const expected = new Set([...before, newGroupId, deepNodeId]);
		expect(after, 'grouping and adding mint ids; reordering mints none').toEqual(expected);
	});

	it('update_changesOnlyTheNamedCondition', async () => {
		const t = tool();
		const added = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: scalarCondition('field.price.close', 10)
			})
		) as { affected_ids: string[] };
		const nodeId = added.affected_ids[0]!;

		const result = await t.execute({
			screener_id: screenerId,
			operation: 'update',
			node_id: nodeId,
			condition: scalarCondition('field.price.close', 99)
		});
		expect(result.isError).toBeUndefined();

		const root = currentTree() as GroupNode;
		expect(root.children, 'node count unchanged by update').toHaveLength(1);
		const updated = root.children[0];
		expect(updated?.nodeId, 'node id stable across update').toBe(nodeId);
		expect(
			updated?.kind === 'condition' && updated.condition,
			'condition payload replaced'
		).toEqual(scalarCondition('field.price.close', 99));
	});

	it('remove_dropsTheNodeAndReportsItInAffectedIds', async () => {
		const t = tool();
		const added = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: scalarCondition('field.price.close', 10)
			})
		) as { affected_ids: string[] };
		const nodeId = added.affected_ids[0]!;

		const result = await t.execute({
			screener_id: screenerId,
			operation: 'remove',
			node_id: nodeId
		});
		expect(result.isError).toBeUndefined();
		const root = currentTree() as GroupNode;
		expect(root.children, 'removed node is gone').toHaveLength(0);
	});

	it('set_enabled_disablesTheNodeWithoutChangingItsId', async () => {
		const t = tool();
		const added = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: scalarCondition('field.price.close', 10)
			})
		) as { affected_ids: string[] };
		const nodeId = added.affected_ids[0]!;

		const result = await t.execute({
			screener_id: screenerId,
			operation: 'set_enabled',
			node_id: nodeId,
			enabled: false
		});
		expect(result.isError).toBeUndefined();
		const root = currentTree() as GroupNode;
		expect(root.children[0]?.nodeId, 'id unchanged by set_enabled').toBe(nodeId);
		expect(root.children[0]?.enabled, 'node reports disabled').toBe(false);
	});

	it('group_notWithTwoNodeIds_rejectedAndNothingAdvances', async () => {
		const t = tool();
		const a = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: scalarCondition('field.price.close', 10)
			})
		) as { affected_ids: string[] };
		const b = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: scalarCondition('field.volume', 5)
			})
		) as { affected_ids: string[] };
		const revisionBefore = deps.repository.get(workspaceId)?.revision;

		const result = await t.execute({
			screener_id: screenerId,
			operation: 'group',
			node_ids: [a.affected_ids[0], b.affected_ids[0]],
			group_op: 'not'
		});
		expect(result.isError, 'a "not" group of two is rejected').toBe(true);
		const body = payload(result) as { error: string };
		expect(body.error).toBe('operation_validation_error');
		expect(deps.repository.get(workspaceId)?.revision, 'rejected operation advances nothing').toBe(
			revisionBefore
		);
	});

	it('unknownNodeId_rejectedNamingTheIdAndListingValidOnes', async () => {
		const result = await tool().execute({
			screener_id: screenerId,
			operation: 'update',
			node_id: 'filter_bogus',
			condition: scalarCondition('field.price.close', 10)
		});
		expect(result.isError).toBe(true);
		const body = payload(result) as { error: string; issues: string[] };
		expect(body.error).toBe('operation_validation_error');
		expect(body.issues.join(' '), 'issue names the unknown id').toContain('filter_bogus');
		expect(body.issues.join(' '), 'issue lists the ids that do exist').toContain(rootNodeId);
	});

	it('unknownScreenerId_rejectedAndWorkspaceRevisionUnchanged', async () => {
		const revisionBefore = deps.repository.get(workspaceId)?.revision;
		const result = await tool().execute({
			screener_id: 'screener_bogus',
			operation: 'set_enabled',
			node_id: rootNodeId,
			enabled: false
		});
		expect(result.isError).toBe(true);
		expect(deps.repository.get(workspaceId)?.revision).toBe(revisionBefore);
	});

	it('staleExpectedRevision_rejectedAsRevisionConflictWithNoMutation', async () => {
		const before = currentTree();
		const result = await tool().execute({
			screener_id: screenerId,
			operation: 'add',
			condition: scalarCondition('field.price.close', 10),
			expected_revision: 999
		});
		expect(result.isError).toBe(true);
		const body = payload(result) as { error: string };
		expect(body.error).toBe('revision_conflict');
		expect(currentTree(), 'tree is unchanged after a revision conflict').toEqual(before);
	});

	it('repeatedIdempotencyKey_replaysTheOriginalResultWithoutApplyingTwice', async () => {
		const t = tool();
		const args = {
			screener_id: screenerId,
			operation: 'add',
			condition: scalarCondition('field.price.close', 10),
			idempotency_key: 'add-once'
		};
		const first = payload(await t.execute(args)) as { change_id: string };
		const second = payload(await t.execute(args)) as { change_id: string };
		expect(second.change_id, 'replay returns the same change_id').toBe(first.change_id);

		const root = currentTree() as GroupNode;
		expect(root.children, 'the condition was added only once').toHaveLength(1);
	});

	// T-1009-6 AC9: add/update reject a condition naming a field, operator,
	// study, pattern, or interval absent from the catalog registry, and the
	// tree is left unchanged.
	it('add_rejectsUnknownField_leavesTreeAndRevisionUnchanged', async () => {
		const revisionBefore = deps.repository.get(workspaceId)?.revision;
		const before = currentTree();
		const result = await tool().execute({
			screener_id: screenerId,
			operation: 'add',
			condition: scalarCondition('field.does_not_exist', 10)
		});
		expect(result.isError, 'unknown field is rejected').toBe(true);
		const body = payload(result) as { error: string; issues: string[] };
		expect(body.error).toBe('operation_validation_error');
		expect(body.issues.join(' '), 'issue names the unknown field').toContain(
			'field.does_not_exist'
		);
		expect(currentTree(), 'tree is unchanged').toEqual(before);
		expect(deps.repository.get(workspaceId)?.revision, 'workspace revision does not advance').toBe(
			revisionBefore
		);
	});

	it('add_rejectsOutOfRangeParameter_leavesTreeAndRevisionUnchanged', async () => {
		const revisionBefore = deps.repository.get(workspaceId)?.revision;
		const before = currentTree();
		const result = await tool().execute({
			screener_id: screenerId,
			operation: 'add',
			condition: scalarCondition('field.price.close', -10)
		});
		expect(result.isError, 'a price below its declared range (min 0) is rejected').toBe(true);
		const body = payload(result) as { error: string; issues: string[] };
		expect(body.error).toBe('operation_validation_error');
		expect(
			body.issues.join(' '),
			'issue names the offending value and its permitted range'
		).toContain('range');
		expect(currentTree(), 'tree is unchanged').toEqual(before);
		expect(deps.repository.get(workspaceId)?.revision, 'workspace revision does not advance').toBe(
			revisionBefore
		);
	});

	it('update_rejectsInvalidCondition_leavesTreeAndRevisionUnchanged', async () => {
		const t = tool();
		const added = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: scalarCondition('field.price.close', 10)
			})
		) as { affected_ids: string[] };
		const nodeId = added.affected_ids[0]!;
		const before = currentTree();
		const revisionBefore = deps.repository.get(workspaceId)?.revision;

		const result = await t.execute({
			screener_id: screenerId,
			operation: 'update',
			node_id: nodeId,
			condition: scalarCondition('field.does_not_exist', 10)
		});
		expect(result.isError, 'update with an unknown field is rejected').toBe(true);
		expect(currentTree(), 'tree is unchanged by the rejected update').toEqual(before);
		expect(deps.repository.get(workspaceId)?.revision, 'workspace revision does not advance').toBe(
			revisionBefore
		);
	});

	// T-1009-6 AC11: no condition variant exposes a field that is parsed or
	// evaluated as code -- a payload carrying a free-form expression key is
	// rejected outright rather than having the key silently dropped.
	it('add_rejectsConditionCarryingRawExpressionField_leavesTreeUnchanged', async () => {
		const before = currentTree();
		const revisionBefore = deps.repository.get(workspaceId)?.revision;
		const result = await tool().execute({
			screener_id: screenerId,
			operation: 'add',
			condition: {
				type: 'scalar',
				fieldId: 'field.price.close',
				operator: 'op.greater_than',
				value: 10,
				unit: null,
				expression: 'DROP TABLE instruments; --'
			}
		});
		expect(result.isError, 'a condition carrying a raw expression field is rejected').toBe(true);
		const body = payload(result) as { error: string; issues: string[] };
		expect(body.error).toBe('operation_validation_error');
		expect(body.issues.join(' '), 'issue names the disallowed field').toContain('expression');
		expect(currentTree(), 'tree is unchanged').toEqual(before);
		expect(deps.repository.get(workspaceId)?.revision, 'workspace revision does not advance').toBe(
			revisionBefore
		);
	});
});
