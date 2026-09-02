// AC7: the epic's principal end-to-end flow -- derive a draft filter tree
// from a captured setup, accept it onto a screener, run and backtest it,
// save the results to a watchlist, draft and preview an alert, and export
// the pinned run -- with provenance present at every step that carries
// market data. Every tool call below goes through the actual registered
// ToolSpec (buildAllFollowupTools' output), driven the way an agent would
// drive it: by name, with wire (snake_case) input, reading the JSON
// response back. Screener/chart fixtures come from EPIC-1009/1011's own
// already-merged factories (see testFixtures.ts's header), never a
// sibling epic's gated register*Tools() wrapper.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import { createIdSequencer } from '../../domain/ids';
import { emptyWorkspace } from '../../domain/workspace';
import type { WorkspaceDocument } from '../../domain/workspace';
import { readCapturedSetups } from '../../chart/domain/capturedSetup';
import { createChartState, writeChartState } from '../../chart/domain/chartState';
import type { InstrumentRef } from '../../chart/domain/instrument';
import type { OhlcvBar } from '../../chart/domain/seriesPort';
import {
	createInMemoryChartSeries,
	type InMemoryChartSeriesFixture
} from '../../chart/infra/inMemoryChartSeries';
import { buildCaptureChartSetupTool } from '../../chart/tools/captureChartSetup';
import type {
	BacktestApiPort,
	BacktestResultsOutcome,
	BacktestStartResult
} from '../../backtest/domain/apiPort';
import { memoryStorage } from '../../testSupport';
import {
	buildAllFollowupTools,
	createDefaultFollowupSurfaceRuntime,
	type FollowupSurfaceRuntime
} from './registerAllFollowupTools';
import { jsonOf } from './testFixtures';

const NOW = '2026-09-02T00:00:00.000Z';
const PANEL_ID = 'panel_chart_1';

const NVDA: InstrumentRef = {
	instrumentId: 'inst:XNAS:NVDA',
	symbol: 'NVDA',
	exchange: 'XNAS',
	assetType: 'equity'
};

function dailyBars(count: number): OhlcvBar[] {
	const bars: OhlcvBar[] = [];
	for (let i = 0; i < count; i += 1) {
		const at = new Date(Date.UTC(2026, 0, 2));
		at.setUTCDate(at.getUTCDate() + i);
		const close = 100 + i;
		bars.push({
			time: at.toISOString().slice(0, 10),
			open: close - 1,
			high: close + 2,
			low: close - 3,
			close,
			volume: 1_000 + i
		});
	}
	return bars;
}

function seriesFixture(): InMemoryChartSeriesFixture {
	return {
		instrumentId: NVDA.instrumentId,
		timeframe: '1d',
		bars: dailyBars(30),
		sourceAdjustment: 'adjusted',
		currency: 'USD',
		timezone: 'America/New_York',
		liveness: 'end_of_day'
	} as InMemoryChartSeriesFixture;
}

// Seeds a chart panel with a bound instrument, range and one enabled study
// -- enough for derive_filters_from_setup to derive at least one real
// condition (application/deriveFilters.ts only derives from enabled
// studies and price-bearing annotations; an empty setup is a legitimate
// but less illustrative "nothing derivable" outcome). Mirrors
// captureChartSetup.test.ts's own seedWorkspace exactly.
function seedChartPanel(runtime: FollowupSurfaceRuntime): void {
	const doc: WorkspaceDocument = {
		...runtime.repository.get(runtime.workspaceId)!,
		panels: [
			{
				id: PANEL_ID,
				kind: 'chart',
				title: 'Chart',
				collapsed: false,
				visible: true,
				boundResourceId: null,
				config: {}
			}
		]
	};
	const state = createChartState(PANEL_ID);
	state.config.instrument = NVDA;
	state.config.range = {
		kind: 'explicit',
		start: '2026-01-01T00:00:00.000Z',
		end: '2028-01-01T00:00:00.000Z'
	};
	state.studies = [
		{
			id: 'study_1',
			catalogItemId: 'study.sma',
			params: { length: 20 },
			pane: 'price_overlay',
			order: 0,
			enabled: true
		}
	];
	runtime.repository.put(writeChartState(doc, state));
}

