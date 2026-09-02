import { describe, expect, it } from 'vitest';
import type { ToolResult } from '../../../webmcp/types';
import { BacktestApiError, type BacktestApiPort } from '../domain/apiPort';
import { createGetBacktestResultsTool } from './getBacktestResults';

function jsonOf(result: ToolResult): Record<string, unknown> {
	const first = result.content[0];
	if (!first) {
		throw new Error('ToolResult carried no content.');
	}
	return JSON.parse(first.text) as Record<string, unknown>;
}

// A counting fake that only ever reads -- proves this tool has no code
// path capable of starting or re-starting an evaluation (AC5/AC12), the
// same structural argument PinnedRunStore relies on for run_screener.
// `calls` is a mutable object read by reference after execute() runs, not
// destructured -- a destructured getter would snapshot 0 before any call.
function makeFakeApi(
	handler: (
		backtestId: string,
		offset?: number,
		limit?: number
	) => Awaited<ReturnType<BacktestApiPort['getResults']>>
): { api: BacktestApiPort; calls: { start: number; getResults: number } } {
	const calls = { start: 0, getResults: 0 };
	const api: BacktestApiPort = {
		async start() {
			calls.start += 1;
			throw new Error('get_backtest_results must never call start()');
		},
		async getResults(backtestId, offset, limit) {
			calls.getResults += 1;
			return handler(backtestId, offset, limit);
		}
	};
	return { api, calls };
}

describe('get_backtest_results', () => {
	it('requires a non-empty backtest_id', async () => {
		const { api } = makeFakeApi(() => {
			throw new Error('should not be called');
		});
		const tool = createGetBacktestResultsTool({ api });

		const result = await tool.execute({});

		expect(result.isError).toBeTruthy();
	});

	it('AC6: passes through a running status with progress, never a result', async () => {
		const { api } = makeFakeApi(() => ({
			status: 'running',
			backtestId: 'backtest_1',
			progress: {
				startedAt: '2024-01-01T00:00:00Z',
				elapsedSeconds: 2.5,
				message: 'Evaluation in progress.'
			}
		}));
		const tool = createGetBacktestResultsTool({ api });

		const json = jsonOf(await tool.execute({ backtest_id: 'backtest_1' }));

		expect(json.status).toBe('running');
		expect(json.result).toBeUndefined();
		expect(json.progress).toEqual({
			started_at: '2024-01-01T00:00:00Z',
			elapsed_seconds: 2.5,
			message: 'Evaluation in progress.'
		});
	});

	it('AC7: passes through a failed status with the reason', async () => {
		const { api } = makeFakeApi(() => ({
			status: 'failed',
			backtestId: 'backtest_1',
			error: 'not enough history'
		}));
		const tool = createGetBacktestResultsTool({ api });

		const json = jsonOf(await tool.execute({ backtest_id: 'backtest_1' }));

		expect(json.status).toBe('failed');
		expect(json.error).toBe('not enough history');
	});

	it('passes through a completed result unmodified', async () => {
		const resultPayload = { revision: 1, match_frequency: [], warnings: ['zero_matches'] };
		const { api } = makeFakeApi(() => ({
			status: 'completed',
			backtestId: 'backtest_1',
			result: resultPayload
		}));
		const tool = createGetBacktestResultsTool({ api });

		const json = jsonOf(await tool.execute({ backtest_id: 'backtest_1' }));

		expect(json.status).toBe('completed');
		expect(json.result).toEqual(resultPayload);
	});

	it('forwards offset/limit to the port for pagination', async () => {
		let seenOffset: number | undefined;
		let seenLimit: number | undefined;
		const { api } = makeFakeApi((_id, offset, limit) => {
			seenOffset = offset;
			seenLimit = limit;
			return { status: 'completed', backtestId: 'backtest_1', result: {} };
		});
		const tool = createGetBacktestResultsTool({ api });

		await tool.execute({ backtest_id: 'backtest_1', offset: 10, limit: 5 });

		expect(seenOffset).toBe(10);
		expect(seenLimit).toBe(5);
	});

	it('AC8: an unknown/expired backtest_id is rejected, saying so, without starting anything', async () => {
		const { api } = makeFakeApi(() => {
			throw new BacktestApiError('not_found', 'Backtest backtest_1 is no longer retained.', {
				notFoundReason: 'evicted'
			});
		});
		const tool = createGetBacktestResultsTool({ api });

		const result = await tool.execute({ backtest_id: 'backtest_1' });
		const json = jsonOf(result);

		expect(result.isError).toBeTruthy();
		expect(json.reason).toBe('not_found');
		expect(json.message).toContain('no longer retained');
	});

	it('never calls start(), even across several reads', async () => {
		const { api, calls } = makeFakeApi(() => ({
			status: 'completed',
			backtestId: 'backtest_1',
			result: {}
		}));
		const tool = createGetBacktestResultsTool({ api });

		await tool.execute({ backtest_id: 'backtest_1' });
		await tool.execute({ backtest_id: 'backtest_1' });

		expect(calls.start).toBe(0);
		expect(calls.getResults).toBe(2);
	});
});
