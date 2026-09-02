// Shared fixture builders for T-1014-11's cross-tool tests (AC4-AC8).
// Test-only module: builds real state through sibling epics' own,
// already-merged factories (create_screener/run_screener from EPIC-1009,
// capture_chart_setup from EPIC-1011, createPanel from EPIC-1007) against
// this ticket's shared FollowupSurfaceRuntime, exactly the way
// captureChartSetup.test.ts and refineSimilaritySearch.test.ts already
// seed their own fixtures. Never imported by production code, and never
// flips a sibling epic's own `..._ENABLED` flag or calls its
// `register<Group>Tools()` wrapper -- only the underlying `build*`/`create*`
// factories, which is what the ticket's own instructions call out as fair
// game for fixture composition.
import { makeProvenance, type MarketDataProvenance } from '../../domain/provenance';
import type { WorkbenchDeps } from '../../tools/index';
import { createCreateScreenerTool } from '../../../webmcp/screener/createScreener';
import { createRunScreenerTool } from '../../../webmcp/screener/runScreener';
import type { ScreenerMarketData } from '../../../screener/ports';
import { writeCapturedSetup } from '../../chart/domain/capturedSetup';
import type { CapturedChartSetup } from '../../chart/domain/capturedSetup';
import { createPanel } from '../../../panels/application/createPanel';
import { makeFeatureWeightSet } from '../../similarity/domain/contract';
import type { SimilarityCandidate, SimilarityRun } from '../../similarity/domain/contract';
import { SimilarityApiError, type SimilarityApiPort } from '../../similarity/domain/apiPort';
import type { FollowupSurfaceRuntime } from './registerAllFollowupTools';

