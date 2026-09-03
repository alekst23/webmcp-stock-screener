// T-0020-3: the full path an agent actually drives on /workbench, through
// the real shared composition root -- not hand-built fixtures. Builds the
// harness from T-0020-1/T-0020-2's own exported composition-root functions
// (createWorkbenchSharedInfra, createPanelShellRuntime, buildWorkbenchDeps,
// buildScreenerDeps) and the real registerPanelTools/registerWorkbenchTools/
// registerScreenerTools registration calls -- exactly what
// registerWorkbenchComposition() itself calls, proven equivalent to it by
// workbenchCompositionRoot.test.ts's own identity assertions.
//
// One seam is substituted: ScreenerToolDeps.evaluationPort. No real
// ScreenerMarketData adapter exists anywhere in this codebase yet (every
// other screener test -- runScreener.test.ts, engine.test.ts -- fakes this
// exact port for the same reason); the shipped honest-unavailable default
// (unavailableMarketData.ts) resolves any universe to zero instruments,
// which screener-core's own existing (unchanged, out-of-scope-to-touch)
// validation always treats as a *blocking* empty_universe problem -- so a
// real run against the honest default is always refused, never a live
// demonstration of the auto-bind path. Substituting only the evaluation
// port -- not the composition, not the binding, not the panel/workbench
// wiring -- is how this test proves the actually-new wiring (AC1) without
// re-testing or changing screener-core's own matching/validation logic
// (explicitly out of scope for this epic).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyFilterTree } from '../../screener/definition';
import type { ScreenerEvaluationPort } from '../../screener/ports';
import { makeScreenerRun, type ScreenerMatch } from '../../screener/run';
import { makeProvenance, type MarketDataProvenance } from '../domain/provenance';
import type { ToolResult, ToolSpec } from '../../webmcp/types';
import { registerScreenerTools } from '../../webmcp/screener/registerScreenerTools';
import { registerPanelTools, createPanelShellRuntime } from '../../panels/shell/registerPanelTools';
import { registerWorkbenchTools } from '../tools/registerWorkbenchTools';
import {
	buildScreenerDeps,
	buildWorkbenchDeps,
	createWorkbenchSharedInfra
} from './workbenchCompositionRoot';

beforeEach(() => {
	localStorage.clear();
});

async function textOf(result: ToolResult): Promise<unknown> {
	return JSON.parse(result.content[0]!.text);
}

function fixtureProvenance(): MarketDataProvenance {
	return makeProvenance({
		asOf: '2026-09-02T14:30:00.000Z',
		sourceId: 'src.screener.engine.fixture',
		sourceLabel: 'Fixture screener engine (no real market-data adapter exists yet)',
		liveness: 'end_of_day',
		timezone: 'America/New_York'
	});
}

function testMatch(instrumentId: string, rank: number): ScreenerMatch {
	return {
		instrumentId,
		rank,
		compositeScore: null,
		rankingValues: {},
		nodeEvaluations: {}
	};
}

// Stands in for T-1009-7's real engine, exactly like runScreener.test.ts's
// own makeFakePort -- proving orchestration and wiring, not re-testing
// screener-core's own evaluation logic.
function fakeEvaluationPort(): ScreenerEvaluationPort {
	return {
		async validate(definition) {
			return {
				screenerId: definition.screenerId,
				screenerRevision: definition.revision,
				valid: true,
				problems: [],
				skippedNodeIds: [],
				costEstimate: null,
				detectionExhaustive: false
			};
		},
		async execute({ definition, runId }) {
			return makeScreenerRun({
				runId,
				screenerId: definition.screenerId,
				screenerRevision: definition.revision,
				status: 'complete',
				universeCount: 2,
				matchedCount: 1,
				returnedCount: 1,
				truncated: false,
				rankingApplied: false,
				normalization: null,
				warnings: [],
				provenance: fixtureProvenance(),
				matches: [testMatch('inst:XNAS:AAPL', 1)],
				rejectedEvaluations: {},
				filterTree: emptyFilterTree('filter_root'),
				rankingSpec: null,
				createdAt: '2026-09-02T14:30:05.000Z'
			});
		}
	};
}

async function registerSpecs(): Promise<Map<string, ToolSpec>> {
	const registerTool = vi.fn();
	vi.stubGlobal('document', { modelContext: { registerTool } });

	const shared = createWorkbenchSharedInfra();
	const panelRuntime = createPanelShellRuntime(shared);
	const workbenchDeps = buildWorkbenchDeps(shared);
	const screenerDeps = {
		...buildScreenerDeps(shared, panelRuntime.deps),
		evaluationPort: fakeEvaluationPort()
	};

	await registerPanelTools(panelRuntime);
	await registerWorkbenchTools(workbenchDeps);
	await registerScreenerTools(screenerDeps);

	return new Map<string, ToolSpec>(
		registerTool.mock.calls.map((args: unknown[]) => {
			const tool = args[0] as ToolSpec;
			return [tool.name, tool];
		})
	);
}

