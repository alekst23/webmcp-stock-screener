// Shared "how to make each mutating follow-up tool succeed once" table,
// used by both the AC4 (mutation contract) and AC5 (undo reversibility)
// cross-tool test files so the two suites can never silently drift apart
// on what counts as a valid call for a given tool. Test-support module,
// never imported by production code.
import { expect } from 'vitest';
import type { RangeCondition } from '../../../screener/conditions';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import type { SimilarityApiPort } from '../../similarity/domain/apiPort';
import type { BacktestApiPort, BacktestStartResult } from '../../backtest/domain/apiPort';
import { memoryStorage } from '../../testSupport';
import {
	createDefaultFollowupSurfaceRuntime,
	type FollowupSurfaceRuntime
} from './registerAllFollowupTools';
import {
	buildSourceSimilarityRun,
	fakeSimilarityApi,
	jsonOf,
	seedCapturedSetup,
	seedScreenerAndRun,
	seedSimilarityPanel
} from './testFixtures';

export const SETUP_ID = 'setup_1';

export function stubBacktestApi(): BacktestApiPort {
	let n = 0;
	return {
		async start(): Promise<BacktestStartResult> {
			n += 1;
			return { backtestId: `backtest_${n}`, status: 'running' };
		},
		async getResults() {
			throw new Error('not used in this test');
		}
	};
}

export function similarityApi(): SimilarityApiPort {
	return fakeSimilarityApi(buildSourceSimilarityRun(SETUP_ID));
}

// Fixed rather than the wall clock: AC5's undo-reversibility check compares
// the whole workspace document (including every updatedAt-style field) by
// value, and a real clock would fail that comparison on timestamp drift
// between two calls microseconds apart rather than on an actual defect.
const FIXED_NOW = '2026-09-02T00:00:00.000Z';

export function buildRuntime(): FollowupSurfaceRuntime {
	return createDefaultFollowupSurfaceRuntime({
		storage: memoryStorage(),
		similarityApi: similarityApi(),
		backtestApi: stubBacktestApi(),
		clock: { now: () => FIXED_NOW }
	});
}

export const RANGE_CONDITION: RangeCondition = {
	type: 'range',
	fieldId: 'field.volume',
	lower: 1,
	upper: 2,
	lowerInclusive: true,
	upperInclusive: true
};

export interface MutatingFixture {
	name: string;
	// Seeds whatever this tool needs and returns the valid base input
	// (without expected_revision/idempotency_key -- the tests add those).
	prepare(
		runtime: FollowupSurfaceRuntime,
		byName: Map<string, ToolSpec>
	): Promise<Record<string, unknown>>;
}

export async function callOk(
	tool: ToolSpec,
	input: Record<string, unknown>
): Promise<Record<string, unknown>> {
	const result = await tool.execute(input);
	expect(result.isError, `expected success, got ${JSON.stringify(jsonOf(result))}`).toBeUndefined();
	return jsonOf(result);
}

export const FIXTURES: MutatingFixture[] = [
	{
		name: 'create_computed_field',
		async prepare() {
			return {
				name: 'Close price',
				expression: { kind: 'field_ref', fieldId: 'field.price.close' }
			};
		}
	},
	{
		name: 'create_custom_study',
		async prepare() {
			return {
				name: 'Custom SMA',
				expression: {
					kind: 'function_call',
					functionId: 'study.sma',
					args: { length: 10 },
					outputName: 'sma'
				}
			};
		}
	},
	{
		name: 'derive_filters_from_setup',
		async prepare(runtime) {
			seedCapturedSetup(runtime, SETUP_ID);
			return { operation: 'derive', setup_id: SETUP_ID };
		}
	},
	{
		name: 'refine_similarity_search',
		async prepare(runtime) {
			seedCapturedSetup(runtime, SETUP_ID);
			const sourceRun = buildSourceSimilarityRun(SETUP_ID);
			seedSimilarityPanel(runtime, sourceRun.runId);
			return { run_id: sourceRun.runId, accepted_match_ids: ['A'], rejected_match_ids: ['B'] };
		}
	},
	{
		name: 'backtest_screener',
		async prepare(runtime) {
			const { screenerId } = await seedScreenerAndRun(runtime);
			return {
				screener_id: screenerId,
				from_date: '2020-01-01',
				to_date: '2020-06-01',
				horizons: [5]
			};
		}
	},
	{
		name: 'upsert_watchlist',
		async prepare() {
			return { kind: 'static', name: 'Test watchlist', instrument_ids: ['inst:XNAS:AAA'] };
		}
	},
	{
		name: 'save_results_to_watchlist',
		async prepare(runtime, byName) {
			const { runId } = await seedScreenerAndRun(runtime);
			const watchlist = await callOk(byName.get('upsert_watchlist')!, {
				kind: 'static',
				name: 'Save target',
				instrument_ids: []
			});
			const watchlistId = (watchlist.watchlist as { watchlist_id: string }).watchlist_id;
			return { watchlist_id: watchlistId, run_id: runId };
		}
	},
	{
		name: 'create_alert_draft',
		async prepare() {
			return { name: 'Alert', conditions: [RANGE_CONDITION] };
		}
	},
	{
		name: 'edit_alert_draft',
		async prepare(_runtime, byName) {
			const draft = await callOk(byName.get('create_alert_draft')!, {
				name: 'Alert',
				conditions: [RANGE_CONDITION]
			});
			const alertId = (draft.alert as { alert_id: string }).alert_id;
			return { alert_id: alertId, name: 'Renamed alert' };
		}
	},
	{
		name: 'enable_alert',
		async prepare(_runtime, byName) {
			const draft = await callOk(byName.get('create_alert_draft')!, {
				name: 'Alert',
				conditions: [RANGE_CONDITION]
			});
			const alertId = (draft.alert as { alert_id: string }).alert_id;
			return { alert_id: alertId };
		}
	},
	{
		name: 'disable_alert',
		async prepare(runtime, byName) {
			const draft = await callOk(byName.get('create_alert_draft')!, {
				name: 'Alert',
				conditions: [RANGE_CONDITION]
			});
			const alertId = (draft.alert as { alert_id: string }).alert_id;
			await callOk(byName.get('enable_alert')!, { alert_id: alertId });
			const { confirmAlertActivation } =
				await import('../../alerts/application/confirmAlertActivation');
			const armed = confirmAlertActivation(
				{ repository: runtime.repository, revisions: runtime.revisions, clock: runtime.clock },
				runtime.workspaceId,
				alertId
			);
			expect(
				armed.ok,
				'test setup: confirmAlertActivation must succeed to seed an armed alert'
			).toBe(true);
			return { alert_id: alertId };
		}
	}
];

// Read-only tools carry no expected_revision/idempotency_key/undo_token
// contract at all.
export const READ_ONLY_TOOLS = new Set(['get_backtest_results', 'preview_alert', 'export_results']);

// The two mutating tools whose own source documents a structurally null
// undo_token (nothing to reverse) -- excluded from AC5, but still part of
// AC4.
export const NEVER_UNDOABLE_TOOLS = new Set(['backtest_screener', 'disable_alert']);

export type { ToolResult };
