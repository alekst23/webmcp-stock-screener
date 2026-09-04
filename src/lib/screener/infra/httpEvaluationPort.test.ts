// T-0026-4: proves HttpScreenerEvaluationPort maps POST /api/screener/run's
// wire contract onto ScreenerEvaluationPort correctly in both directions --
// request serialization and response mapping -- and that a transport
// failure never escapes as an unhandled rejection (AC5). Mirrors
// backtest/infra/httpBacktestApi.test.ts's stubFetch/jsonResponse pattern.

import { describe, expect, it } from 'vitest';
import type { ScreenerDefinition } from '../definition';
import type { ScreenerRun, ScreenerRunRefusal } from '../run';
import { createHttpScreenerEvaluationPort } from './httpEvaluationPort';

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
		json: async () => payload,
		text: async () => JSON.stringify(payload)
	} as Response;
}

function errorResponse(status: number, statusText: string, detail: string): Response {
	return {
		ok: false,
		status,
		statusText,
		json: async () => ({ detail }),
		text: async () => detail
	} as Response;
}

const DEFINITION: ScreenerDefinition = {
	screenerId: 'scr_1',
	workspaceId: 'ws_1',
	name: 'Momentum breakouts',
	revision: 3,
	universe: {
		assetClass: 'equity',
		exchanges: [],
		countries: [],
		sectors: ['Technology'],
		industries: [],
		indexes: [],
		watchlists: [],
		liquidity: { minPrice: 5, minAverageVolume: 100000, minMarketCap: null },
		exclusions: { instrumentIds: ['inst:XNAS:BAD'], sectorIds: [], industryIds: [] }
	},
	filterTree: {
		nodeId: 'filter_1',
		kind: 'group',
		op: 'and',
		enabled: true,
		children: [
			{
				nodeId: 'cond_1',
				kind: 'condition',
				enabled: true,
				condition: {
					type: 'scalar',
					fieldId: 'field.price.change_pct',
					operator: 'gt',
					value: 5,
					unit: null
				}
			}
		]
	},
	ranking: {
		fields: [{ fieldId: 'field.price.change_pct', direction: 'desc', weight: 1 }],
		tieBreak: null,
		limit: 25,
		normalization: 'percentile_rank'
	}
};

const COMPLETE_BODY = {
	status: 'complete',
	as_of: '2024-01-31',
	universe_count: 10,
	matched_count: 1,
	returned_count: 1,
	truncated: false,
	ranking_applied: true,
	matches: [
		{
			instrument: {
				instrument_id: 'inst:XNAS:AAPL',
				symbol: 'AAPL',
				exchange: 'XNAS',
				asset_type: 'equity'
			},
			rank: 1,
			composite_score: 0.9,
			ranking_values: { 'field.price.change_pct': 0.9 },
			node_evaluations: {
				cond_1: {
					node_id: 'cond_1',
					passed: true,
					value: true,
					unit: null,
					detail: null,
					data_unavailable: false
				}
			}
		}
	],
	problems: [],
	provenance: {
		as_of: '2024-01-31T00:00:00Z',
		source_id: 'src.panel.stored',
		source_label: 'Stored price panel',
		liveness: 'historical',
		timezone: 'UTC',
		currency: 'USD',
		price_adjustment: 'adjusted',
		engine_version: '1.0.0'
	}
};

const REFUSED_BODY = {
	status: 'refused',
	as_of: '2024-01-31',
	universe_count: 0,
	matched_count: 0,
	returned_count: 0,
	truncated: false,
	ranking_applied: false,
	matches: [],
	problems: [
		{
			severity: 'blocking',
			code: 'empty_universe',
			message: 'Universe resolved to zero instruments.',
			node_ids: [],
			universe_criteria: ['sectors']
		}
	]
};

