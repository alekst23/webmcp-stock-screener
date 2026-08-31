import { get, writable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiEngine } from '../workspace/apiEngine';
import { buildTools } from './tools';
import { FUNCTION_CATALOG, type WorkspaceState } from './types';

// These tests target the real fetch-based ResearchEngine implementation
// (createApiEngine, built in this ticket) wired through the actual
// buildTools()/tool-call surface -- not the placeholder fake in
// tools.test.ts. They re-verify tools.test.ts's availability/error-handling
// guarantees still hold against the real thing (AC2/AC5), and add the
// end-to-end session scenario that only becomes possible once the real
// engine exists (AC4). fetch() is stubbed rather than requiring a live
// FastAPI process (backend/tests/functional/test_research_routes.py already
// covers the backend side); what's under test here is the fetch-based
// engine's own logic -- URL construction, request/response mapping, and
// error mapping (backend/api/routes/research.py's 422 catalog shape ->
// ExpressionError).

function emptyWorkspace(): WorkspaceState {
	return { studies: [], setups: [], instanceSets: [], panels: [], focus: null };
}

function setupEngine() {
	const store = writable(emptyWorkspace());
	const engine = createApiEngine(store, { baseUrl: 'http://localhost:8000' });
	return { store, engine };
}

function jsonResponse(payload: unknown): { ok: boolean; json: () => Promise<unknown> } {
	return { ok: true, json: async () => payload };
}

// A minimal but coherent fake of backend/api/routes/research.py: routes each
// path to a plausible response shaped like the real Pydantic models
// (snake_case), echoing back enough of the request body (e.g. setup_id,
// horizon_days) that the engine's response-mapping logic has real data to
// map rather than fixed constants.
function stubResearchBackend(): void {
	let nextSetId = 1;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const path = new URL(url).pathname;
			const body = init?.body ? JSON.parse(init.body as string) : {};
			if (path === '/api/research/find-instances') {
				return jsonResponse({
					id: `set_${nextSetId++}`,
					setup_id: body.setup.id,
					instances: [
						{ ticker: 'MOCK01', date: '2024-03-08', completeness: 1 },
						{ ticker: 'MOCK02', date: '2024-04-01', completeness: 1 }
					],
					complete_count: 2,
					partial_count: 0,
					from_date: '2023-01-03',
					to_date: '2025-12-31'
				});
			}
			if (path === '/api/research/sample-instances') {
				const n = body.n ?? 12;
				return jsonResponse(body.instance_set.instances.slice(0, n));
			}
			if (path === '/api/research/measure') {
				return jsonResponse({
					metric: body.metric ?? 'forward_return',
					horizon_days: body.horizon_days,
					count: body.instance_set.complete_count,
					median: 0.021,
					mean: 0.019,
					hit_rate: 0.6,
					base_rate: { median: 0.001, hit_rate: 0.5 }
				});
			}
			if (path === '/api/research/instance-windows') {
				return jsonResponse(
					body.instance_set.instances.map((inst: { ticker: string }) => ({
						ticker: inst.ticker,
						bars: []
					}))
				);
			}
			throw new Error(`stubResearchBackend: unexpected request to ${url}`);
		})
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('real engine tool availability', () => {
	it('unlocks analysis tools once a real findInstances call produces a result set', async () => {
		stubResearchBackend();
		const { store, engine } = setupEngine();
		const tools = buildTools(engine);
		const availableNames = () => tools.filter((t) => t.available(get(store))).map((t) => t.name);

		expect(availableNames()).toEqual([
			'defineStudy',
			'defineSetup',
			'findInstances',
			'showTickerCharts',
			'clearPanels',
			'getWorkspace'
		]);

		const setup = await engine.defineSetup({
			steps: [{ condition: 'open >= highest(close, 1) * 1.05' }]
		});
		await engine.findInstances({ setupId: setup.id });

		const unlocked = availableNames();
		expect(unlocked).toContain('measure');
		expect(unlocked).toContain('sampleInstances');
		expect(unlocked).toContain('splitInstances');
		expect(unlocked).toContain('showGrid');
		expect(unlocked, 'focusInstance needs a panel, not just an instance set').not.toContain(
			'focusInstance'
		);
	});
});

describe('real engine expression validation', () => {
	it('returns the shared function catalog when defineStudy rejects an unsupported expression', async () => {
		// No fetch stub: defineStudy validates synchronously with no network
		// call (this ticket's resolved design) -- an unstubbed fetch() call
		// here would itself fail the test.
		const { engine } = setupEngine();
		const defineStudy = buildTools(engine).find((t) => t.name === 'defineStudy');
		expect(defineStudy, 'defineStudy tool should be registered').toBeDefined();

		const result = await defineStudy!.execute({ name: 'bad', expression: 'zscore(close, 20)' });

		expect(result.isError, `expected an error result, got ${JSON.stringify(result)}`).toBe(true);
		const payload = JSON.parse(result.content[0]!.text) as { availableFunctions: string[] };
		expect(payload.availableFunctions).toEqual(FUNCTION_CATALOG);
	});
});

describe('end-to-end research session', () => {
	it('completes define study, define setup, find instances, sample, measure, and grid entirely via tool calls', async () => {
		stubResearchBackend();
		const { store, engine } = setupEngine();
		const tools = buildTools(engine);

		async function call(name: string, input: unknown): Promise<Record<string, unknown>> {
			const tool = tools.find((t) => t.name === name);
			expect(tool, `${name} tool should be registered`).toBeDefined();
			const result = await tool!.execute(input);
			expect(result.isError, `${name} failed: ${JSON.stringify(result)}`).toBeUndefined();
			return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
		}

		const study = await call('defineStudy', {
			name: 'rel_vol_5',
			expression: 'volume / sma(volume, 5)'
		});
		const setup = await call('defineSetup', { steps: [{ condition: 'rel_vol_5 > 1.5' }] });
		const instanceSet = await call('findInstances', { setupId: setup.id });
		const sample = await call('sampleInstances', { instanceSetId: instanceSet.id, n: 2 });
		const measurement = await call('measure', {
			instanceSetId: instanceSet.id,
			horizonDays: 10
		});
		const panel = await call('showGrid', { instanceSetId: instanceSet.id });
		const tickerPanel = await call('showTickerCharts', {
			tickers: ['MOCK02', 'MOCK03'],
			date: '2025-12-31',
			window: [-20, 0],
			title: 'Monthly charts'
		});

		expect(study.id).toMatch(/^study_/);
		expect(setup.id).toMatch(/^setup_/);
		expect(instanceSet.count).toBeGreaterThan(0);
		expect(Array.isArray(sample)).toBe(true);
		expect(measurement.horizonDays).toBe(10);
		expect(panel.kind).toBe('grid');
		expect(tickerPanel.window).toEqual([-20, 0]);

		// Every step's handle is visible in the same shared workspace state the
		// human UI reads, not just in the tool result the agent saw.
		const ws = get(store);
		expect(ws.studies.map((s) => s.id)).toContain(study.id);
		expect(ws.setups.map((s) => s.id)).toContain(setup.id);
		expect(ws.instanceSets.map((s) => s.id)).toContain(instanceSet.id);
		expect(ws.panels.map((p) => p.id)).toContain(panel.id);
		expect(ws.panels.map((p) => p.id)).toContain(tickerPanel.id);
	});
});
