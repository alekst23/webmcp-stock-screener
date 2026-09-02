import { describe, expect, it } from 'vitest';
import { makeProvenance } from '../../../domain/provenance';
import { createPanel } from '../../../../panels/application/createPanel';
import { createPanelRegistry } from '../../../../panels/registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../../../../panels/registry/sourceRendererRegistry';
import { registerDefaultSourceRendererTypes } from '../../../../panels/registry/defaultSourceRendererTypes';
import {
	createLayoutTemplateRegistry,
	registerDefaultLayoutTemplates
} from '../../../../panels/domain/layoutTemplates';
import { createChangeHistory } from '../../../application/changeHistory';
import { createIdempotencyCache } from '../../../application/idempotency';
import { createRevisionService } from '../../../application/revisionService';
import { createIdSequencer } from '../../../domain/ids';
import { createLocalWorkspaceRepository } from '../../../infra/workspaceRepository';
import { memoryStorage } from '../../../testSupport';
import { makeFeatureWeightSet } from '../../domain/contract';
import type { SimilarityCandidate, SimilarityRun } from '../../domain/contract';
import { similarOpportunitiesPanelKindDefinition } from '../../panel/domain/panelKind';
import { buildCompareSetupsTool } from './compareSetups';

function harness(workspaceId = 'workspace_1') {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const clock = { now: () => '2026-09-02T20:00:00.000Z' };
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
	return {
		workspaceId,
		repository,
		revisions,
		history: createChangeHistory(),
		clock,
		ids,
		kinds,
		sourceRenderer,
		templates
	};
}

function candidate(id: string): SimilarityCandidate {
	return {
		candidateId: id,
		instrument: {
			instrumentId: `inst:XNAS:${id}`,
			symbol: id,
			exchange: 'XNAS',
			assetType: 'equity'
		},
		window: { start: '2026-01-01', end: '2026-01-10', timeframe: '1d' },
		score: 0.5,
		perFamilySimilarity: { price_shape: 0.5 },
		unavailableFamilies: []
	};
}

function makeRun(candidateIds: string[]): SimilarityRun {
	return {
		runId: 'run_1',
		referenceSetupId: 'setup_1',
		scope: 'cross_instrument',
		weights: makeFeatureWeightSet(),
		normalization: { mode: 'percent_change', anchor: 'window_start' },
		provenance: makeProvenance({
			asOf: '2026-09-02T20:00:00.000Z',
			sourceId: 'src.x',
			sourceLabel: 'X',
			timezone: 'UTC',
			liveness: 'historical'
		}),
		candidates: candidateIds.map(candidate),
		warnings: []
	};
}

async function parseResult(result: { content: { type: string; text: string }[] }) {
	return JSON.parse(result.content[0]?.text ?? '{}');
}

describe('compare_setups tool', () => {
	it('returns the mutation envelope on a valid comparison request', async () => {
		const deps = harness();
		createPanel(deps, { context: { actor: 'agent' }, kind: 'similar_opportunities' });
		const tool = buildCompareSetupsTool(deps);

		const result = await tool.execute({
			run: makeRun(['A', 'B']),
			candidate_ids: ['A', 'B'],
			form: 'overlay',
			panel_id: 'panel_similar_opportunities_1'
		});

		expect(result.isError).toBeFalsy();
		const body = await parseResult(result);
		expect(body.new_revision).toBeGreaterThan(0);
		expect(body.affected_ids).toEqual(['panel_similar_opportunities_1']);
	});

	it('rejects a request missing "run" without touching the workspace', async () => {
		const deps = harness();
		const tool = buildCompareSetupsTool(deps);

		const result = await tool.execute({ candidate_ids: ['A'], form: 'overlay' });

		expect(result.isError).toBe(true);
	});

	it('rejects an invalid comparison form', async () => {
		const deps = harness();
		createPanel(deps, { context: { actor: 'agent' }, kind: 'similar_opportunities' });
		const tool = buildCompareSetupsTool(deps);

		const result = await tool.execute({
			run: makeRun(['A']),
			candidate_ids: ['A'],
			form: 'not_a_real_form'
		});

		expect(result.isError).toBe(true);
	});

	it('AC8: maps an unknown candidate id to a client-actionable error, not a 500-style crash', async () => {
		const deps = harness();
		createPanel(deps, { context: { actor: 'agent' }, kind: 'similar_opportunities' });
		const tool = buildCompareSetupsTool(deps);

		const result = await tool.execute({
			run: makeRun(['A']),
			candidate_ids: ['NOT_A_CANDIDATE'],
			form: 'overlay',
			panel_id: 'panel_similar_opportunities_1'
		});

		expect(result.isError).toBe(true);
		const body = await parseResult(result);
		expect(body.error).toBe('unknown_candidate');
		expect(body.candidate_ids).toEqual(['NOT_A_CANDIDATE']);
	});
});
