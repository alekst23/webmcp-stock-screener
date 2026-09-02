// AC1, AC2, AC3: the thirteen follow-up tools are registered, discoverable
// with a description and schema, and availability reflects workspace state
// rather than failing opaquely.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import type { SimilarityApiPort } from '../../similarity/domain/apiPort';
import type { BacktestApiPort } from '../../backtest/domain/apiPort';
import { memoryStorage } from '../../testSupport';
import {
	buildAllFollowupTools,
	createDefaultFollowupSurfaceRuntime,
	type FollowupSurfaceRuntime
} from './registerAllFollowupTools';

const THIRTEEN_TOOL_NAMES = [
	'refine_similarity_search',
	'derive_filters_from_setup',
	'create_computed_field',
	'create_custom_study',
	'backtest_screener',
	'get_backtest_results',
	'upsert_watchlist',
	'save_results_to_watchlist',
	'create_alert_draft',
	'preview_alert',
	'enable_alert',
	'disable_alert',
	'export_results'
];

function jsonOf(result: ToolResult): Record<string, unknown> {
	return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

// A backend-free fixture: never resolves a real run, but is enough to prove
// the surface builds and to exercise refine_similarity_search's own
// not-found path without needing a live HTTP backend.
function stubSimilarityApi(): SimilarityApiPort {
	return {
		async search() {
			throw new Error('not used in this test');
		},
		async getRun() {
			throw new Error('not used in this test');
		},
		async explain() {
			throw new Error('not used in this test');
		}
	};
}

function stubBacktestApi(): BacktestApiPort {
	return {
		async start() {
			throw new Error('not used in this test');
		},
		async getResults() {
			throw new Error('not used in this test');
		}
	};
}

function buildRuntime(): FollowupSurfaceRuntime {
	return createDefaultFollowupSurfaceRuntime({
		storage: memoryStorage(),
		similarityApi: stubSimilarityApi(),
		backtestApi: stubBacktestApi()
	});
}

describe('registerAllFollowupTools: AC1/AC3 -- discoverable surface', () => {
	let tools: ToolSpec[];

	beforeEach(() => {
		tools = buildAllFollowupTools(buildRuntime());
	});

	it('registers all thirteen named follow-up tools', () => {
		const names = new Set(tools.map((t) => t.name));
		for (const name of THIRTEEN_TOOL_NAMES) {
			expect(names.has(name), `expected ${name} to be registered`).toBe(true);
		}
	});

	it('every registered tool has a non-trivial description and an object input schema', () => {
		expect(tools.length).toBeGreaterThanOrEqual(THIRTEEN_TOOL_NAMES.length);
		for (const tool of tools) {
			expect(tool.description.length, `${tool.name} description too short`).toBeGreaterThan(40);
			expect(tool.inputSchema, `${tool.name} has no inputSchema`).toBeTruthy();
			expect((tool.inputSchema as { type?: string }).type).toBe('object');
		}
	});

	it('no tool name collides -- every name is unique', () => {
		const names = tools.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
	});
});

describe('registerAllFollowupTools: AC2 -- availability reflects workspace state', () => {
	let runtime: FollowupSurfaceRuntime;
	let byName: Map<string, ToolSpec>;

	beforeEach(() => {
		runtime = buildRuntime();
		byName = new Map(buildAllFollowupTools(runtime).map((t) => [t.name, t]));
	});

	it('backtest_screener is unavailable with no screener in the workspace', async () => {
		const result = await byName.get('backtest_screener')!.execute({
			screener_id: 'screener_1',
			from_date: '2020-01-01',
			to_date: '2020-06-01',
			horizons: [5]
		});
		expect(result.isError).toBe(true);
		const payload = jsonOf(result);
		expect(payload.error).toBe('unavailable');
		expect(payload.reason).toBe('screener');
	});

	it('save_results_to_watchlist and export_results are unavailable with no pinned run', async () => {
		for (const name of ['save_results_to_watchlist', 'export_results']) {
			const input =
				name === 'save_results_to_watchlist'
					? { watchlist_id: 'watchlist_1', run_id: 'run_1' }
					: { run_id: 'run_1' };
			const result = await byName.get(name)!.execute(input);
			expect(result.isError, `${name} should be unavailable`).toBe(true);
			const payload = jsonOf(result);
			expect(payload.error).toBe('unavailable');
			expect(payload.reason).toBe('pinned_run');
		}
	});

	it('derive_filters_from_setup (default/derive) is unavailable with no captured setup', async () => {
		const result = await byName.get('derive_filters_from_setup')!.execute({ setup_id: 'setup_1' });
		expect(result.isError).toBe(true);
		const payload = jsonOf(result);
		expect(payload.error).toBe('unavailable');
		expect(payload.reason).toBe('captured_setup');
	});

	it('refine_similarity_search is unavailable with no existing similarity search', async () => {
		const result = await byName.get('refine_similarity_search')!.execute({ run_id: 'run_1' });
		expect(result.isError).toBe(true);
		const payload = jsonOf(result);
		expect(payload.error).toBe('unavailable');
		expect(payload.reason).toBe('similarity_search');
	});

	it("an unavailable call never reaches the underlying tool's own not_found/validation logic", async () => {
		// backtest_screener's own logic would fail on a missing screener with
		// error "not_found" -- the gate must short-circuit before that so the
		// caller sees the surface-level "unavailable" reason instead.
		const result = await byName.get('backtest_screener')!.execute({
			screener_id: 'does_not_exist',
			from_date: '2020-01-01',
			to_date: '2020-06-01',
			horizons: [5]
		});
		const payload = jsonOf(result);
		expect(payload.error).toBe('unavailable');
		expect(payload.error).not.toBe('not_found');
	});

	it('ungated tools (e.g. create_computed_field) work with none of the four prerequisites present', async () => {
		const result = await byName.get('create_computed_field')!.execute({
			name: 'Close price',
			expression: { kind: 'field_ref', fieldId: 'field.price.close' }
		});
		expect(result.isError, JSON.stringify(jsonOf(result))).toBeUndefined();
	});
});
