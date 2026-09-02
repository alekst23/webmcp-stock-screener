import { beforeEach, describe, expect, it } from 'vitest';
import { createCreateScreenerTool } from '../../../webmcp/screener/createScreener';
import { createSetScreenerUniverseTool } from '../../../webmcp/screener/setScreenerUniverse';
import { createSetScreenerRankingTool } from '../../../webmcp/screener/setScreenerRanking';
import type { ToolResult } from '../../../webmcp/types';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import type { WorkbenchDeps } from '../../tools/index';
import type { BacktestApiPort, BacktestStartWireRequest } from '../domain/apiPort';
import { createBacktestScreenerTool } from './backtestScreener';

function jsonOf(result: ToolResult): Record<string, unknown> {
	const first = result.content[0];
	if (!first) {
		throw new Error('ToolResult carried no content.');
	}
	return JSON.parse(first.text) as Record<string, unknown>;
}

function fixedClock(iso: string): Clock {
	return { now: () => iso };
}

interface FakeApi {
	api: BacktestApiPort;
	calls: BacktestStartWireRequest[];
}

// Assigns a distinct backtest_id per call -- proves whether the tool
// actually asked for a fresh evaluation (AC4/AC11's tests both hinge on
// telling "one call" from "two calls" apart, which a fixed id could hide).
function makeFakeApi(): FakeApi {
	const calls: BacktestStartWireRequest[] = [];
	let seq = 0;
	const api: BacktestApiPort = {
		async start(request) {
			calls.push(request);
			seq += 1;
			return { backtestId: `backtest_${seq}`, status: 'running' };
		},
		async getResults() {
			throw new Error('not used by backtestScreener tests');
		}
	};
	return { api, calls };
}

const BASE_INPUT = { from_date: '2024-01-01', to_date: '2024-06-01', horizons: [5] };

