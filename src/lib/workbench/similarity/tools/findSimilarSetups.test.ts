import { describe, expect, it } from 'vitest';
import { makeProvenance } from '../../domain/provenance';
import { emptyWorkspace } from '../../domain/workspace';
import { createChangeHistory, undoChange } from '../../application/changeHistory';
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
import { makeFeatureWeightSet } from '../domain/contract';
import type { SimilarityRun } from '../domain/contract';
import type { SimilarityApiPort, SimilaritySearchRequest } from '../domain/apiPort';
import { buildFindSimilarSetupsTool } from './findSimilarSetups';

const NOW = '2026-09-02T20:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const SETUP_ID = 'setup_1';

function candidate(id: string) {
	return {
		candidateId: id,
		instrument: {
			instrumentId: 'MOCK02',
			symbol: 'MOCK02',
			exchange: 'XNAS',
			assetType: 'equity' as const
		},
		window: { start: '2023-04-01', end: '2023-04-30', timeframe: '1d' },
		score: 0.8,
		perFamilySimilarity: {
			price_shape: 0.8
		} as SimilarityRun['candidates'][number]['perFamilySimilarity'],
		unavailableFamilies: []
	};
}

function makeRun(runId: string, candidateIds: string[], warnings: string[] = []): SimilarityRun {
	return {
		runId,
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
		candidates: candidateIds.map(candidate),
		warnings
	};
}

// A fake with real behavior (never name-keyed), per this ticket's own
// Technical Considerations: it actually counts calls and returns a fresh
// run id per call, so a test that expects "search called once" is real
// evidence, not a fixture that would pass regardless.
function fakeApi(
	runsByCall: SimilarityRun[]
): SimilarityApiPort & { calls: SimilaritySearchRequest[] } {
	const calls: SimilaritySearchRequest[] = [];
	return {
		calls,
		async search(request) {
			calls.push(request);
			const run = runsByCall[calls.length - 1] ?? runsByCall[runsByCall.length - 1];
			if (!run) {
				throw new Error('no fixture run configured for this call');
			}
			return run;
		},
		async getRun() {
			throw new Error('not used by this tool');
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

	// Seed a workspace carrying one captured setup, matching what
	// capture_chart_setup (T-1011) would have produced.
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
		templates,
		api
	};
}

async function parseResult(result: { content: { type: string; text: string }[] }) {
	return JSON.parse(result.content[0]?.text ?? '{}');
}

describe('find_similar_setups tool', () => {
	it('AC1-4: searches from the captured setup and returns candidates, weights, normalization, scope, and provenance', async () => {
		const deps = harness(fakeApi([makeRun('run_1', ['A', 'B'])]));
		const tool = buildFindSimilarSetupsTool(deps);

		const result = await tool.execute({ setup_id: SETUP_ID, scope: 'cross_instrument' });

		expect(result.isError).toBeFalsy();
		const body = await parseResult(result);
		expect(body.run_id).toBe('run_1');
		expect(body.scope).toBe('cross_instrument');
		expect(body.candidates).toHaveLength(2);
		expect(body.candidates[0].per_family_similarity).toBeTruthy();
		expect(body.weights).toBeTruthy();
		expect(body.normalization).toEqual({ mode: 'percent_change', anchor: 'window_start' });
		expect(body.provenance.source_id).toBe('src.panel.mock');
		expect(body.new_revision).toBeGreaterThan(0);
		expect(body.panel_id).toBeTruthy();

		// The search request was built from the captured setup's ticker (the
		// backend engine indexes by ticker, not the stable instrument id), not
		// invented.
		const api = deps.api as ReturnType<typeof fakeApi>;
		expect(api.calls[0]).toMatchObject({ instrumentId: 'MOCK01', referenceSetupId: SETUP_ID });
	});

	it('AC10: an unknown setup_id returns an actionable error and never calls the API', async () => {
		const deps = harness(fakeApi([]));
		const tool = buildFindSimilarSetupsTool(deps);

		const result = await tool.execute({ setup_id: 'not_a_real_setup', scope: 'cross_instrument' });

		expect(result.isError).toBe(true);
		const body = await parseResult(result);
		expect(body.error).toBe('setup_not_found');
		const api = deps.api as ReturnType<typeof fakeApi>;
		expect(api.calls).toHaveLength(0);
	});

	it('AC9: no candidate clearing the minimum score returns an empty list with a warning, not an error', async () => {
		const deps = harness(
			fakeApi([makeRun('run_1', [], ['No candidate cleared the minimum score.'])])
		);
		const tool = buildFindSimilarSetupsTool(deps);

		const result = await tool.execute({
			setup_id: SETUP_ID,
			scope: 'cross_instrument',
			min_score: 0.99
		});

		expect(result.isError).toBeFalsy();
		const body = await parseResult(result);
		expect(body.candidates).toEqual([]);
		expect(body.warnings).toContain('No candidate cleared the minimum score.');
	});

	it('AC11: caller-supplied weights are echoed in the response', async () => {
		const run = makeRun('run_1', ['A']);
		const deps = harness(fakeApi([run]));
		const tool = buildFindSimilarSetupsTool(deps);

		await tool.execute({
			setup_id: SETUP_ID,
			scope: 'cross_instrument',
			weights: { price_shape: 0.9 }
		});

		const api = deps.api as ReturnType<typeof fakeApi>;
		expect(api.calls[0]?.weights).toEqual({ price_shape: 0.9 });
	});

	it('AC6: replaying the same idempotency_key produces one change and reports the first result', async () => {
		const deps = harness(fakeApi([makeRun('run_1', ['A']), makeRun('run_2', ['B'])]));
		const tool = buildFindSimilarSetupsTool(deps);

		const first = await parseResult(
			await tool.execute({
				setup_id: SETUP_ID,
				scope: 'cross_instrument',
				idempotency_key: 'key-1'
			})
		);
		const second = await parseResult(
			await tool.execute({
				setup_id: SETUP_ID,
				scope: 'cross_instrument',
				idempotency_key: 'key-1'
			})
		);

		expect(second.change_id).toBe(first.change_id);
		expect(second.new_revision).toBe(first.new_revision);
		// The panel must not have been bound to the second call's run.
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.panels).toHaveLength(1);
	});

	it('AC7: a stale expected_revision is rejected and leaves the workspace unchanged', async () => {
		const deps = harness(fakeApi([makeRun('run_1', ['A'])]));
		const tool = buildFindSimilarSetupsTool(deps);
		const before = deps.repository.get(deps.workspaceId);

		const result = await tool.execute({
			setup_id: SETUP_ID,
			scope: 'cross_instrument',
			expected_revision: 999
		});

		expect(result.isError).toBe(true);
		expect(deps.repository.get(deps.workspaceId)).toEqual(before);
	});

	it('AC8: the undo_token removes the panel the call created', async () => {
		const deps = harness(fakeApi([makeRun('run_1', ['A'])]));
		const tool = buildFindSimilarSetupsTool(deps);

		const body = await parseResult(
			await tool.execute({ setup_id: SETUP_ID, scope: 'cross_instrument' })
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
});
