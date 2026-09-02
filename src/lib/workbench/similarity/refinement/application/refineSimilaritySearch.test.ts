import { describe, expect, it } from 'vitest';
import { makeProvenance } from '../../../domain/provenance';
import { emptyWorkspace } from '../../../domain/workspace';
import { createChangeHistory, undoChange } from '../../../application/changeHistory';
import { createIdempotencyCache } from '../../../application/idempotency';
import { createRevisionService } from '../../../application/revisionService';
import { createIdSequencer } from '../../../domain/ids';
import { createLocalWorkspaceRepository } from '../../../infra/workspaceRepository';
import { memoryStorage } from '../../../testSupport';
import { writeCapturedSetup } from '../../../chart/domain/capturedSetup';
import type { CapturedChartSetup } from '../../../chart/domain/capturedSetup';
import { createPanel } from '../../../../panels/application/createPanel';
import { readPanelState, writePanelState } from '../../../../panels/application';
import { PanelOperationError } from '../../../../panels/application/errors';
import { makePanel } from '../../../../panels/domain/panel';
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
import { SimilarityRefinementError } from '../domain/refinement';
import { refineSimilaritySearch } from './refineSimilaritySearch';

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

// A fake with real behavior, never name-keyed: it actually counts calls and
// mints a fresh run id per search call, so "search was/wasn't called" and
// "distinct run id" assertions are real evidence.
function fakeApi(source: SimilarityRun): SimilarityApiPort & {
	searchCalls: SimilaritySearchRequest[];
	getRunCalls: string[];
} {
	const searchCalls: SimilaritySearchRequest[] = [];
	const getRunCalls: string[] = [];
	let nextId = 2;
	return {
		searchCalls,
		getRunCalls,
		async getRun(runId) {
			getRunCalls.push(runId);
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
			throw new Error('not used by this use case');
		}
	};
}

function harness() {
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

	return {
		workspaceId: WORKSPACE_ID,
		repository,
		revisions,
		history,
		clock,
		ids,
		kinds,
		sourceRenderer,
		templates
	};
}

// Seeds a similar_opportunities panel already bound to the given run, the
// state find_similar_setups would have left behind.
function bindPanel(deps: ReturnType<typeof harness>, runId: string): string {
	const envelope = createPanel(deps, {
		context: { actor: 'agent' },
		kind: 'similar_opportunities',
		config: { runId, comparisonView: null }
	});
	return envelope.affectedIds[0]!;
}

