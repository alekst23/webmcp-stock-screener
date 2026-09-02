import { describe, expect, it } from 'vitest';
import { makeProvenance } from '../../domain/provenance';
import { makeFeatureWeightSet } from '../domain/contract';
import type { SimilarityExplanation, SimilarityRun } from '../domain/contract';
import { SimilarityApiError, type SimilarityApiPort } from '../domain/apiPort';
import { buildExplainSimilarityTool } from './explainSimilarity';

const NOW = '2026-09-02T20:00:00.000Z';
const RUN_ID = 'run_1';
const CANDIDATE_ID = 'run_1_candidate_1';

function makeRun(): SimilarityRun {
	return {
		runId: RUN_ID,
		referenceSetupId: 'setup_1',
		scope: 'cross_instrument',
		weights: makeFeatureWeightSet({
			price_shape: 0.7,
			volume: 0.05,
			volatility: 0.05,
			relative_strength: 0.05,
			studies: 0.05,
			pattern_structure: 0.1
		}),
		normalization: { mode: 'percent_change', anchor: 'window_start' },
		provenance: makeProvenance({
			asOf: NOW,
			sourceId: 'src.panel.mock',
			sourceLabel: 'Mock Panel',
			timezone: 'UTC',
			liveness: 'historical'
		}),
		candidates: [],
		warnings: []
	};
}

// Non-uniform weights and non-uniform per-family similarities, per this
// ticket's Technical Considerations: a uniform-weight fixture could pass
// even with the underlying reconciliation math wrong.
function makeExplanation(): SimilarityExplanation {
	return {
		candidateId: CANDIDATE_ID,
		// The literal sum of the contributions below (0.56+0.02+0.01+0.015+0.05)
		// -- if these two ever drift apart by hand-arithmetic error, AC3's own
		// test should be the one to catch it, not silently pass.
		overallScore: 0.655,
		weightApplied: {
			price_shape: 0.7,
			volume: 0.05,
			volatility: 0.05,
			studies: 0.05,
			pattern_structure: 0.1
		},
		perFamilySimilarity: {
			price_shape: 0.8,
			volume: 0.4,
			volatility: 0.2,
			studies: 0.3,
			pattern_structure: 0.5
		},
		contributions: {
			price_shape: 0.56,
			volume: 0.02,
			volatility: 0.01,
			studies: 0.015,
			pattern_structure: 0.05
		},
		unavailableFamilies: ['relative_strength']
	};
}

class FakeApi implements SimilarityApiPort {
	searchCalls = 0;
	getRunCalls: string[] = [];
	explainCalls: [string, string][] = [];
	private readonly run: SimilarityRun | null;
	private readonly explanation: SimilarityExplanation | null;

	constructor(run: SimilarityRun | null, explanation: SimilarityExplanation | null) {
		this.run = run;
		this.explanation = explanation;
	}

	async search(): Promise<SimilarityRun> {
		this.searchCalls += 1;
		// AC4: never re-runs the search. If this tool ever calls it, that is a
		// real regression, not a hypothetical.
		throw new Error('explain_similarity must never call search()');
	}

	async getRun(runId: string): Promise<SimilarityRun> {
		this.getRunCalls.push(runId);
		if (!this.run) {
			throw new SimilarityApiError('not_found_run', `Similarity run not found: '${runId}'`);
		}
		return this.run;
	}

	async explain(runId: string, candidateId: string): Promise<SimilarityExplanation> {
		this.explainCalls.push([runId, candidateId]);
		if (!this.explanation) {
			throw new SimilarityApiError(
				'not_found_candidate',
				`Candidate '${candidateId}' is not part of run '${runId}'`
			);
		}
		return this.explanation;
	}
}

async function parseResult(result: { content: { type: string; text: string }[] }) {
	return JSON.parse(result.content[0]?.text ?? '{}');
}

