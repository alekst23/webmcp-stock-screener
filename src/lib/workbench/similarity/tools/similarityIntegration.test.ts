// T-1012-8: end-to-end proof that the three similarity tools work together
// as one capability, through tool calls only -- matching
// src/lib/webmcp/integration.test.ts's style (a stubbed fetch standing in
// for the real backend, driving the real tool builders rather than a fake
// engine). Each tool already has its own isolated unit tests (T-1012-4/5/7);
// this file is deliberately the only place all three run against one shared
// workspace and one shared stubbed backend, because that is the only way to
// check the seams between them (AC2-AC7) rather than each tool's own
// contract in isolation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeProvenance } from '../../domain/provenance';
import { emptyWorkspace } from '../../domain/workspace';
import { undoChange, createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createRevisionService } from '../../application/revisionService';
import { createIdSequencer } from '../../domain/ids';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { writeCapturedSetup } from '../../chart/domain/capturedSetup';
import type { CapturedChartSetup } from '../../chart/domain/capturedSetup';
import { createPanelRegistry } from '../../../panels/registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../../../panels/registry/sourceRendererRegistry';
import { registerDefaultSourceRendererTypes } from '../../../panels/registry/defaultSourceRendererTypes';
import {
	createLayoutTemplateRegistry,
	registerDefaultLayoutTemplates
} from '../../../panels/domain/layoutTemplates';
import { readPanelState } from '../../../panels/application';
import { similarOpportunitiesPanelKindDefinition } from '../panel/domain/panelKind';
import { createHttpSimilarityApi } from '../infra/httpSimilarityApi';
import { buildFindSimilarSetupsTool, type FindSimilarSetupsDeps } from './findSimilarSetups';
import { buildExplainSimilarityTool } from './explainSimilarity';
import { buildCompareSetupsTool } from '../comparison/tools/compareSetups';

const NOW = '2026-09-02T20:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const SETUP_ID = 'setup_1';
const RUN_ID = 'run_1';
const CANDIDATE_ID = 'run_1_candidate_1';

// A non-uniform weight set (AC4's own caution: "verify against a run with a
// non-uniform weight set, where an incorrect score would differ visibly" --
// equal weights would let a wrong wiring pass by coincidence). Contributions
// sum to overall_score exactly: 0.7*0.9 + 0.3*0.6 = 0.63 + 0.18 = 0.81.
const CANDIDATE_SCORE = 0.81;
const WEIGHT_APPLIED = { price_shape: 0.7, volume: 0.3 };
const PER_FAMILY_SIMILARITY = { price_shape: 0.9, volume: 0.6 };
const CONTRIBUTIONS = { price_shape: 0.63, volume: 0.18 };

const PROVENANCE_WIRE = {
	as_of: NOW,
	source_id: 'src.panel.mock',
	source_label: 'Mock Panel',
	liveness: 'historical',
	timezone: 'UTC',
	engine_version: '0.1.0'
};

function candidateWire(candidateId: string) {
	return {
		candidate_id: candidateId,
		instrument: {
			instrument_id: 'inst:XNAS:MOCK02',
			symbol: 'MOCK02',
			exchange: 'XNAS',
			asset_type: 'equity'
		},
		window: { start: '2023-04-01', end: '2023-04-30', timeframe: '1d' },
		score: CANDIDATE_SCORE,
		per_family_similarity: PER_FAMILY_SIMILARITY,
		unavailable_families: []
	};
}

function runWire(runId: string) {
	return {
		run_id: runId,
		reference_setup_id: SETUP_ID,
		scope: 'cross_instrument',
		weights: { weights: WEIGHT_APPLIED },
		normalization: { mode: 'percent_change', anchor: 'window_start' },
		provenance: PROVENANCE_WIRE,
		candidates: [candidateWire(CANDIDATE_ID)],
		warnings: []
	};
}

function explanationWire(candidateId: string) {
	return {
		candidate_id: candidateId,
		overall_score: CANDIDATE_SCORE,
		weight_applied: WEIGHT_APPLIED,
		per_family_similarity: PER_FAMILY_SIMILARITY,
		contributions: CONTRIBUTIONS,
		unavailable_families: []
	};
}

function jsonResponse(payload: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? 'OK' : 'Error',
		json: async () => payload,
		text: async () => JSON.stringify(payload)
	} as Response;
}