describe('createHttpScreenerEvaluationPort.execute', () => {
	it('posts dry_run:false and maps a complete backend response to a ScreenerRun', async () => {
		const { impl, calls } = stubFetch(() => jsonResponse(COMPLETE_BODY));
		const port = createHttpScreenerEvaluationPort({
			baseUrl: 'http://x',
			fetchImpl: impl,
			now: () => new Date('2024-02-01T00:00:00Z')
		});

		const outcome = await port.execute({ definition: DEFINITION, runId: 'run_1' });

		expect(calls[0]?.method).toBe('POST');
		expect(calls[0]?.url).toBe('http://x/api/screener/run');
		expect(calls[0]?.body?.dry_run).toBe(false);
		expect(calls[0]?.body?.universe).toMatchObject({
			universe_id: 'scr_1',
			label: 'Momentum breakouts',
			sectors: ['Technology'],
			min_price: 5,
			excluded_tickers: ['inst:XNAS:BAD']
		});

		expect(outcome.status).toBe('complete');
		const run = outcome as ScreenerRun;
		expect(run.runId).toBe('run_1');
		expect(run.screenerId).toBe('scr_1');
		expect(run.screenerRevision).toBe(3);
		expect(run.universeCount).toBe(10);
		expect(run.matchedCount).toBe(1);
		expect(run.returnedCount).toBe(1);
		expect(run.rankingApplied).toBe(true);
		expect(run.normalization).toBe('percentile_rank');
		expect(run.createdAt).toBe('2024-02-01T00:00:00.000Z');
		expect(run.matches).toEqual([
			{
				instrumentId: 'inst:XNAS:AAPL',
				rank: 1,
				compositeScore: 0.9,
				rankingValues: { 'field.price.change_pct': 0.9 },
				nodeEvaluations: {
					cond_1: {
						nodeId: 'cond_1',
						passed: true,
						value: true,
						unit: undefined,
						detail: undefined,
						dataUnavailable: false
					}
				}
			}
		]);
		expect(run.provenance.sourceId).toBe('src.panel.stored');
		expect(run.rejectedEvaluations).toEqual({});
	});

	it('maps a refused backend response to a ScreenerRunRefusal, minting no run', async () => {
		const { impl } = stubFetch(() => jsonResponse(REFUSED_BODY));
		const port = createHttpScreenerEvaluationPort({ baseUrl: 'http://x', fetchImpl: impl });

		const outcome = await port.execute({ definition: DEFINITION, runId: 'run_1' });

		expect(outcome).toEqual({
			status: 'refused',
			screenerId: 'scr_1',
			screenerRevision: 3,
			problems: [
				{
					severity: 'blocking',
					code: 'empty_universe',
					nodeIds: [],
					universeCriteria: ['sectors'],
					message: 'Universe resolved to zero instruments.'
				}
			]
		});
	});

	it('surfaces a network failure as a readable refusal, not an unhandled rejection', async () => {
		const impl = (async () => {
			throw new Error('fetch failed: ECONNREFUSED');
		}) as unknown as typeof fetch;
		const port = createHttpScreenerEvaluationPort({ baseUrl: 'http://x', fetchImpl: impl });

		const outcome = await port.execute({ definition: DEFINITION, runId: 'run_1' });

		expect(outcome.status).toBe('refused');
		const refusal = outcome as ScreenerRunRefusal;
		expect(refusal.problems).toHaveLength(1);
		expect(refusal.problems[0]?.code).toBe('network_error');
		expect(refusal.problems[0]?.message).toContain('ECONNREFUSED');
	});

	it('surfaces a non-2xx response as a readable refusal', async () => {
		const { impl } = stubFetch(() => errorResponse(503, 'Service Unavailable', 'no panel loaded'));
		const port = createHttpScreenerEvaluationPort({ baseUrl: 'http://x', fetchImpl: impl });

		const outcome = await port.execute({ definition: DEFINITION, runId: 'run_1' });

		expect(outcome.status).toBe('refused');
		const refusal = outcome as ScreenerRunRefusal;
		expect(refusal.problems[0]?.message).toContain('503');
	});

	it('surfaces a complete response with no provenance as a refusal rather than throwing', async () => {
		const { impl } = stubFetch(() =>
			jsonResponse({ ...COMPLETE_BODY, provenance: null })
		);
		const port = createHttpScreenerEvaluationPort({ baseUrl: 'http://x', fetchImpl: impl });

		const outcome = await port.execute({ definition: DEFINITION, runId: 'run_1' });

		expect(outcome.status).toBe('refused');
		const refusal = outcome as ScreenerRunRefusal;
		expect(refusal.problems[0]?.code).toBe('network_error');
	});
});

describe('createHttpScreenerEvaluationPort.validate', () => {
	it('posts dry_run:true and surfaces every reported problem, not just the first', async () => {
		const multiProblemBody = {
			...REFUSED_BODY,
			problems: [
				REFUSED_BODY.problems[0],
				{
					severity: 'advisory',
					code: 'unrecognized_value',
					message: 'Sector "Foo" is not recognized.',
					node_ids: [],
					universe_criteria: ['sectors']
				}
			]
		};
		const { impl, calls } = stubFetch(() => jsonResponse(multiProblemBody));
		const port = createHttpScreenerEvaluationPort({ baseUrl: 'http://x', fetchImpl: impl });

		const report = await port.validate(DEFINITION);

		expect(calls[0]?.body?.dry_run).toBe(true);
		expect(report.valid).toBe(false);
		expect(report.problems.map((p) => p.code)).toEqual(['empty_universe', 'unrecognized_value']);
		expect(report.detectionExhaustive).toBe(false);
	});

	it('maps a valid dry_run response with no problems', async () => {
		const validBody = { ...REFUSED_BODY, status: 'valid', problems: [] };
		const { impl } = stubFetch(() => jsonResponse(validBody));
		const port = createHttpScreenerEvaluationPort({ baseUrl: 'http://x', fetchImpl: impl });

		const report = await port.validate(DEFINITION);

		expect(report.valid).toBe(true);
		expect(report.problems).toEqual([]);
	});

	it('surfaces a network failure as an invalid report, not an unhandled rejection', async () => {
		const impl = (async () => {
			throw new Error('network down');
		}) as unknown as typeof fetch;
		const port = createHttpScreenerEvaluationPort({ baseUrl: 'http://x', fetchImpl: impl });

		const report = await port.validate(DEFINITION);

		expect(report.valid).toBe(false);
		expect(report.problems[0]?.code).toBe('network_error');
		expect(report.problems[0]?.message).toContain('network down');
	});
});
