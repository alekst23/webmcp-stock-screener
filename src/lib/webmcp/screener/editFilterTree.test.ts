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

function scalarCondition(fieldId: string, value: number) {
	return { type: 'scalar', fieldId, operator: 'gt', value, unit: null };
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
			condition: scalarCondition('price', 10)
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

	it('add_and_group_and_reorder_composeAcrossDeepNestingKeepingIdsStable', async () => {
		const t = tool();
		const first = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: scalarCondition('price', 10)
			})
		) as { affected_ids: string[] };
		const second = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: scalarCondition('volume', 100)
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
				condition: scalarCondition('rsi', 40)
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
				condition: scalarCondition('price', 10)
			})
		) as { affected_ids: string[] };
		const nodeId = added.affected_ids[0]!;

		const result = await t.execute({
			screener_id: screenerId,
			operation: 'update',
			node_id: nodeId,
			condition: scalarCondition('price', 99)
		});
		expect(result.isError).toBeUndefined();

		const root = currentTree() as GroupNode;
		expect(root.children, 'node count unchanged by update').toHaveLength(1);
		const updated = root.children[0];
		expect(updated?.nodeId, 'node id stable across update').toBe(nodeId);
		expect(
			updated?.kind === 'condition' && updated.condition,
			'condition payload replaced'
		).toEqual(scalarCondition('price', 99));
	});

	it('remove_dropsTheNodeAndReportsItInAffectedIds', async () => {
		const t = tool();
		const added = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: scalarCondition('price', 10)
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
				condition: scalarCondition('price', 10)
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
				condition: scalarCondition('price', 10)
			})
		) as { affected_ids: string[] };
		const b = payload(
			await t.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: scalarCondition('volume', 5)
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
			condition: scalarCondition('price', 10)
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
			condition: scalarCondition('price', 10),
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
			condition: scalarCondition('price', 10),
			idempotency_key: 'add-once'
		};
		const first = payload(await t.execute(args)) as { change_id: string };
		const second = payload(await t.execute(args)) as { change_id: string };
		expect(second.change_id, 'replay returns the same change_id').toBe(first.change_id);

		const root = currentTree() as GroupNode;
		expect(root.children, 'the condition was added only once').toHaveLength(1);
	});
});