describe('backtest_screener', () => {
	let deps: WorkbenchDeps;

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
			provenance: { current: () => ({}) as never },
			clock,
			ids,
			idempotency
		};
	});

	async function seedScreener(): Promise<{ workspaceId: string; screenerId: string }> {
		const workspaceId = deps.ids.next('workspace');
		const created = jsonOf(
			await createCreateScreenerTool(deps).execute({
				workspace_id: workspaceId,
				name: 'Test Screener'
			})
		) as { affected_ids: string[] };
		const screenerId = created.affected_ids[0];
		if (!screenerId) {
			throw new Error('create_screener did not return a screener id.');
		}
		deps.repository.setActiveId(workspaceId);
		return { workspaceId, screenerId };
	}

	async function bumpScreenerRevision(workspaceId: string, screenerId: string): Promise<void> {
		const result = jsonOf(
			await createSetScreenerRankingTool(deps).execute({
				workspace_id: workspaceId,
				screener_id: screenerId,
				fields: [{ field_id: 'field.volume' }]
			})
		);
		if (result.error) {
			throw new Error(`set_screener_ranking failed: ${JSON.stringify(result)}`);
		}
	}

	it('returns the mutation envelope plus backtest_id and status without blocking', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const { api } = makeFakeApi();
		const tool = createBacktestScreenerTool({ repository: deps.repository, ids: deps.ids, api });

		const result = await tool.execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			...BASE_INPUT
		});
		const json = jsonOf(result);

		expect(result.isError).toBeFalsy();
		expect(json.backtest_id).toBe('backtest_1');
		expect(json.status).toBe('running');
		expect(typeof json.change_id).toBe('string');
		expect(json.affected_ids).toEqual([screenerId]);
		expect(json.undo_token).toBeNull();
	});

	it('AC4: pins to the revision requested, ignoring a later edit to the current screener', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const { api, calls } = makeFakeApi();
		const tool = createBacktestScreenerTool({ repository: deps.repository, ids: deps.ids, api });

		// First backtest, against revision 1 (the screener's only revision so far).
		await tool.execute({ workspace_id: workspaceId, screener_id: screenerId, ...BASE_INPUT });
		expect(calls[0]?.revision, 'expected the first call to pin revision 1').toBe(1);

		// Edit the screener -- its current revision advances to 2.
		await bumpScreenerRevision(workspaceId, screenerId);

		// A second backtest explicitly asking for the original revision must
		// still get revision 1, not the screener's new current revision.
		await tool.execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			screener_revision: 1,
			...BASE_INPUT
		});

		expect(calls[1]?.revision, 'a pinned past revision must not follow the later edit').toBe(1);
	});

	it('a request with no explicit screener_revision picks up the current revision', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		await bumpScreenerRevision(workspaceId, screenerId);
		const { api, calls } = makeFakeApi();
		const tool = createBacktestScreenerTool({ repository: deps.repository, ids: deps.ids, api });

		await tool.execute({ workspace_id: workspaceId, screener_id: screenerId, ...BASE_INPUT });

		expect(calls[0]?.revision).toBe(2);
	});

	it('AC11: a repeated idempotency_key returns the same backtest_id without a second start() call', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const { api, calls } = makeFakeApi();
		const tool = createBacktestScreenerTool({ repository: deps.repository, ids: deps.ids, api });
		const input = {
			workspace_id: workspaceId,
			screener_id: screenerId,
			idempotency_key: 'key-1',
			...BASE_INPUT
		};

		const first = jsonOf(await tool.execute(input));
		const second = jsonOf(await tool.execute(input));

		expect(calls.length, 'expected exactly one start() call despite two tool invocations').toBe(1);
		expect(second.backtest_id).toBe(first.backtest_id);
	});

	it('a different idempotency_key starts a second, independent evaluation', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const { api, calls } = makeFakeApi();
		const tool = createBacktestScreenerTool({ repository: deps.repository, ids: deps.ids, api });

		const first = jsonOf(
			await tool.execute({
				workspace_id: workspaceId,
				screener_id: screenerId,
				idempotency_key: 'key-1',
				...BASE_INPUT
			})
		);
		const second = jsonOf(
			await tool.execute({
				workspace_id: workspaceId,
				screener_id: screenerId,
				idempotency_key: 'key-2',
				...BASE_INPUT
			})
		);

		expect(calls.length).toBe(2);
		expect(second.backtest_id).not.toBe(first.backtest_id);
	});

	it('rejects a mismatched expected_revision without calling start()', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const { api, calls } = makeFakeApi();
		const tool = createBacktestScreenerTool({ repository: deps.repository, ids: deps.ids, api });

		const result = await tool.execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			expected_revision: 999,
			...BASE_INPUT
		});

		expect(result.isError).toBeTruthy();
		expect(calls.length, 'a revision conflict must never start an evaluation').toBe(0);
	});

	it('rejects an empty horizons array without calling start()', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const { api, calls } = makeFakeApi();
		const tool = createBacktestScreenerTool({ repository: deps.repository, ids: deps.ids, api });

		const result = await tool.execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			from_date: '2024-01-01',
			to_date: '2024-06-01',
			horizons: []
		});

		expect(result.isError).toBeTruthy();
		expect(calls.length).toBe(0);
	});

	it('surfaces a translation warning when the universe uses a criterion the backend cannot represent', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		await createSetScreenerUniverseTool(deps).execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			sectors: ['technology']
		});
		const { api } = makeFakeApi();
		const tool = createBacktestScreenerTool({ repository: deps.repository, ids: deps.ids, api });

		const result = jsonOf(
			await tool.execute({ workspace_id: workspaceId, screener_id: screenerId, ...BASE_INPUT })
		);

		expect(result.warnings, JSON.stringify(result)).toEqual(
			expect.arrayContaining([expect.stringContaining('universe.sectors')])
		);
	});

	it('reports not_found for an unknown screener_id', async () => {
		const { workspaceId } = await seedScreener();
		const { api, calls } = makeFakeApi();
		const tool = createBacktestScreenerTool({ repository: deps.repository, ids: deps.ids, api });

		const result = await tool.execute({
			workspace_id: workspaceId,
			screener_id: 'screener_does_not_exist',
			...BASE_INPUT
		});

		expect(result.isError).toBeTruthy();
		expect(calls.length).toBe(0);
	});
});
