// End-to-end coverage of the six screener tools driven entirely through
// buildScreenerTools' built specs, exactly as an agent would call them
// (T-1009-10 AC3, AC4, AC5). Follows webmcp/integration.test.ts's pattern:
// call by tool name, parse the JSON payload, assert on the wire shape.
//
// AC3's in-test fake ScreenerMarketData is a small fixed fixture (five
// instruments, two fields) -- not a fixture dataset module -- matching
// engine.test.ts's own convention for driving the real evaluation engine
// without a real data source.

import { beforeEach, describe, expect, it } from 'vitest';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createOperationRegistry } from '../../workbench/application/operationRegistry';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import type { Clock } from '../../workbench/domain/ports';
import { makeProvenance } from '../../workbench/domain/provenance';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import { buildWorkbenchTools } from '../../workbench/tools/index';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import { readScreener } from '../../screener/state';
import { createPinnedRunStore } from '../../screener/runStore';
import type { ScreenerMarketData } from '../../screener/ports';
import type { ToolResult, ToolSpec } from '../types';
import { buildScreenerTools } from './group';

function fixedClock(iso: string): Clock {
	return { now: () => iso };
}

// AC3's fixed fixture: five instruments, a close price and a volume each.
// The filter tree built below is: root AND [ A: close > 50, G1: OR [
// B: volume in [1e6, 1e7], C: close > 95 ] ]. Matched set: I1 (close 100,
// volume 2M -- A and B), I3 (close 60, volume 3M -- A and B), I5 (close 80,
// volume 1.8M -- A and B). I2 (close 90, volume 500) fails B and C. I4
// (close 40) fails A. Ranked by close descending with limit 2: I1, I5
// returned; I3 truncated out.
const CLOSE_BY_INSTRUMENT: Record<string, number> = {
	I1: 100,
	I2: 90,
	I3: 60,
	I4: 40,
	I5: 80
};
const VOLUME_BY_INSTRUMENT: Record<string, number> = {
	I1: 2_000_000,
	I2: 500,
	I3: 3_000_000,
	I4: 5_000_000,
	I5: 1_800_000
};
const UNIVERSE_IDS = Object.keys(CLOSE_BY_INSTRUMENT);

function fixtureMarketData(): ScreenerMarketData {
	return {
		async resolveUniverse() {
			return [...UNIVERSE_IDS];
		},
		async getFieldValue(instrumentId, fieldId) {
			if (fieldId === 'field.price.close') return CLOSE_BY_INSTRUMENT[instrumentId] ?? null;
			if (fieldId === 'field.volume') return VOLUME_BY_INSTRUMENT[instrumentId] ?? null;
			return null;
		},
		async getSeries() {
			return [];
		},
		async detectPattern() {
			return null;
		},
		async getStudyOutput() {
			return null;
		},
		async getProvenance() {
			return makeProvenance({
				asOf: '2026-06-01T20:00:00.000Z',
				sourceId: 'src.test.integration_fixture',
				sourceLabel: 'Integration test fixture',
				liveness: 'end_of_day',
				timezone: 'America/New_York'
			});
		}
	};
}

function scalarCondition(fieldId: string, operator: string, value: number) {
	return { type: 'scalar', fieldId, operator, value, unit: null };
}

function rangeCondition(fieldId: string, lower: number, upper: number) {
	return {
		type: 'range',
		fieldId,
		lower,
		upper,
		lowerInclusive: true,
		upperInclusive: true
	};
}

function jsonOf(result: ToolResult): Record<string, unknown> {
	const first = result.content[0];
	if (!first) {
		throw new Error('ToolResult carried no content.');
	}
	return JSON.parse(first.text) as Record<string, unknown>;
}