// A minimal but coherent fake of T-1012-3's three routes, matching
// httpSimilarityApi.ts's actual request/response wire shapes exactly (not a
// name-keyed stub -- it reads the real request body and routes on the real
// path, so a URL or field-name drift in either side would fail this test).
function stubSimilarityBackend(options: { searchFails?: boolean } = {}): {
	fetch: typeof fetch;
	searchCalls: unknown[];
} {
	const searchCalls: unknown[] = [];
	const impl = vi.fn(async (url: string, init?: RequestInit) => {
		const { pathname } = new URL(url);
		if (pathname === '/api/similarity/search') {
			searchCalls.push(init?.body ? JSON.parse(init.body as string) : {});
			if (options.searchFails) {
				return jsonResponse({ detail: 'panel unavailable' }, 503);
			}
			return jsonResponse(runWire(RUN_ID));
		}
		if (pathname === `/api/similarity/runs/${RUN_ID}`) {
			return jsonResponse(runWire(RUN_ID));
		}
		if (pathname === `/api/similarity/runs/${RUN_ID}/candidates/${CANDIDATE_ID}/explanation`) {
			return jsonResponse(explanationWire(CANDIDATE_ID));
		}
		throw new Error(`stubSimilarityBackend: unhandled path ${pathname}`);
	});
	return { fetch: impl as unknown as typeof fetch, searchCalls };
}

function harness(fetchImpl: typeof fetch) {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const clock = { now: () => NOW };
	const ids = createIdSequencer();
	const kinds = createPanelRegistry();
	kinds.register(similarOpportunitiesPanelKindDefinition);
	const sourceRenderer = createSourceRendererRegistry();
	registerDefaultSourceRendererTypes(sourceRenderer);
	const templates = createLayoutTemplateRegistry();
	registerDefaultLayoutTemplates(templates);
	const revisions = createRevisionService({
		repository,
		clock,
		ids,
		idempotency: createIdempotencyCache()
	});
	const history = createChangeHistory();

	// A captured setup, matching what capture_chart_setup (EPIC-1011) would
	// have produced -- this epic never fabricates one of its own.
	const setup: CapturedChartSetup = {
		setupId: SETUP_ID,
		capturedAt: NOW,
		workspaceRevision: 1,
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
		// The exact normalization the captured setup carries -- AC5 checks this
		// survives into the comparison view unchanged.
		normalization: { mode: 'percent_change', anchor: 'window_start' },
		studies: [],
		comparisons: [],
		provenance: makeProvenance({
			asOf: NOW,
			sourceId: 'src.panel.mock',
			sourceLabel: 'Mock Panel',
			timezone: 'UTC',
			liveness: 'historical'
		})
	};
	const doc = writeCapturedSetup(emptyWorkspace(WORKSPACE_ID, 'Test', NOW), setup);
	repository.put(doc);
	repository.setActiveId(WORKSPACE_ID);

	const api = createHttpSimilarityApi({ baseUrl: 'http://backend.test', fetchImpl });
	const deps: FindSimilarSetupsDeps = {
		workspaceId: WORKSPACE_ID,
		repository,
		revisions,
		history,
		clock,
		ids,
		kinds,
		sourceRenderer,
		templates,
		api
	};
	return deps;
}

async function parseResult(result: { content: { type: string; text: string }[] }) {
	return JSON.parse(result.content[0]?.text ?? '{}');
}