function backtestApiWithProvenance(): BacktestApiPort {
	let started = 0;
	return {
		async start(): Promise<BacktestStartResult> {
			started += 1;
			return { backtestId: `backtest_${started}`, status: 'completed' };
		},
		async getResults(): Promise<BacktestResultsOutcome> {
			return {
				status: 'completed',
				backtestId: 'backtest_1',
				result: {
					provenance: {
						as_of: NOW,
						source_id: 'src.test.backtest_fixture',
						source_label: 'Backtest fixture',
						liveness: 'historical',
						timezone: 'America/New_York'
					},
					match_frequency: [],
					forward_returns: {},
					drawdowns: {}
				}
			};
		}
	};
}

describe('AC7: derive -> accept -> run -> backtest -> watchlist -> alert -> export', () => {
	let runtime: FollowupSurfaceRuntime;
	let byName: Map<string, ToolSpec>;

	beforeEach(() => {
		runtime = createDefaultFollowupSurfaceRuntime({
			storage: memoryStorage(),
			backtestApi: backtestApiWithProvenance(),
			clock: { now: () => NOW }
		});
		byName = new Map(buildAllFollowupTools(runtime).map((t) => [t.name, t]));
		seedChartPanel(runtime);
	});

	it('carries a piece of research from a captured chart setup through to an export, with provenance at every market-data step', async () => {
		// 1. Capture a chart setup (EPIC-1011's own tool, real, against this
		// runtime's shared repository/history/revisions).
		const captureTool = buildCaptureChartSetupTool({
			repository: runtime.repository,
			revisions: runtime.revisions,
			history: runtime.history,
			registry: runtime.registry,
			clock: runtime.clock,
			ids: createIdSequencer(),
			series: createInMemoryChartSeries({ clock: runtime.clock, series: [seriesFixture()] })
		});
		const captured = jsonOf(await captureTool.execute({ panel_id: PANEL_ID }));
		expect(captured.error, JSON.stringify(captured)).toBeUndefined();
		const setupId = captured.setup_id as string;
		expect(setupId).toBeTruthy();
		expect(readCapturedSetups(runtime.repository.get(runtime.workspaceId)!)).toHaveLength(1);

		// 2. Create a target screener to accept the draft onto, using
		// EPIC-1009's own real create_screener/run_screener factories against
		// this runtime's shared repository/revisions/history/registry.
		const { createCreateScreenerTool } = await import('../../../webmcp/screener/createScreener');
		const { createRunScreenerTool } = await import('../../../webmcp/screener/runScreener');
		const { makeProvenance } = await import('../../domain/provenance');
		const FIXED_PROVENANCE = makeProvenance({
			asOf: NOW,
			sourceId: 'not_configured',
			sourceLabel: 'No market-data source configured',
			liveness: 'static',
			timezone: 'America/New_York'
		});
		const workbenchDeps = {
			repository: runtime.repository,
			revisions: runtime.revisions,
			history: runtime.history,
			registry: runtime.registry,
			provenance: { current: () => FIXED_PROVENANCE },
			clock: runtime.clock,
			ids: runtime.ids,
			idempotency: runtime.idempotency
		};
		const target = jsonOf(
			await createCreateScreenerTool(workbenchDeps).execute({ name: 'Target screener' })
		);
		const targetScreenerId = (target.affected_ids as string[])[0]!;

		// 3. Derive a draft filter tree from the captured setup.
		const derived = jsonOf(
			await byName.get('derive_filters_from_setup')!.execute({
				operation: 'derive',
				setup_id: setupId,
				target_screener_id: targetScreenerId
			})
		);
		expect(derived.error, JSON.stringify(derived)).toBeUndefined();
		const draftId = derived.draft_id as string;
		expect(draftId).toBeTruthy();

		// 4. The draft is not live -- the target screener's filter tree is
		// still untouched until it is explicitly accepted.
		const { readScreener } = await import('../../../screener/state');
		const beforeAccept = readScreener(
			runtime.repository.get(runtime.workspaceId)!,
			targetScreenerId
		)!;
		expect(beforeAccept.filterTree.kind).toBe('group');
		expect((beforeAccept.filterTree as { children: unknown[] }).children).toHaveLength(0);

		const accepted = jsonOf(
			await byName.get('derive_filters_from_setup')!.execute({
				operation: 'accept',
				draft_id: draftId,
				target_screener_id: targetScreenerId
			})
		);
		expect(accepted.error, JSON.stringify(accepted)).toBeUndefined();

		// 5. Run the accepted screener -- a real ScreenerRun, carrying real
		// provenance (this fixture's own market-data provenance, not the
		// composition root's placeholder).
		const marketData = {
			async resolveUniverse() {
				return [NVDA.instrumentId];
			},
			async getFieldValue() {
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
					asOf: NOW,
					sourceId: 'src.test.principal_flow',
					sourceLabel: 'Principal flow fixture',
					liveness: 'end_of_day',
					timezone: 'America/New_York'
				});
			}
		};
		const runTool = createRunScreenerTool(workbenchDeps, { marketData, runStore: runtime.runs });
		const run = jsonOf(await runTool.execute({ screener_id: targetScreenerId }));
		expect(run.error, JSON.stringify(run)).toBeUndefined();
		const runId = run.run_id as string;
		expect(runId).toBeTruthy();
		expect(run.provenance, 'run_screener must carry provenance').toBeTruthy();
		expect((run.provenance as { source_id: string }).source_id).toBe('src.test.principal_flow');

		// 6. Backtest the same screener.
		const backtest = jsonOf(
			await byName.get('backtest_screener')!.execute({
				screener_id: targetScreenerId,
				from_date: '2020-01-01',
				to_date: '2020-06-01',
				horizons: [5]
			})
		);
		expect(backtest.error, JSON.stringify(backtest)).toBeUndefined();
		const backtestId = backtest.backtest_id as string;
		expect(backtestId).toBeTruthy();

		const backtestResults = jsonOf(
			await byName.get('get_backtest_results')!.execute({ backtest_id: backtestId })
		);
		expect(backtestResults.status).toBe('completed');
		const result = backtestResults.result as { provenance: Record<string, unknown> };
		expect(result.provenance, 'get_backtest_results must carry provenance').toBeTruthy();

		// 7. Save the run's results to a watchlist.
		const watchlist = jsonOf(
			await byName.get('upsert_watchlist')!.execute({
				kind: 'static',
				name: 'Saved from run',
				instrument_ids: []
			})
		);
		const watchlistId = (watchlist.watchlist as { watchlist_id: string }).watchlist_id;
		const saved = jsonOf(
			await byName
				.get('save_results_to_watchlist')!
				.execute({ watchlist_id: watchlistId, run_id: runId })
		);
		expect(saved.error, JSON.stringify(saved)).toBeUndefined();

		// 8. Draft and preview an alert.
		const draft = jsonOf(
			await byName.get('create_alert_draft')!.execute({
				name: 'Follow-up alert',
				screener_id: targetScreenerId
			})
		);
		expect(draft.error, JSON.stringify(draft)).toBeUndefined();
		const alertId = (draft.alert as { alert_id: string; state: string }).alert_id;
		expect((draft.alert as { state: string }).state).toBe('draft');

		const preview = await byName.get('preview_alert')!.execute({ alert_id: alertId });
		expect(preview.isError, JSON.stringify(jsonOf(preview))).toBeUndefined();

		// 9. Export the pinned run, with full provenance.
		const exported = jsonOf(await byName.get('export_results')!.execute({ run_id: runId }));
		expect(exported.error, JSON.stringify(exported)).toBeUndefined();
		expect(exported.run_id).toBe(runId);
		expect(exported.provenance, 'export_results must carry provenance').toBeTruthy();
		expect((exported.provenance as { source_id: string }).source_id).toBe(
			'src.test.principal_flow'
		);

		// AC9: the created watchlist and alert are visible independent of the
		// call that created them -- reading the workspace document back, not
		// just re-inspecting the creating call's own response.
		const { readWatchlist } = await import('../../watchlist/domain/watchlist');
		const { readAlert } = await import('../../alerts/domain/alert');
		const finalDoc = runtime.repository.get(runtime.workspaceId)!;
		expect(readWatchlist(finalDoc, watchlistId)?.name).toBe('Saved from run');
		expect(readAlert(finalDoc, alertId)?.name).toBe('Follow-up alert');
	});
});