describe('T-0020-3: create_screener -> set_screener_universe -> edit_filter_tree -> run_screener -> panel read', () => {
	it('the run_screener call succeeds and its matches are readable through the bound results_table panel', async () => {
		const specs = await registerSpecs();
		try {
			// 1. create_screener
			const createResult = await specs.get('create_screener')!.execute({ name: 'E2E Screener' });
			expect(createResult.isError, JSON.stringify(createResult)).toBeFalsy();
			const created = (await textOf(createResult)) as { affected_ids: string[] };
			const screenerId = created.affected_ids[0]!;

			// 2. set_screener_universe
			const universeResult = await specs.get('set_screener_universe')!.execute({
				screener_id: screenerId,
				asset_class: 'equity',
				exchanges: ['XNAS']
			});
			expect(universeResult.isError, JSON.stringify(universeResult)).toBeFalsy();

			// 3. edit_filter_tree -- a real seeded catalog field id
			// (src/lib/catalog/items.ts), matching editFilterTree.test.ts's own
			// fixture convention.
			const editResult = await specs.get('edit_filter_tree')!.execute({
				screener_id: screenerId,
				operation: 'add',
				condition: {
					type: 'scalar',
					fieldId: 'field.price.close',
					operator: 'op.greater_than',
					value: 10,
					unit: null
				}
			});
			expect(editResult.isError, JSON.stringify(editResult)).toBeFalsy();

			// 4. run_screener
			const runResult = await specs.get('run_screener')!.execute({ screener_id: screenerId });
			expect(runResult.isError, JSON.stringify(runResult)).toBeFalsy();
			const run = (await textOf(runResult)) as {
				run_id: string;
				status: string;
				matched_count: number;
			};
			expect(run.status, 'AC3: a valid screener produces a completed run').toBe('complete');
			expect(typeof run.run_id, 'AC3: the run must carry a pinned run_id').toBe('string');

			// 5. The results_table panel's bound source resolves to that run --
			// find it via get_canvas_state (workbench-core), the same tool group
			// T-0020-1's own cross-group test already exercises. get_canvas_state
			// reports EPIC-1006's own PanelRecord projection (panelState.ts's
			// boundResourceId, its "best-effort display convenience" for a
			// panel's source, not the full PanelSourceRef), so it reads back as
			// the run_id string directly.
			const canvas = (await textOf(await specs.get('get_canvas_state')!.execute({}))) as {
				panels: { id: string; kind: string; boundResourceId: string | null }[];
			};
			const resultsPanel = canvas.panels.find((p) => p.kind === 'results_table')!;
			expect(
				resultsPanel.boundResourceId,
				'AC4/AC6: the seeded results_table panel is auto-bound to the run, no separate bind_panel_source call'
			).toBe(run.run_id);

			// 6. And its matches are readable through the panel's own existing
			// read path (get_screener_results), not a side channel.
			const pageResult = await specs
				.get('get_screener_results')!
				.execute({ panel_id: resultsPanel.id });
			expect(pageResult.isError, JSON.stringify(pageResult)).toBeFalsy();
			const page = (await textOf(pageResult)) as {
				run_id: string;
				total: number;
				rows: { instrument_id: string }[];
			};
			expect(page.run_id, 'AC6: the panel read resolves to the exact run just executed').toBe(
				run.run_id
			);
			expect(page.total, 'AC6: the run matched_count is what the panel reads back').toBe(
				run.matched_count
			);
			expect(page.rows[0]!.instrument_id).toBe('inst:XNAS:AAPL');
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('run_screener still succeeds when the results_table panel was removed first (AC5/AC2)', async () => {
		const specs = await registerSpecs();
		try {
			const canvasBefore = (await textOf(await specs.get('get_canvas_state')!.execute({}))) as {
				panels: { id: string; kind: string }[];
			};
			const resultsPanel = canvasBefore.panels.find((p) => p.kind === 'results_table')!;
			const removed = await specs.get('remove_panel')!.execute({ panel_id: resultsPanel.id });
			expect(removed.isError, JSON.stringify(removed)).toBeFalsy();

			const created = (await textOf(
				await specs.get('create_screener')!.execute({ name: 'E2E Screener 2' })
			)) as { affected_ids: string[] };
			const screenerId = created.affected_ids[0]!;

			const runResult = await specs.get('run_screener')!.execute({ screener_id: screenerId });
			expect(
				runResult.isError,
				'binding is best-effort and never a precondition for the run itself'
			).toBeFalsy();
			const run = (await textOf(runResult)) as { run_id: string };
			expect(typeof run.run_id).toBe('string');
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