describe('explain_similarity tool', () => {
	it('AC1-2: returns the per-family weight, similarity, and contribution for a known candidate', async () => {
		const api = new FakeApi(makeRun(), makeExplanation());
		const tool = buildExplainSimilarityTool({ api });

		const result = await tool.execute({ run_id: RUN_ID, candidate_id: CANDIDATE_ID });

		expect(result.isError).toBeFalsy();
		const body = await parseResult(result);
		expect(body.candidate_id).toBe(CANDIDATE_ID);
		expect(body.weight_applied.price_shape).toBeCloseTo(0.7);
		expect(body.per_family_similarity.price_shape).toBeCloseTo(0.8);
		expect(body.contributions.price_shape).toBeCloseTo(0.56);
	});

	it('AC3: the contributions reconcile to the overall score within tolerance', async () => {
		const explanation = makeExplanation();
		const api = new FakeApi(makeRun(), explanation);
		const tool = buildExplainSimilarityTool({ api });

		const body = await parseResult(
			await tool.execute({ run_id: RUN_ID, candidate_id: CANDIDATE_ID })
		);

		const total = Object.values(body.contributions as Record<string, number>).reduce(
			(sum, c) => sum + c,
			0
		);
		expect(Math.abs(total - body.overall_score)).toBeLessThan(1e-6);
		expect(body.overall_score).toBe(explanation.overallScore);
	});

	it('AC5: unavailable families are named, not reported as a zero contribution', async () => {
		const api = new FakeApi(makeRun(), makeExplanation());
		const tool = buildExplainSimilarityTool({ api });

		const body = await parseResult(
			await tool.execute({ run_id: RUN_ID, candidate_id: CANDIDATE_ID })
		);

		expect(body.unavailable_families).toEqual(['relative_strength']);
		expect(body.contributions.relative_strength).toBeUndefined();
	});

	it('AC6: states the normalization and full market-data provenance', async () => {
		const api = new FakeApi(makeRun(), makeExplanation());
		const tool = buildExplainSimilarityTool({ api });

		const body = await parseResult(
			await tool.execute({ run_id: RUN_ID, candidate_id: CANDIDATE_ID })
		);

		expect(body.normalization).toEqual({ mode: 'percent_change', anchor: 'window_start' });
		expect(body.provenance.source_id).toBe('src.panel.mock');
		expect(body.provenance.liveness).toBe('historical');
	});

	it('AC4: never calls search, only getRun then explain, in that order', async () => {
		const api = new FakeApi(makeRun(), makeExplanation());
		const tool = buildExplainSimilarityTool({ api });

		await tool.execute({ run_id: RUN_ID, candidate_id: CANDIDATE_ID });

		expect(api.searchCalls).toBe(0);
		expect(api.getRunCalls).toEqual([RUN_ID]);
		expect(api.explainCalls).toEqual([[RUN_ID, CANDIDATE_ID]]);
	});

	it('AC8: an unavailable run states that a new search is required, distinct from a candidate mismatch', async () => {
		const api = new FakeApi(null, makeExplanation());
		const tool = buildExplainSimilarityTool({ api });

		const result = await tool.execute({ run_id: 'gone', candidate_id: CANDIDATE_ID });

		expect(result.isError).toBe(true);
		const body = await parseResult(result);
		expect(body.error).toBe('similarity_run_unavailable');
		expect(body.message ?? JSON.stringify(body)).toMatch(/new search/i);
		// explain() must never be called once getRun already failed.
		expect(api.explainCalls).toEqual([]);
	});

	it('AC7: a candidate not part of a real run is rejected identifying the mismatch', async () => {
		const api = new FakeApi(makeRun(), null);
		const tool = buildExplainSimilarityTool({ api });

		const result = await tool.execute({ run_id: RUN_ID, candidate_id: 'not_a_real_candidate' });

		expect(result.isError).toBe(true);
		const body = await parseResult(result);
		expect(body.error).toBe('similarity_candidate_not_found');
		expect(body.candidate_id).toBe('not_a_real_candidate');
	});

	it('AC9: is read-only -- no mutation envelope fields in the response', async () => {
		const api = new FakeApi(makeRun(), makeExplanation());
		const tool = buildExplainSimilarityTool({ api });

		const body = await parseResult(
			await tool.execute({ run_id: RUN_ID, candidate_id: CANDIDATE_ID })
		);

		for (const field of ['change_id', 'new_revision', 'undo_token', 'affected_ids']) {
			expect(body[field]).toBeUndefined();
		}
	});
});