describe('refineSimilaritySearch', () => {
	it('AC1/AC2/AC3: refines toward the accepted matches, reports every changed weight, and mints a distinct run id', async () => {
		const deps = harness();
		const panelId = bindPanel(deps, SOURCE_RUN_ID);
		const api = fakeApi(sourceRun());

		const result = await refineSimilaritySearch(
			{ ...deps, api },
			{
				context: { actor: 'agent' },
				requestInput: {},
				runId: SOURCE_RUN_ID,
				acceptedMatchIds: ['A'],
				rejectedMatchIds: ['B'],
				panelId: undefined
			}
		);

		expect(result.refinedRun.runId).not.toBe(SOURCE_RUN_ID);
		expect(result.changes.length).toBeGreaterThan(0);
		for (const change of result.changes) {
			expect(change.before).not.toBe(change.after);
		}
		expect(result.panelId).toBe(panelId);

		// AC3's other half: the source run is never touched by this call --
		// it is still gettable by its own id, unchanged.
		const stillReadable = await api.getRun(SOURCE_RUN_ID);
		expect(stillReadable.weights).toEqual(sourceRun().weights);
	});

	it('rebinds the panel bound to the source run onto the refined run', async () => {
		const deps = harness();
		const panelId = bindPanel(deps, SOURCE_RUN_ID);
		const api = fakeApi(sourceRun());

		const result = await refineSimilaritySearch(
			{ ...deps, api },
			{
				context: { actor: 'agent' },
				requestInput: {},
				runId: SOURCE_RUN_ID,
				acceptedMatchIds: ['A'],
				rejectedMatchIds: ['B']
			}
		);

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		const panel = state.panels.find((p) => p.id === panelId)!;
		expect((panel.config as { runId: string }).runId).toBe(result.refinedRun.runId);
	});

	it('AC4: rejects feedback with neither accepted nor rejected matches, and never calls search', async () => {
		const deps = harness();
		bindPanel(deps, SOURCE_RUN_ID);
		const api = fakeApi(sourceRun());

		await expect(
			refineSimilaritySearch(
				{ ...deps, api },
				{
					context: { actor: 'agent' },
					requestInput: {},
					runId: SOURCE_RUN_ID,
					acceptedMatchIds: [],
					rejectedMatchIds: []
				}
			)
		).rejects.toThrow(SimilarityRefinementError);
		expect(api.searchCalls).toHaveLength(0);
	});

	it('AC5: only-rejection feedback still refines and warns one-sided', async () => {
		const deps = harness();
		bindPanel(deps, SOURCE_RUN_ID);
		const api = fakeApi(sourceRun());

		const result = await refineSimilaritySearch(
			{ ...deps, api },
			{
				context: { actor: 'agent' },
				requestInput: {},
				runId: SOURCE_RUN_ID,
				acceptedMatchIds: [],
				rejectedMatchIds: ['B']
			}
		);

		expect(result.envelope.warnings.some((w) => /one-sided/i.test(w))).toBe(true);
	});

	it('AC6: rejects a match marked both accepted and rejected, and never calls search', async () => {
		const deps = harness();
		bindPanel(deps, SOURCE_RUN_ID);
		const api = fakeApi(sourceRun());

		await expect(
			refineSimilaritySearch(
				{ ...deps, api },
				{
					context: { actor: 'agent' },
					requestInput: {},
					runId: SOURCE_RUN_ID,
					acceptedMatchIds: ['A'],
					rejectedMatchIds: ['A']
				}
			)
		).rejects.toThrow(SimilarityRefinementError);
		expect(api.searchCalls).toHaveLength(0);
	});

	it('AC7: rejects a match id that does not belong to the named search', async () => {
		const deps = harness();
		bindPanel(deps, SOURCE_RUN_ID);
		const api = fakeApi(sourceRun());

		await expect(
			refineSimilaritySearch(
				{ ...deps, api },
				{
					context: { actor: 'agent' },
					requestInput: {},
					runId: SOURCE_RUN_ID,
					acceptedMatchIds: ['not_a_real_candidate'],
					rejectedMatchIds: []
				}
			)
		).rejects.toThrow(SimilarityRefinementError);
		expect(api.searchCalls).toHaveLength(0);
	});

	it('AC9: replaying the same idempotency_key produces one change and does not refine twice', async () => {
		const deps = harness();
		bindPanel(deps, SOURCE_RUN_ID);
		const api = fakeApi(sourceRun());
		const request = {
			context: { actor: 'agent' as const, idempotencyKey: 'key-1' },
			requestInput: { idempotency_key: 'key-1', run_id: SOURCE_RUN_ID },
			runId: SOURCE_RUN_ID,
			acceptedMatchIds: ['A'],
			rejectedMatchIds: ['B']
		};

		const first = await refineSimilaritySearch({ ...deps, api }, request);
		const second = await refineSimilaritySearch({ ...deps, api }, request);

		expect(second.envelope.changeId).toBe(first.envelope.changeId);
		expect(second.envelope.newRevision).toBe(first.envelope.newRevision);
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect((state.panels[0]!.config as { runId: string }).runId).toBe(first.refinedRun.runId);
	});

	it('AC9: a stale expected_revision is rejected and leaves the panel binding unchanged', async () => {
		const deps = harness();
		bindPanel(deps, SOURCE_RUN_ID);
		const api = fakeApi(sourceRun());
		const before = deps.repository.get(deps.workspaceId);

		await expect(
			refineSimilaritySearch(
				{ ...deps, api },
				{
					context: { actor: 'agent', expectedRevision: 999 },
					requestInput: {},
					runId: SOURCE_RUN_ID,
					acceptedMatchIds: ['A'],
					rejectedMatchIds: ['B']
				}
			)
		).rejects.toThrow();
		expect(deps.repository.get(deps.workspaceId)).toEqual(before);
	});

	it('AC10: the undo_token restores the panel to the source run -- the previous weights exactly', async () => {
		const deps = harness();
		bindPanel(deps, SOURCE_RUN_ID);
		const api = fakeApi(sourceRun());

		const result = await refineSimilaritySearch(
			{ ...deps, api },
			{
				context: { actor: 'agent' },
				requestInput: {},
				runId: SOURCE_RUN_ID,
				acceptedMatchIds: ['A'],
				rejectedMatchIds: ['B']
			}
		);
		expect(result.envelope.undoToken).toBeTruthy();
		expect(result.refinedRun.runId).not.toBe(SOURCE_RUN_ID);

		// Before undo: the panel is actually bound to the refined run, not
		// still (or trivially) pointed at the source -- otherwise the undo
		// assertion below would hold vacuously even if the rebind never
		// happened.
		const boundBeforeUndo = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect((boundBeforeUndo.panels[0]!.config as { runId: string }).runId).toBe(
			result.refinedRun.runId
		);

		undoChange(result.envelope.undoToken!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock: deps.clock,
			context: { actor: 'agent' }
		});

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect((state.panels[0]!.config as { runId: string }).runId).toBe(SOURCE_RUN_ID);

		// The source run itself was never mutated in place -- restoring the
		// binding restores the weights exactly because there was never a
		// second copy of them to drift.
		const restored = await api.getRun(SOURCE_RUN_ID);
		expect(restored.weights).toEqual(sourceRun().weights);
	});

	it('requires a target panel: an unbound run with no explicit panel_id is rejected', async () => {
		const deps = harness();
		const api = fakeApi(sourceRun());

		await expect(
			refineSimilaritySearch(
				{ ...deps, api },
				{
					context: { actor: 'agent' },
					requestInput: {},
					runId: SOURCE_RUN_ID,
					acceptedMatchIds: ['A'],
					rejectedMatchIds: ['B']
				}
			)
		).rejects.toThrow(PanelOperationError);
	});

	it('an explicit panel_id of the wrong kind is rejected', async () => {
		const deps = harness();
		// Seeded directly (not through createPanel/the registry): the failure
		// under test is refine's own kind guard, not panel creation.
		const otherPanel = makePanel({
			id: 'panel_chart_1',
			kind: 'chart',
			title: 'Chart',
			config: {},
			rect: { col: 0, row: 0, colSpan: 4, rowSpan: 4 }
		});
		const doc = deps.repository.get(deps.workspaceId)!;
		deps.repository.put(
			writePanelState(doc, { panels: [otherPanel], links: { groups: [] }, selections: {} })
		);
		const api = fakeApi(sourceRun());

		await expect(
			refineSimilaritySearch(
				{ ...deps, api },
				{
					context: { actor: 'agent' },
					requestInput: {},
					runId: SOURCE_RUN_ID,
					acceptedMatchIds: ['A'],
					rejectedMatchIds: ['B'],
					panelId: otherPanel.id
				}
			)
		).rejects.toThrow(PanelOperationError);
	});
});