describe('similarity surface: find -> panel -> explain -> compare', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('AC2-AC5: runs the whole chain through tool calls only, provenance/score/normalization intact at every hop', async () => {
		const backend = stubSimilarityBackend();
		const deps = harness(backend.fetch);

		const findTool = buildFindSimilarSetupsTool(deps);
		const explainTool = buildExplainSimilarityTool({ api: deps.api });
		const compareTool = buildCompareSetupsTool(deps);

		// 1. find_similar_setups: searches, pins a run, binds a new panel.
		const findResult = await findTool.execute({ setup_id: SETUP_ID, scope: 'cross_instrument' });
		expect(findResult.isError).toBeFalsy();
		const findBody = await parseResult(findResult);
		expect(findBody.run_id).toBe(RUN_ID);
		expect(findBody.candidates).toHaveLength(1);
		const panelCandidate = findBody.candidates[0];

		// AC2: the run's panel exists and is bound to this run.
		const panelState = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(panelState.panels).toHaveLength(1);
		const panel = panelState.panels[0]!;
		expect(panel.kind).toBe('similar_opportunities');
		expect((panel.config as { runId: string }).runId).toBe(RUN_ID);

		// AC5: normalization flows from the captured setup, unchanged, into the
		// search response (and, below, into the comparison view).
		expect(findBody.normalization).toEqual({ mode: 'percent_change', anchor: 'window_start' });

		// AC3: provenance reported by the (stubbed) backend survives unaltered
		// into the tool's own response.
		expect(findBody.provenance).toMatchObject({
			as_of: NOW,
			source_id: 'src.panel.mock',
			liveness: 'historical',
			timezone: 'UTC'
		});

		// 2. explain_similarity on the one candidate the panel is showing.
		const explainResult = await explainTool.execute({
			run_id: RUN_ID,
			candidate_id: CANDIDATE_ID
		});
		expect(explainResult.isError).toBeFalsy();
		const explainBody = await parseResult(explainResult);

		// AC4: the score the panel's candidate carries, the score
		// find_similar_setups returned, and the score explain_similarity
		// reconciles its contributions to are all the same value -- checked
		// against a non-uniform weight set (module-level CANDIDATE_SCORE),
		// where a wrong wiring (e.g. re-deriving instead of reading the pinned
		// run) would produce a visibly different number.
		expect(panelCandidate.score).toBe(CANDIDATE_SCORE);
		expect(explainBody.overall_score).toBe(CANDIDATE_SCORE);
		const contributionSum = Object.values(
			explainBody.contributions as Record<string, number>
		).reduce((sum, c) => sum + c, 0);
		expect(contributionSum).toBeCloseTo(CANDIDATE_SCORE, 9);

		// explain_similarity's own provenance/normalization also match the run's.
		expect(explainBody.normalization).toEqual({ mode: 'percent_change', anchor: 'window_start' });
		expect(explainBody.provenance.source_id).toBe('src.panel.mock');

		// 3. compare_setups in each of the three forms.
		for (const form of ['overlay', 'synchronized_charts', 'small_multiples'] as const) {
			const compareResult = await compareTool.execute({
				run: {
					runId: findBody.run_id,
					referenceSetupId: findBody.reference_setup_id,
					scope: findBody.scope,
					weights: findBody.weights,
					normalization: findBody.normalization,
					provenance: findBody.provenance,
					candidates: findBody.candidates.map((c: Record<string, unknown>) => ({
						candidateId: c.candidate_id,
						instrument: c.instrument,
						window: c.window,
						score: c.score,
						perFamilySimilarity: c.per_family_similarity,
						unavailableFamilies: c.unavailable_families
					})),
					warnings: findBody.warnings
				},
				candidate_ids: [CANDIDATE_ID],
				form
			});
			expect(compareResult.isError, `form ${form} should succeed`).toBeFalsy();

			const updated = readPanelState(deps.repository.get(deps.workspaceId)!);
			const comparisonView = (updated.panels[0]!.config as { comparisonView: { form: string } })
				.comparisonView;
			expect(comparisonView.form).toBe(form);
		}

		// AC3 (comparison-view leg): after compare_setups, the panel's bound run
		// is still the same run_id, so the same provenance/scope this test
		// already asserted on find_similar_setups' own response is what the
		// comparison view is drawn from -- there is no second, divergent
		// provenance path. (No Svelte render harness exists in this project --
		// see T-1012-6's Solution Approach -- so this asserts the data the
		// comparison view is built from, not a rendered DOM.)
		const finalPanel = readPanelState(deps.repository.get(deps.workspaceId)!).panels[0]!;
		expect((finalPanel.config as { runId: string }).runId).toBe(RUN_ID);

		expect(backend.searchCalls).toHaveLength(1);
	});

	it('AC6: undoing find_similar_setups removes the panel it bound', async () => {
		const backend = stubSimilarityBackend();
		const deps = harness(backend.fetch);
		const findTool = buildFindSimilarSetupsTool(deps);

		const body = await parseResult(
			await findTool.execute({ setup_id: SETUP_ID, scope: 'cross_instrument' })
		);
		expect(readPanelState(deps.repository.get(deps.workspaceId)!).panels).toHaveLength(1);

		undoChange(body.undo_token, {
			history: deps.history,
			revisionService: deps.revisions,
			clock: deps.clock,
			context: { actor: 'agent' }
		});

		expect(readPanelState(deps.repository.get(deps.workspaceId)!).panels).toHaveLength(0);
	});

	it('AC7: backend unavailability during search surfaces as a tool error and leaves the workspace unchanged', async () => {
		const backend = stubSimilarityBackend({ searchFails: true });
		const deps = harness(backend.fetch);
		const findTool = buildFindSimilarSetupsTool(deps);
		const before = deps.repository.get(deps.workspaceId);

		const result = await findTool.execute({ setup_id: SETUP_ID, scope: 'cross_instrument' });

		expect(result.isError).toBe(true);
		// No partially applied change: revision, panels, and every other field
		// of the document are byte-for-byte what they were before the call.
		expect(deps.repository.get(deps.workspaceId)).toEqual(before);
		expect(readPanelState(deps.repository.get(deps.workspaceId)!).panels).toHaveLength(0);
	});
});
