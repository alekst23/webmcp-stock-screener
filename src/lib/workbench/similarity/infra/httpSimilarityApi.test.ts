import { describe, expect, it } from 'vitest';
import { SimilarityApiError } from '../domain/apiPort';
import { createHttpSimilarityApi } from './httpSimilarityApi';

interface FetchCall {
	url: string;
	method: string;
	body: Record<string, unknown> | null;
}

function stubFetch(handler: (call: FetchCall) => Promise<Response> | Response) {
	const calls: FetchCall[] = [];
	const impl = (async (url: string, init?: RequestInit) => {
		const call: FetchCall = {
			url: String(url),
			method: init?.method ?? 'GET',
			body: init?.body ? JSON.parse(String(init.body)) : null
		};
		calls.push(call);
		return handler(call);
	}) as unknown as typeof fetch;
	return { impl, calls };
}

function jsonResponse(payload: unknown, init?: { status?: number; statusText?: string }): Response {
	return {
		ok: (init?.status ?? 200) < 400,
		status: init?.status ?? 200,
		statusText: init?.statusText ?? 'OK',
		json: async () => payload
	} as Response;
}

const WIRE_RUN = {
	run_id: 'similarity_run_1',
	reference_setup_id: 'setup_1',
	scope: 'cross_instrument',
	weights: {
		weights: {
			price_shape: 0.5,
			volume: 0.1,
			volatility: 0.1,
			relative_strength: 0.1,
			studies: 0.1,
			pattern_structure: 0.1
		}
	},
	normalization: { mode: 'percent_change', anchor: 'window_start' },
	provenance: {
		as_of: '2026-09-02T20:00:00.000Z',
		source_id: 'src.panel.mock',
		source_label: 'Mock Panel',
		liveness: 'historical',
		timezone: 'UTC',
		engine_version: '0.1.0'
	},
	candidates: [
		{
			candidate_id: 'similarity_run_1_candidate_1',
			instrument: { instrument_id: 'MOCK02', symbol: 'MOCK02', exchange: null, asset_type: null },
			window: { start: '2023-04-01', end: '2023-04-30', timeframe: '1d' },
			score: 0.82,
			per_family_similarity: { price_shape: 0.9 },
			unavailable_families: ['relative_strength']
		}
	],
	warnings: []
};

describe('createHttpSimilarityApi', () => {
	describe('search', () => {
		it('posts the request in snake_case and parses the response into the TS domain shape', async () => {
			const { impl, calls } = stubFetch(() => jsonResponse(WIRE_RUN));
			const api = createHttpSimilarityApi({ baseUrl: 'https://backend.test', fetchImpl: impl });

			const run = await api.search({
				instrumentId: 'MOCK01',
				window: { start: '2023-03-01', end: '2023-03-31', timeframe: '1d' },
				scope: 'cross_instrument',
				referenceSetupId: 'setup_1'
			});

			expect(calls[0]?.url).toBe('https://backend.test/api/similarity/search');
			expect(calls[0]?.body).toMatchObject({
				instrument_id: 'MOCK01',
				scope: 'cross_instrument',
				reference_setup_id: 'setup_1'
			});
			expect(run.runId).toBe('similarity_run_1');
			expect(run.scope).toBe('cross_instrument');
			// The Python-side FeatureWeightSet nests its own `weights` field --
			// the client must unwrap it, not pass the wrapper through.
			expect(run.weights.price_shape).toBeCloseTo(0.5);
			expect(run.candidates).toHaveLength(1);
			expect(run.candidates[0]?.candidateId).toBe('similarity_run_1_candidate_1');
			expect(run.candidates[0]?.unavailableFamilies).toEqual(['relative_strength']);
			// A null exchange/asset_type from the Python side must not produce
			// an invalid TS InstrumentRef.
			expect(run.candidates[0]?.instrument.assetType).toBe('equity');
		});

		it('maps a 422 response to a SimilarityApiError with the server message', async () => {
			const { impl } = stubFetch(() =>
				jsonResponse(
					{ detail: { message: 'No price history for instrument "NOPE".' } },
					{ status: 422 }
				)
			);
			const api = createHttpSimilarityApi({ baseUrl: 'https://backend.test', fetchImpl: impl });

			await expect(
				api.search({
					instrumentId: 'NOPE',
					window: { start: '2023-03-01', end: '2023-03-31', timeframe: '1d' },
					scope: 'cross_instrument'
				})
			).rejects.toMatchObject({ reason: 'validation', message: expect.stringContaining('NOPE') });
		});

		it('wraps a transport failure rather than leaking the raw fetch rejection', async () => {
			const impl = (async () => {
				throw new Error('network down');
			}) as unknown as typeof fetch;
			const api = createHttpSimilarityApi({ baseUrl: 'https://backend.test', fetchImpl: impl });

			await expect(
				api.search({
					instrumentId: 'MOCK01',
					window: { start: '2023-03-01', end: '2023-03-31', timeframe: '1d' },
					scope: 'cross_instrument'
				})
			).rejects.toBeInstanceOf(SimilarityApiError);
		});
	});

	describe('explain', () => {
		it('gets the explanation endpoint and parses the response', async () => {
			const { impl, calls } = stubFetch(() =>
				jsonResponse({
					candidate_id: 'run_1_candidate_1',
					overall_score: 0.7,
					weight_applied: { price_shape: 1 },
					per_family_similarity: { price_shape: 0.7 },
					contributions: { price_shape: 0.7 },
					unavailable_families: []
				})
			);
			const api = createHttpSimilarityApi({ baseUrl: 'https://backend.test', fetchImpl: impl });

			const explanation = await api.explain('run_1', 'run_1_candidate_1');

			expect(calls[0]?.url).toBe(
				'https://backend.test/api/similarity/runs/run_1/candidates/run_1_candidate_1/explanation'
			);
			expect(explanation.overallScore).toBe(0.7);
		});

		it('maps a 404 to a not_found_candidate SimilarityApiError', async () => {
			const { impl } = stubFetch(() =>
				jsonResponse({ detail: { message: 'not found' } }, { status: 404 })
			);
			const api = createHttpSimilarityApi({ baseUrl: 'https://backend.test', fetchImpl: impl });

			await expect(api.explain('run_1', 'bogus')).rejects.toMatchObject({
				reason: 'not_found_candidate'
			});
		});
	});
});
