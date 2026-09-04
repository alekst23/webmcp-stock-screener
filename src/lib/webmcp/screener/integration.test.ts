// End-to-end coverage of the screener group driven entirely through
// buildScreenerTools' built specs, exactly as an agent would call them
// (T-1009-10 AC3, AC4, AC5; narrowed to define_screener + run_screener by
// T-0026-5). Follows webmcp/integration.test.ts's pattern: call by tool
// name, parse the JSON payload, assert on the wire shape.
//
// T-0026-5: this used to drive create_screener -> set_screener_universe ->
// edit_filter_tree (x3) -> set_screener_ranking -> validate_screener, none
// of which the screener group builds any more (define_screener absorbs all
// of it in one call -- see group.ts's own comment). "Further edits after a
// run" (AC4) and "undo" (AC5) are now a second define_screener call
// (full-replace) rather than an edit_filter_tree node mutation, but the
// guarantee under test -- a run never changes after later edits, and a
// screener mutation is undoable -- is unchanged.
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
import { emptyWorkspace } from '../../workbench/domain/workspace';
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

describe('define_screener + run_screener, driven end to end', () => {
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
		// define_screener (unlike the old create_screener) requires an existing
		// workspace document -- it fails "not_found" rather than minting one.
		deps.repository.put(emptyWorkspace(workspaceId, 'Test Workspace', clock.now()));
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

	// One define_screener call: universe, the same nested filter tree the
	// old five-call sequence built (A: close > 50, AND a group OR [B: volume
	// in range, C: close > 95]), ranking, and limit, all together --
	// define_screener validates in the same step (AC1/AC4), so the result
	// is already the "clean screener" the old separate validate_screener
	// call used to confirm.
	async function buildValidatedScreener(): Promise<{ screenerId: string }> {
		const defined = await call('define_screener', {
			name: 'Momentum Screener',
			universe: { asset_class: 'equity' },
			conditions: {
				kind: 'group',
				op: 'and',
				children: [
					scalarCondition('field.price.close', 'op.greater_than', 50),
					{
						kind: 'group',
						op: 'or',
						children: [
							rangeCondition('field.volume', 1_000_000, 10_000_000),
							scalarCondition('field.price.close', 'op.greater_than', 95)
						]
					}
				]
			},
			ranking: { fields: [{ field_id: 'field.price.close', direction: 'desc' }] },
			limit: 2
		});
		expect(
			defined.valid,
			`expected a clean screener definition to validate: ${JSON.stringify(defined)}`
		).toBe(true);
		const screenerId = defined.screener_id as string;
		if (!screenerId) {
			throw new Error('define_screener returned no screener id.');
		}
		return { screenerId };
	}

	it('test_fullSequence_defineUniverseFiltersRankingRun_returnsPinnedRunWithProvenance', async () => {
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

	it('test_runReadBack_afterFurtherScreenerRedefinition_stillDescribesExecutedRevision', async () => {
		const { screenerId } = await buildValidatedScreener();
		const run = await call('run_screener', { screener_id: screenerId });
		const runId = run.run_id as string;
		const executedRevision = run.screener_revision;

		// AC4: redefine the screener again after the run -- define_screener's
		// full-replace semantics (drop condition A, keep only the OR group) --
		// the counterpart to the old edit_filter_tree mutation this test used
		// to make.
		const redefined = await call('define_screener', {
			screener_id: screenerId,
			universe: { asset_class: 'equity' },
			conditions: {
				kind: 'group',
				op: 'or',
				children: [
					rangeCondition('field.volume', 1_000_000, 10_000_000),
					scalarCondition('field.price.close', 'op.greater_than', 95)
				]
			},
			ranking: { fields: [{ field_id: 'field.price.close', direction: 'desc' }] },
			limit: 2
		});
		expect(
			redefined.screener_revision,
			'the redefinition should have actually advanced the screener revision'
		).not.toBe(executedRevision);

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

	it('test_undoScreenerRedefinition_withReturnedUndoToken_restoresPriorScreenerDefinition', async () => {
		const { screenerId } = await buildValidatedScreener();

		const before = readScreener(deps.repository.get(workspaceId)!, screenerId);
		expect(before, 'the screener must exist before the mutation under test').toBeTruthy();
		const beforeRevision = before!.revision;

		// A drastically different redefinition -- the counterpart to the old
		// edit_filter_tree "disable a node" mutation this test used to make.
		const redefined = await call('define_screener', {
			screener_id: screenerId,
			universe: { asset_class: 'equity' },
			conditions: scalarCondition('field.price.close', 'op.greater_than', 999),
			limit: 1
		});
		const undoToken = redefined.undo_token as string;
		expect(undoToken, 'AC5: a screener mutation must return an undo_token').toBeTruthy();

		const afterRedefine = readScreener(deps.repository.get(workspaceId)!, screenerId);
		expect(
			afterRedefine?.revision,
			'the mutation under test must actually have advanced the screener revision'
		).toBe(beforeRevision + 1);

		const undoTool = buildWorkbenchTools(deps).find((t) => t.name === 'undo_change');
		expect(undoTool, 'the workbench undo_change tool should be registered').toBeDefined();
		const undoResult = await undoTool!.execute({ undo_token: undoToken });
		expect(undoResult.isError, `undo_change failed: ${JSON.stringify(undoResult)}`).toBeFalsy();

		const afterUndo = readScreener(deps.repository.get(workspaceId)!, screenerId);
		expect(
			afterUndo?.revision,
			'AC5: undo must restore the prior definition, at the prior revision'
		).toBe(beforeRevision);
	});
});
