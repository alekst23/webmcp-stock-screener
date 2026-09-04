// T-0026-5 AC6: the full path an agent actually drives on /workbench today
// -- define_screener -> run_screener -> get_screener_results -> create_panel
// -- through the REAL composition-root entry point (registerWorkbenchComposition
// itself, the exact function +page.svelte calls), with NO evaluationPort
// override. Only `fetch` is stubbed, at the wire boundary T-0026-4's
// HttpScreenerEvaluationPort actually calls (POST /api/screener/run) --
// this is what proves the *default* wiring works (AC2), not just the port's
// own unit behavior (httpEvaluationPort.test.ts already covers that) or an
// evaluationPort override seam.
//
// Supersedes the old T-0020-3 skipped flow (create_screener ->
// set_screener_universe -> edit_filter_tree -> run_screener), which exercised
// tools this ticket deleted from the composition root (create_screener,
// set_screener_universe, edit_filter_tree -- see group.ts's own T-0026-5
// comment for why those modules survive elsewhere but not this route).
//
// hotfix/empty-grid-canvas landed after that old flow was written: the
// default seed layout is now a single sparse filter_builder panel
// (defaultLayout.ts), not a six-panel layout that already included a
// results_table panel -- so this test creates one itself via create_panel
// before running the screener, rather than assuming one is seeded.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolResult, ToolSpec } from '../../webmcp/types';
import type { PanelShellRuntime } from '../../panels/shell/registerPanelTools';
import { registerWorkbenchComposition } from './workbenchCompositionRoot';

beforeEach(() => {
	localStorage.clear();
});

async function textOf(result: ToolResult): Promise<unknown> {
	return JSON.parse(result.content[0]!.text);
}

interface FetchCall {
	url: string;
	body: Record<string, unknown> | null;
}

function jsonResponse(payload: unknown): Response {
	return {
		ok: true,
		status: 200,
		statusText: 'OK',
		json: async () => payload,
		text: async () => JSON.stringify(payload)
	} as Response;
}

// A minimal, valid WireScreenerRunResult (httpEvaluationPort.ts's own inbound
// shape) for a 'complete' run with one match -- stands in for the real
// backend /api/screener/run endpoint, exactly like httpEvaluationPort.test.ts's
// own fixture body, so this test proves wiring, not screener-core's or the
// backend's own evaluation logic.
const COMPLETE_RUN_BODY = {
	status: 'complete',
	as_of: '2026-09-02T14:30:00.000Z',
	universe_count: 2,
	matched_count: 1,
	returned_count: 1,
	truncated: false,
	ranking_applied: true,
	matches: [
		{
			instrument: {
				instrument_id: 'inst:XNAS:AAPL',
				symbol: 'AAPL',
				exchange: 'XNAS',
				asset_type: 'equity'
			},
			rank: 1,
			composite_score: 0.9,
			ranking_values: { 'field.price.close': 12.5 },
			node_evaluations: {}
		}
	],
	problems: [],
	provenance: {
		as_of: '2026-09-02T14:30:00.000Z',
		source_id: 'src.screener.backend.fixture',
		source_label: 'Fixture backend (T-0026-5 e2e -- no real adapter exists yet)',
		liveness: 'end_of_day',
		timezone: 'America/New_York',
		engine_version: 'v1'
	}
};

function stubFetch(): { impl: typeof fetch; calls: FetchCall[] } {
	const calls: FetchCall[] = [];
	const impl = (async (url: string, init?: RequestInit) => {
		calls.push({
			url: String(url),
			body: init?.body ? JSON.parse(String(init.body)) : null
		});
		return jsonResponse(COMPLETE_RUN_BODY);
	}) as unknown as typeof fetch;
	return { impl, calls };
}

interface RegisteredSpecs {
	specs: Map<string, ToolSpec>;
	runtime: PanelShellRuntime;
}