function jsonOf(result: { content: { type: 'text'; text: string }[] }): Record<string, unknown> {
	return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

const FIXED_PROVENANCE: MarketDataProvenance = makeProvenance({
	asOf: '2020-01-01T00:00:00.000Z',
	sourceId: 'not_configured',
	sourceLabel: 'No market-data source configured',
	liveness: 'static',
	timezone: 'America/New_York'
});

// The WorkbenchDeps shape create_screener/run_screener need, drawn from the
// same shared repository/revisions/history/registry/clock/ids every other
// group in this runtime uses -- only `provenance`/`idempotency` are extra,
// and neither is a production dependency of this ticket's own 13 tools.
function workbenchDeps(runtime: FollowupSurfaceRuntime): WorkbenchDeps {
	return {
		repository: runtime.repository,
		revisions: runtime.revisions,
		history: runtime.history,
		registry: runtime.registry,
		provenance: { current: () => FIXED_PROVENANCE },
		clock: runtime.clock,
		ids: runtime.ids,
		idempotency: runtime.idempotency
	};
}

// A small fixed fixture (one instrument), mirroring
// webmcp/screener/integration.test.ts's own fixtureMarketData -- an empty
// universe is a *blocking* validation problem (screenerValidation.ts's
// "empty_universe"), distinct from a valid run that simply matched
// nothing, so run_screener needs at least one resolvable instrument even
// though this fixture's empty filter tree matches everything it sees.
function fixtureMarketData(): ScreenerMarketData {
	return {
		async resolveUniverse() {
			return ['inst:XNAS:AAA'];
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
			return FIXED_PROVENANCE;
		}
	};
}

// Creates a screener (empty filter tree, a one-instrument fixture universe)
// and runs it, pinning a real ScreenerRun into runtime.runs -- the same
// tracked store watchlist/export/backtest tools read.
export async function seedScreenerAndRun(
	runtime: FollowupSurfaceRuntime
): Promise<{ screenerId: string; runId: string }> {
	const deps = workbenchDeps(runtime);
	const createTool = createCreateScreenerTool(deps);
	const created = jsonOf(await createTool.execute({ name: 'Fixture screener' }));
	const screenerId = (created.affected_ids as string[])[0]!;

	const runTool = createRunScreenerTool(deps, {
		marketData: fixtureMarketData(),
		runStore: runtime.runs
	});
	const run = jsonOf(await runTool.execute({ screener_id: screenerId }));
	const runId = run.run_id as string;
	if (!runId) {
		throw new Error(
			`seedScreenerAndRun: run_screener did not return a run_id: ${JSON.stringify(run)}`
		);
	}
	return { screenerId, runId };
}

// Writes a captured chart setup directly onto the active workspace's
// document, mirroring refineSimilaritySearch.test.ts's own harness --
// exercising capture_chart_setup itself is captureChartSetup.test.ts's job
// (and AC7's own end-to-end test), not every cross-tool fixture's.
export function seedCapturedSetup(runtime: FollowupSurfaceRuntime, setupId = 'setup_1'): string {
	const doc = runtime.repository.get(runtime.workspaceId);
	if (!doc) {
		throw new Error('seedCapturedSetup: active workspace not found.');
	}
	const setup: CapturedChartSetup = {
		setupId,
		capturedAt: runtime.clock.now(),
		workspaceRevision: doc.revision,
		sourcePanelId: 'panel_chart_1',
		instrument: {
			instrumentId: 'inst:XNAS:MOCK01',
			symbol: 'MOCK01',
			exchange: 'XNAS',
			assetType: 'equity'
		},
		window: {
			start: '2023-03-01',
			end: '2023-03-31',
			timeframe: '1d',
			session: 'regular',
			barCount: 20
		},
		candleType: 'candlestick',
		scale: 'linear',
		priceAdjustment: 'adjusted',
		normalization: { mode: 'percent_change', anchor: 'window_start' },
		studies: [],
		comparisons: [],
		provenance: FIXED_PROVENANCE
	};
	runtime.repository.put(writeCapturedSetup(doc, setup));
	return setupId;
}

function candidate(id: string, perFamilySimilarity: SimilarityCandidate['perFamilySimilarity']) {
	return {
		candidateId: id,
		instrument: {
			instrumentId: `inst:XNAS:${id}`,
			symbol: id,
			exchange: 'XNAS',
			assetType: 'equity' as const
		},
		window: { start: '2023-04-01', end: '2023-04-30', timeframe: '1d' },
		score: 0.8,
		perFamilySimilarity,
		unavailableFamilies: []
	};
}

// A fake SimilarityApiPort with real behavior (counts calls, mints a fresh
// run id per search), never name-keyed -- mirrors
// refineSimilaritySearch.test.ts's own fakeApi exactly.
export function fakeSimilarityApi(source: SimilarityRun): SimilarityApiPort {
	let nextId = 2;
	return {
		async getRun(runId) {
			if (runId !== source.runId) {
				throw new SimilarityApiError('not_found_run', `No such run: ${runId}.`);
			}
			return source;
		},
		async search(request) {
			return {
				...source,
				runId: `run_${nextId++}`,
				weights: (request.weights as SimilarityRun['weights']) ?? source.weights
			};
		},
		async explain() {
			throw new Error('not used by these tests');
		}
	};
}

export function buildSourceSimilarityRun(
	referenceSetupId: string,
	runId = 'run_similarity_1'
): SimilarityRun {
	return {
		runId,
		referenceSetupId,
		scope: 'cross_instrument',
		weights: makeFeatureWeightSet(),
		normalization: { mode: 'percent_change', anchor: 'window_start' },
		provenance: FIXED_PROVENANCE,
		candidates: [
			candidate('A', { price_shape: 0.9, volume: 0.2 }),
			candidate('B', { price_shape: 0.1, volume: 0.8 })
		],
		warnings: []
	};
}

// Binds a similar_opportunities panel to `runId`, the state
// find_similar_setups (EPIC-1012, not this ticket's) would have left
// behind -- goes through the real createPanel use case against this
// runtime's own panel registries, so it participates in the mutation
// contract like any other panel-creating call.
export function seedSimilarityPanel(runtime: FollowupSurfaceRuntime, runId: string): string {
	const envelope = createPanel(
		{
			workspaceId: runtime.workspaceId,
			repository: runtime.repository,
			revisions: runtime.revisions,
			history: runtime.history,
			clock: runtime.clock,
			ids: runtime.ids,
			kinds: runtime.kinds,
			sourceRenderer: runtime.sourceRenderer,
			templates: runtime.templates
		},
		{
			context: { actor: 'agent' },
			kind: 'similar_opportunities',
			config: { runId, comparisonView: null }
		}
	);
	return envelope.affectedIds[0]!;
}

export { jsonOf };