describe('the six screener tools, driven end to end', () => {
	let deps: WorkbenchDeps;
	let workspaceId: string;
	let tools: ToolSpec[];
	let runStore: ReturnType<typeof createPinnedRunStore>;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const clock = fixedClock('2026-06-01T20:00:00.000Z');
		const ids = createIdSequencer();
		const idempotency = createIdempotencyCache();
		deps = {
			repository,
			revisions: createRevisionService({ repository, clock, ids, idempotency }),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			provenance: {
				current: () =>
					makeProvenance({
						asOf: clock.now(),
						sourceId: 'not_configured',
						sourceLabel: 'No market-data source configured',
						liveness: 'static',
						timezone: 'America/New_York'
					})
			},
			clock,
			ids,
			idempotency
		};
		workspaceId = ids.next('workspace');
		deps.repository.setActiveId(workspaceId);
		runStore = createPinnedRunStore();
		tools = buildScreenerTools({ ...deps, marketData: fixtureMarketData(), runStore });
	});

	function toolNamed(name: string): ToolSpec {
		const spec = tools.find((t) => t.name === name);
		if (!spec) {
			throw new Error(`the screener group did not expose "${name}"`);
		}
		return spec;
	}

	async function call(name: string, input: unknown): Promise<Record<string, unknown>> {
		const tool = toolNamed(name);
		const result = await tool.execute(input);
		expect(result.isError, `${name} failed: ${JSON.stringify(result)}`).toBeFalsy();
		return jsonOf(result);
	}

	// Runs the full create -> universe -> filters -> ranking -> validate
	// sequence and returns the ids an AC3/AC4/AC5 test needs, without
	// executing the run itself (each test below decides when to run).
	async function buildValidatedScreener(): Promise<{
		screenerId: string;
		nodeA: string;
		groupNode: string;
	}> {
		const created = await call('create_screener', { name: 'Momentum Screener' });
		const screenerId = (created.affected_ids as string[])[0];
		if (!screenerId) {
			throw new Error('create_screener returned no screener id.');
		}

		await call('set_screener_universe', { screener_id: screenerId, asset_class: 'equity' });

		const addA = await call('edit_filter_tree', {
			screener_id: screenerId,
			operation: 'add',
			condition: scalarCondition('field.price.close', 'op.greater_than', 50)
		});
		const nodeA = (addA.affected_ids as string[])[0];
		const addB = await call('edit_filter_tree', {
			screener_id: screenerId,
			operation: 'add',
			condition: rangeCondition('field.volume', 1_000_000, 10_000_000)
		});
		const nodeB = (addB.affected_ids as string[])[0];
		const addC = await call('edit_filter_tree', {
			screener_id: screenerId,
			operation: 'add',
			condition: scalarCondition('field.price.close', 'op.greater_than', 95)
		});
		const nodeC = (addC.affected_ids as string[])[0];
		if (!nodeA || !nodeB || !nodeC) {
			throw new Error('edit_filter_tree did not return the expected node ids.');
		}

		const grouped = await call('edit_filter_tree', {
			screener_id: screenerId,
			operation: 'group',
			node_ids: [nodeB, nodeC],
			group_op: 'or'
		});
		const groupNode = (grouped.affected_ids as string[])[0];
		if (!groupNode) {
			throw new Error('edit_filter_tree group did not return a group node id.');
		}

		await call('set_screener_ranking', {
			screener_id: screenerId,
			fields: [{ field_id: 'field.price.close', direction: 'desc' }],
			limit: 2
		});

		const validation = await call('validate_screener', { screener_id: screenerId });
		expect(
			validation.valid,
			`expected a clean screener to validate: ${JSON.stringify(validation)}`
		).toBe(true);
		expect(validation.problems, 'a clean screener should report no problems at all').toEqual([]);

		return { screenerId, nodeA, groupNode };
	}

	it('test_fullSequence_createUniverseFiltersRankingValidateRun_returnsPinnedRunWithProvenance', async () => {
		const { screenerId } = await buildValidatedScreener();

		const run = await call('run_screener', { screener_id: screenerId });

		expect(typeof run.run_id, 'AC3: a completed run must carry a stable run_id').toBe('string');
		expect(run.status, 'a valid screener with matches completes').toBe('complete');
		expect(run.universe_count, 'AC3: five fixture instruments make up the universe').toBe(5);
		expect(
			run.matched_count,
			'AC3: I1, I3 and I5 satisfy close > 50 AND (volume in range OR close > 95)'
		).toBe(3);
		expect(run.returned_count, 'AC3: the ranking limit of 2 bounds the returned matches').toBe(2);
		expect(run.truncated, 'returned_count (2) < matched_count (3) must report truncated').toBe(
			true
		);
		const matches = run.matches as { instrument_id: string }[];
		expect(
			matches.map((m) => m.instrument_id),
			'expected descending order by close price, limited to 2: I1 (100), I5 (80)'
		).toEqual(['I1', 'I5']);

		const provenance = run.provenance as Record<string, unknown>;
		for (const field of ['as_of', 'source_id', 'liveness', 'timezone', 'engine_version']) {
			expect(provenance[field], `AC3: run provenance must carry "${field}"`).toBeTruthy();
		}
	});

	it('test_runReadBack_afterFurtherScreenerEdits_stillDescribesExecutedRevision', async () => {
		const { screenerId, nodeA } = await buildValidatedScreener();
		const run = await call('run_screener', { screener_id: screenerId });
		const runId = run.run_id as string;
		const executedRevision = run.screener_revision;

		// AC4: edit the screener again after the run.
		const disable = await call('edit_filter_tree', {
			screener_id: screenerId,
			operation: 'set_enabled',
			node_id: nodeA,
			enabled: false
		});
		expect(
			(disable.affected_ids as string[])[0],
			'the follow-up edit should have actually changed the screener'
		).toBe(nodeA);

		// AC4's read-back tool is EPIC-1010's get_screener_results, out of
		// scope here; PinnedRunStore.getRun is the same read that tool would
		// perform, so reading directly through it exercises the same
		// guarantee this ticket owns.
		const stored = runStore.getRun(runId);
		expect('available' in stored, 'AC4: the pinned run must still be retrievable').toBe(false);
		if ('available' in stored) {
			throw new Error(`run ${runId} unexpectedly unavailable: ${JSON.stringify(stored)}`);
		}
		expect(
			stored.screenerRevision,
			'AC4: the run must still describe the revision it executed, not the edited one'
		).toBe(executedRevision);
		expect(
			stored.matches.map((m) => m.instrumentId),
			'AC4: an edit after the run must not change what the run reports'
		).toEqual((run.matches as { instrument_id: string }[]).map((m) => m.instrument_id));
	});

	it('test_undoScreenerMutation_withReturnedUndoToken_restoresPriorScreenerState', async () => {
		const { screenerId, nodeA } = await buildValidatedScreener();

		const before = readScreener(deps.repository.get(workspaceId)!, screenerId);
		expect(before, 'the screener must exist before the mutation under test').toBeTruthy();
		const beforeNode = before!.filterTree.kind === 'group' ? before!.filterTree.children[0] : null;
		expect(
			beforeNode?.nodeId,
			'expected nodeA to be the first root child before the mutation'
		).toBe(nodeA);
		expect(beforeNode?.enabled, 'nodeA must start enabled').toBe(true);

		const disable = await call('edit_filter_tree', {
			screener_id: screenerId,
			operation: 'set_enabled',
			node_id: nodeA,
			enabled: false
		});
		const undoToken = disable.undo_token as string;
		expect(undoToken, 'AC5: a screener mutation must return an undo_token').toBeTruthy();

		const afterDisable = readScreener(deps.repository.get(workspaceId)!, screenerId);
		const disabledNode =
			afterDisable!.filterTree.kind === 'group' ? afterDisable!.filterTree.children[0] : null;
		expect(disabledNode?.enabled, 'the mutation under test must actually have disabled nodeA').toBe(
			false
		);

		const undoTool = buildWorkbenchTools(deps).find((t) => t.name === 'undo_change');
		expect(undoTool, 'the workbench undo_change tool should be registered').toBeDefined();
		const undoResult = await undoTool!.execute({ undo_token: undoToken });
		expect(undoResult.isError, `undo_change failed: ${JSON.stringify(undoResult)}`).toBeFalsy();

		const afterUndo = readScreener(deps.repository.get(workspaceId)!, screenerId);
		const restoredNode =
			afterUndo!.filterTree.kind === 'group' ? afterUndo!.filterTree.children[0] : null;
		expect(restoredNode?.nodeId, 'AC5: undo must restore the same node, not a new one').toBe(nodeA);
		expect(restoredNode?.enabled, 'AC5: undoing the disable must restore nodeA to enabled').toBe(
			true
		);
	});
});