async function registerSpecs(fetchImpl: typeof fetch): Promise<RegisteredSpecs> {
	const registerTool = vi.fn();
	vi.stubGlobal('document', { modelContext: { registerTool } });
	vi.stubGlobal('fetch', fetchImpl);

	// No overrides -- in particular no evaluationPort override -- so
	// buildScreenerDeps' own default (HttpScreenerEvaluationPort against
	// resolveApiBaseUrl(undefined), i.e. DEV_API_BASE_URL) applies.
	const runtime = await registerWorkbenchComposition();

	const specs = new Map<string, ToolSpec>(
		registerTool.mock.calls.map((args: unknown[]) => {
			const tool = args[0] as ToolSpec;
			return [tool.name, tool];
		})
	);
	return { specs, runtime };
}

describe('T-0026-5: define_screener -> run_screener -> get_screener_results -> create_panel', () => {
	it('runs end to end against the real composition root, with only fetch stubbed at the HTTP boundary', async () => {
		const { impl, calls } = stubFetch();
		const { specs } = await registerSpecs(impl);
		try {
			// 0. The default seed layout no longer includes a results_table panel
			// (hotfix/empty-grid-canvas) -- create one so run_screener's auto-bind
			// (T-0020-2) has somewhere to bind to.
			const resultsPanelResult = await specs
				.get('create_panel')!
				.execute({ kind: 'results_table' });
			expect(
				resultsPanelResult.isError,
				`seeding a results_table panel failed: ${JSON.stringify(resultsPanelResult)}`
			).toBeFalsy();
			const resultsPanelId = ((await textOf(resultsPanelResult)) as { affected_ids: string[] })
				.affected_ids[0]!;

			// 1. define_screener -- one call, real seeded catalog field
			// (src/lib/catalog/items.ts), matching defineScreener.test.ts's own
			// fixture convention.
			const defineResult = await specs.get('define_screener')!.execute({
				universe: { asset_class: 'equity' },
				conditions: {
					type: 'scalar',
					fieldId: 'field.price.close',
					operator: 'op.greater_than',
					value: 10,
					unit: null
				},
				ranking: { fields: [{ field_id: 'field.price.close', direction: 'desc' }] },
				limit: 20
			});
			expect(
				defineResult.isError,
				`define_screener failed: ${JSON.stringify(defineResult)}`
			).toBeFalsy();
			const defined = (await textOf(defineResult)) as { screener_id: string; valid: boolean };
			expect(defined.valid, 'AC1: a well-formed definition must validate').toBe(true);

			// 2. run_screener -- against the real, default HttpScreenerEvaluationPort.
			const runResult = await specs
				.get('run_screener')!
				.execute({ screener_id: defined.screener_id });
			expect(runResult.isError, `run_screener failed: ${JSON.stringify(runResult)}`).toBeFalsy();
			const run = (await textOf(runResult)) as {
				run_id: string;
				status: string;
				matched_count: number;
			};
			expect(run.status, 'AC2: a valid screener produces a completed run').toBe('complete');
			expect(typeof run.run_id, 'the run must carry a pinned run_id').toBe('string');

			// AC2/AC6: exactly one real HTTP call, to the backend's own endpoint,
			// as a non-dry-run execute -- never an override, never a dry run.
			expect(
				calls.length,
				'run_screener must call the real HTTP evaluation port exactly once'
			).toBe(1);
			expect(calls[0]!.url).toContain('/api/screener/run');
			expect(calls[0]!.body?.dry_run, 'run_screener executes, it does not dry-run').toBe(false);

			// 3. get_screener_results -- read back through the results_table panel
			// run_screener auto-bound (T-0020-2), not a side channel.
			const pageResult = await specs
				.get('get_screener_results')!
				.execute({ panel_id: resultsPanelId });
			expect(
				pageResult.isError,
				`get_screener_results failed: ${JSON.stringify(pageResult)}`
			).toBeFalsy();
			const page = (await textOf(pageResult)) as {
				run_id: string;
				total: number;
				rows: { instrument_id: string; symbol: string; exchange: string; asset_type: string }[];
			};
			expect(page.run_id, 'the panel read must resolve to the exact run just executed').toBe(
				run.run_id
			);
			expect(page.total).toBe(run.matched_count);
			expect(page.rows[0]!.instrument_id).toBe('inst:XNAS:AAPL');

			// 4. create_panel -- "show me details for X": open a detail view for
			// the top result, completing the use case's second step. The chart
			// panel's 'instrument' source ref is { instrument: {...} }
			// (chart/application/chartSource.ts's INSTRUMENT_REF_SCHEMA), matching
			// registerPanelTools.test.ts's own bind_panel_source fixture.
			const row = page.rows[0]!;
			const chartPanelResult = await specs.get('create_panel')!.execute({
				kind: 'chart',
				source: {
					type: 'instrument',
					ref: {
						instrument: {
							instrument_id: row.instrument_id,
							symbol: row.symbol,
							exchange: row.exchange,
							asset_type: row.asset_type
						}
					}
				}
			});
			expect(
				chartPanelResult.isError,
				`create_panel failed: ${JSON.stringify(chartPanelResult)}`
			).toBeFalsy();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	// Bug fix regression: registerScreenerTools/registerCanvasStateTool were
	// registered without panelRuntime.observer, so a successful call never
	// notified PanelContainer -- the FilterBuilder panel (and any results
	// panel) stayed stale until an unrelated tool call happened to notify.
	// The tests above only assert on tool-call results, which is exactly
	// why they never caught this -- this test asserts on the observer
	// directly, spying on it after registration (wrapToolsWithNotify closes
	// over the observer object, not a bound method, so a spy installed
	// after registration is still seen at call time).
	it('define_screener, run_screener, and get_canvas_state all notify the shell observer (UI re-render)', async () => {
		const { impl } = stubFetch();
		const { specs, runtime } = await registerSpecs(impl);
		const notify = vi.spyOn(runtime.observer, 'notify');
		try {
			notify.mockClear();
			const defineResult = await specs.get('define_screener')!.execute({
				universe: { asset_class: 'equity' },
				conditions: {
					type: 'scalar',
					fieldId: 'field.price.close',
					operator: 'op.greater_than',
					value: 10,
					unit: null
				},
				ranking: { fields: [{ field_id: 'field.price.close', direction: 'desc' }] },
				limit: 20
			});
			expect(defineResult.isError, `define_screener failed: ${JSON.stringify(defineResult)}`).toBeFalsy();
			expect(notify, 'define_screener must notify the observer so FilterBuilderPanel re-renders').toHaveBeenCalled();

			notify.mockClear();
			const defined = (await textOf(defineResult)) as { screener_id: string };
			const runResult = await specs
				.get('run_screener')!
				.execute({ screener_id: defined.screener_id });
			expect(runResult.isError, `run_screener failed: ${JSON.stringify(runResult)}`).toBeFalsy();
			expect(notify, 'run_screener must notify the observer so a bound results panel re-renders').toHaveBeenCalled();

			notify.mockClear();
			const canvasResult = await specs.get('get_canvas_state')!.execute({});
			expect(canvasResult.isError, `get_canvas_state failed: ${JSON.stringify(canvasResult)}`).toBeFalsy();
			expect(notify, 'get_canvas_state is wrapped the same way as every other panel-affecting tool').toHaveBeenCalled();
		} finally {
			notify.mockRestore();
			vi.unstubAllGlobals();
		}
	});

	it('run_screener still succeeds when no results_table panel exists (AC2: binding is best-effort)', async () => {
		const { impl, calls } = stubFetch();
		const { specs } = await registerSpecs(impl);
		try {
			const defineResult = await specs.get('define_screener')!.execute({
				universe: { asset_class: 'equity' },
				conditions: {
					type: 'scalar',
					fieldId: 'field.price.close',
					operator: 'op.greater_than',
					value: 10,
					unit: null
				}
			});
			expect(defineResult.isError, JSON.stringify(defineResult)).toBeFalsy();
			const defined = (await textOf(defineResult)) as { screener_id: string };

			const runResult = await specs
				.get('run_screener')!
				.execute({ screener_id: defined.screener_id });
			expect(
				runResult.isError,
				'binding is best-effort and never a precondition for the run itself'
			).toBeFalsy();
			const run = (await textOf(runResult)) as { run_id: string };
			expect(typeof run.run_id).toBe('string');
			expect(calls.length).toBe(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
