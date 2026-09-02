import { describe, expect, it } from 'vitest';
import { makeProvenance } from '../../../domain/provenance';
import { emptyWorkspace } from '../../../domain/workspace';
import { createChangeHistory } from '../../../application/changeHistory';
import { createIdempotencyCache } from '../../../application/idempotency';
import { createRevisionService } from '../../../application/revisionService';
import { createIdSequencer } from '../../../domain/ids';
import { createLocalWorkspaceRepository } from '../../../infra/workspaceRepository';
import { memoryStorage } from '../../../testSupport';
import { writeCapturedSetup } from '../../../chart/domain/capturedSetup';
import type { CapturedChartSetup } from '../../../chart/domain/capturedSetup';
import { createPanel } from '../../../../panels/application/createPanel';
import { createPanelRegistry } from '../../../../panels/registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../../../../panels/registry/sourceRendererRegistry';
import { registerDefaultSourceRendererTypes } from '../../../../panels/registry/defaultSourceRendererTypes';
import {
	createLayoutTemplateRegistry,
	registerDefaultLayoutTemplates
} from '../../../../panels/domain/layoutTemplates';
import { similarOpportunitiesPanelKindDefinition } from '../../panel/domain/panelKind';
import { makeFeatureWeightSet } from '../../domain/contract';
import type { SimilarityCandidate, SimilarityRun } from '../../domain/contract';
import {
	SimilarityApiError,
	type SimilarityApiPort,
	type SimilaritySearchRequest
} from '../../domain/apiPort';
import { buildRefineSimilaritySearchTool } from './refineSimilaritySearch';

const NOW = '2026-09-02T20:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const SETUP_ID = 'setup_1';
const SOURCE_RUN_ID = 'run_1';

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

function sourceRun(): SimilarityRun {
	return {
		runId: SOURCE_RUN_ID,
		referenceSetupId: SETUP_ID,
		scope: 'cross_instrument',
		weights: makeFeatureWeightSet(),
		normalization: { mode: 'percent_change', anchor: 'window_start' },
		provenance: makeProvenance({
			asOf: NOW,
			sourceId: 'src.panel.mock',
			sourceLabel: 'Mock Panel',
			timezone: 'UTC',
			liveness: 'historical'
		}),
		candidates: [
			candidate('A', { price_shape: 0.9, volume: 0.2 }),
			candidate('B', { price_shape: 0.1, volume: 0.8 })
		],
		warnings: []
	};
}

function fakeApi(
	source: SimilarityRun
): SimilarityApiPort & { searchCalls: SimilaritySearchRequest[] } {
	const searchCalls: SimilaritySearchRequest[] = [];
	let nextId = 2;
	return {
		searchCalls,
		async getRun(runId) {
			if (runId !== source.runId) {
				throw new SimilarityApiError('not_found_run', `No such run: ${runId}.`);
			}
			return source;
		},
		async search(request) {
			searchCalls.push(request);
			return {
				...source,
				runId: `run_${nextId++}`,
				weights: (request.weights as SimilarityRun['weights']) ?? source.weights
			};
		},
		async explain() {
			throw new Error('not used by this tool');
		}
	};
}

function harness(api: SimilarityApiPort) {
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

	const deps = {
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

	createPanel(deps, {
		context: { actor: 'agent' },
		kind: 'similar_opportunities',
		config: { runId: SOURCE_RUN_ID, comparisonView: null }
	});

	return deps;
}

async function parseResult(result: { content: { type: string; text: string }[] }) {
	return JSON.parse(result.content[0]?.text ?? '{}');
}

describe('refine_similarity_search tool', () => {
	it('AC1/AC2/AC3/AC9: refines from feedback, reports weight_changes, and returns the mutation envelope', async () => {
		const deps = harness(fakeApi(sourceRun()));
		const tool = buildRefineSimilaritySearchTool(deps);

		const result = await tool.execute({
			run_id: SOURCE_RUN_ID,
			accepted_match_ids: ['A'],
			rejected_match_ids: ['B']
		});

		expect(result.isError).toBeFalsy();
		const body = await parseResult(result);
		expect(body.run_id).not.toBe(SOURCE_RUN_ID);
		expect(body.source_run_id).toBe(SOURCE_RUN_ID);
		expect(body.new_revision).toBeGreaterThan(0);
		expect(Array.isArray(body.weight_changes)).toBe(true);
		expect(body.weight_changes.length).toBeGreaterThan(0);
		for (const change of body.weight_changes) {
			expect(change).toHaveProperty('feature');
			expect(change).toHaveProperty('before');
			expect(change).toHaveProperty('after');
			expect(change.before).not.toBe(change.after);
		}
		expect(body.panel_id).toBeTruthy();
	});

	it('AC4: rejects a request with neither accepted nor rejected matches', async () => {
		const deps = harness(fakeApi(sourceRun()));
		const tool = buildRefineSimilaritySearchTool(deps);

		const result = await tool.execute({ run_id: SOURCE_RUN_ID });

		expect(result.isError).toBe(true);
		const body = await parseResult(result);
		expect(body.error).toBe('similarity_refinement_feedback_required');
		const api = deps.api as ReturnType<typeof fakeApi>;
		expect(api.searchCalls).toHaveLength(0);
	});

	it('AC5: only rejected matches still refines and the response warns one-sided', async () => {
		const deps = harness(fakeApi(sourceRun()));
		const tool = buildRefineSimilaritySearchTool(deps);

		const result = await tool.execute({ run_id: SOURCE_RUN_ID, rejected_match_ids: ['B'] });

		expect(result.isError).toBeFalsy();
		const body = await parseResult(result);
		expect(body.warnings.some((w: string) => /one-sided/i.test(w))).toBe(true);
	});

	it('AC6: rejects a match marked both accepted and rejected, naming it', async () => {
		const deps = harness(fakeApi(sourceRun()));
		const tool = buildRefineSimilaritySearchTool(deps);

		const result = await tool.execute({
			run_id: SOURCE_RUN_ID,
			accepted_match_ids: ['A'],
			rejected_match_ids: ['A']
		});

		expect(result.isError).toBe(true);
		const body = await parseResult(result);
		expect(body.error).toBe('similarity_refinement_conflicting_match');
		expect(body.match_ids).toEqual(['A']);
	});

	it('AC7: rejects a match id that does not belong to the named search, naming it', async () => {
		const deps = harness(fakeApi(sourceRun()));
		const tool = buildRefineSimilaritySearchTool(deps);

		const result = await tool.execute({
			run_id: SOURCE_RUN_ID,
			accepted_match_ids: ['not_a_real_candidate']
		});

		expect(result.isError).toBe(true);
		const body = await parseResult(result);
		expect(body.error).toBe('similarity_refinement_unknown_match');
		expect(body.match_ids).toEqual(['not_a_real_candidate']);
	});

	it('"run_id" is required', async () => {
		const deps = harness(fakeApi(sourceRun()));
		const tool = buildRefineSimilaritySearchTool(deps);

		const result = await tool.execute({ accepted_match_ids: ['A'] });

		expect(result.isError).toBe(true);
	});

	it('a run_id that is no longer available returns an actionable error naming it', async () => {
		const deps = harness(fakeApi(sourceRun()));
		const tool = buildRefineSimilaritySearchTool(deps);

		const result = await tool.execute({
			run_id: 'run_does_not_exist',
			accepted_match_ids: ['A']
		});

		expect(result.isError).toBe(true);
		const body = await parseResult(result);
		expect(body.error).toBe('similarity_run_unavailable');
		expect(body.message).toContain('run_does_not_exist');
	});
});
