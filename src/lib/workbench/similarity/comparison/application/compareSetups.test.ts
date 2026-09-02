import { describe, expect, it } from 'vitest';
import { makeProvenance } from '../../../domain/provenance';
import { PanelOperationError, readPanelState } from '../../../../panels/application';
import { createPanel } from '../../../../panels/application/createPanel';
import { createPanelRegistry } from '../../../../panels/registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../../../../panels/registry/sourceRendererRegistry';
import { registerDefaultSourceRendererTypes } from '../../../../panels/registry/defaultSourceRendererTypes';
import {
	createLayoutTemplateRegistry,
	registerDefaultLayoutTemplates
} from '../../../../panels/domain/layoutTemplates';
import { createChangeHistory, undoChange } from '../../../application/changeHistory';
import { createIdempotencyCache } from '../../../application/idempotency';
import { createRevisionService } from '../../../application/revisionService';
import { createIdSequencer } from '../../../domain/ids';
import { createLocalWorkspaceRepository } from '../../../infra/workspaceRepository';
import { memoryStorage } from '../../../testSupport';
import { makeFeatureWeightSet } from '../../domain/contract';
import type { SimilarityCandidate, SimilarityRun } from '../../domain/contract';
import { similarOpportunitiesPanelKindDefinition } from '../../panel/domain/panelKind';
import { compareSetups } from './compareSetups';

// A local harness rather than panels/application/testSupport.ts's shared
// createPanelTestHarness(): that helper registers EPIC-1007's placeholder
// similar_opportunities kind, and PanelRegistry.register() throws on a
// duplicate with no replace path (the same registry-collision finding
// T-1012-6's Solution Approach documents) -- so a harness that wants THIS
// ticket's real kind builds its own registry instead of the shared default.
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

function makeRun(runId: string, candidateIds: string[]): SimilarityRun {
	return {
		runId,
		referenceSetupId: 'setup_1',
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

function ctx() {
	return { actor: 'agent' as const };
}

describe('compareSetups', () => {
	it('writes the comparison view onto the panel explicitly named by panel_id', () => {
		const deps = harness();
		createPanel(deps, { context: ctx(), kind: 'similar_opportunities' });
		const run = makeRun('run_1', ['A', 'B']);

		const envelope = compareSetups(deps, {
			context: ctx(),
			run,
			candidateIds: ['A', 'B'],
			form: 'overlay',
			panelId: 'panel_similar_opportunities_1'
		});

		expect(envelope.affectedIds).toEqual(['panel_similar_opportunities_1']);
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		const panel = state.panels.find((p) => p.id === 'panel_similar_opportunities_1')!;
		expect(panel.config.comparisonView).toMatchObject({
			runId: 'run_1',
			form: 'overlay',
			candidateIds: ['A', 'B']
		});
	});

	it('defaults to the similar_opportunities panel whose config.runId matches the run', () => {
		const deps = harness();
		createPanel(deps, { context: ctx(), kind: 'similar_opportunities' });
		// Bind it to the run first (as find_similar_setups' wiring would).
		compareSetups(deps, {
			context: ctx(),
			run: makeRun('run_1', ['A']),
			candidateIds: ['A'],
			form: 'overlay',
			panelId: 'panel_similar_opportunities_1'
		});

		const envelope = compareSetups(deps, {
			context: ctx(),
			run: makeRun('run_1', ['A', 'B']),
			candidateIds: ['B'],
			form: 'small_multiples'
		});

		expect(envelope.affectedIds).toEqual(['panel_similar_opportunities_1']);
	});

	it('fails with an actionable error and no view change when no bound panel exists and none is named', () => {
		const deps = harness();
		const before = deps.repository.get(deps.workspaceId);

		expect(() =>
			compareSetups(deps, {
				context: ctx(),
				run: makeRun('run_1', ['A']),
				candidateIds: ['A'],
				form: 'overlay'
			})
		).toThrow(PanelOperationError);

		expect(deps.repository.get(deps.workspaceId)).toEqual(before);
	});

	it('AC8: rejects a candidate id not part of the run, making no document write at all', () => {
		const deps = harness();
		createPanel(deps, { context: ctx(), kind: 'similar_opportunities' });
		const before = deps.repository.get(deps.workspaceId);

		expect(() =>
			compareSetups(deps, {
				context: ctx(),
				run: makeRun('run_1', ['A']),
				candidateIds: ['NOT_A_CANDIDATE'],
				form: 'overlay',
				panelId: 'panel_similar_opportunities_1'
			})
		).toThrow(/not part of run/);

		expect(
			deps.repository.get(deps.workspaceId),
			'a rejected candidate selection must leave the workspace document unchanged'
		).toEqual(before);
	});

	it('AC10: the returned undo_token restores the prior comparison view', () => {
		const deps = harness();
		createPanel(deps, { context: ctx(), kind: 'similar_opportunities' });
		compareSetups(deps, {
			context: ctx(),
			run: makeRun('run_1', ['A']),
			candidateIds: ['A'],
			form: 'overlay',
			panelId: 'panel_similar_opportunities_1'
		});

		const second = compareSetups(deps, {
			context: ctx(),
			run: makeRun('run_1', ['A', 'B']),
			candidateIds: ['B'],
			form: 'small_multiples',
			panelId: 'panel_similar_opportunities_1'
		});
		expect(second.undoToken).toBeTruthy();

		undoChange(second.undoToken as string, {
			history: deps.history,
			revisionService: deps.revisions,
			clock: deps.clock,
			context: ctx()
		});

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		const panel = state.panels.find((p) => p.id === 'panel_similar_opportunities_1')!;
		expect(panel.config.comparisonView).toMatchObject({ form: 'overlay', candidateIds: ['A'] });
	});
});
