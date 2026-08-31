import { get, writable } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { connectWebmcp } from '../webmcp/register';
import type { AgentActivityEvent } from './activity';
import { alignInstanceWindows, buildHistogram, computeForwardReturns } from './visualization';
import { createApiEngine, type BackendPriceBar, type InstanceWindowView } from './apiEngine';
import { createWorkspaceStore, selectInstance } from './store';
import type { ModelContext, ModelContextToolDescriptor } from '../webmcp/types';

// In-memory Storage so each test gets an isolated backing store instead of
// depending on (and leaking state through) jsdom's shared global localStorage
// -- same fixture store.test.ts uses, for the same reason.
function memoryStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key) => (data.has(key) ? (data.get(key) ?? null) : null),
		setItem: (key, value) => void data.set(key, String(value)),
		removeItem: (key) => void data.delete(key),
		clear: () => data.clear(),
		key: (index) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	};
}

function bar(ticker: string, date: string, close: number): BackendPriceBar {
	return { ticker, date, open: close, high: close, low: close, close, volume: 1000 };
}

describe('small-multiples grid', () => {
	it("renders one aligned chart per instance, indexed to each instance's own anchor date", () => {
		const views: InstanceWindowView[] = [
			{
				ticker: 'A',
				date: '2024-01-10',
				completeness: 1,
				bars: [
					bar('A', '2024-01-08', 10),
					bar('A', '2024-01-09', 11),
					bar('A', '2024-01-10', 12),
					bar('A', '2024-01-11', 13)
				]
			},
			{
				ticker: 'B',
				date: '2024-02-05',
				completeness: 1,
				// A shorter window (edge-clipped near the panel start) -- the
				// anchor is still found by date, not by a fixed offset.
				bars: [bar('B', '2024-02-04', 20), bar('B', '2024-02-05', 21), bar('B', '2024-02-06', 22)]
			}
		];

		const aligned = alignInstanceWindows(views);

		expect(aligned, `aligned: ${JSON.stringify(aligned)}`).toHaveLength(2);
		expect(aligned[0]!.anchorIndex, "instance A's own t=0 is at index 2").toBe(2);
		expect(aligned[1]!.anchorIndex, "instance B's own t=0 is at index 1, not A's index 2").toBe(1);
		expect(aligned[0]!.ticker).toBe('A');
		expect(aligned[1]!.ticker).toBe('B');
	});

	it('shows price action so far, without an outcome, for partial instances in the grid', () => {
		const view: InstanceWindowView = {
			ticker: 'C',
			date: '2024-03-01',
			completeness: 0.5,
			// No bars past the anchor -- the setup hasn't resolved yet, so
			// there's no outcome window to show, only price action so far.
			bars: [bar('C', '2024-02-27', 30), bar('C', '2024-02-28', 31), bar('C', '2024-03-01', 32)]
		};

		const [aligned] = alignInstanceWindows([view]);

		expect(aligned!.isPartial, 'completeness < 1 must mark the window partial').toBe(true);
		expect(
			aligned!.bars,
			'only the available bars are shown, nothing invented past them'
		).toHaveLength(3);
		expect(aligned!.anchorIndex).toBe(2);
	});
});

describe('instance focus', () => {
	it('opens a larger detail chart when a grid instance is selected, independent of any agent-driven focus', async () => {
		const store = createWorkspaceStore(memoryStorage());
		const engine = createApiEngine(store, { baseUrl: 'http://localhost:8000' });

		await engine.focusInstance({ ticker: 'AGENT_PICK', date: '2024-01-01', panelId: 'panel_1' });
		selectInstance(store, 'panel_1', { ticker: 'HUMAN_PICK', date: '2024-02-02', completeness: 1 });

		const ws = get(store);
		expect(ws.focus?.selected, `selected: ${JSON.stringify(ws.focus)}`).toEqual([
			{ ticker: 'HUMAN_PICK', date: '2024-02-02', completeness: 1 }
		]);
		expect(
			ws.focus?.focusedInstance,
			'the agent-driven focus must survive a human selection untouched'
		).toEqual({ ticker: 'AGENT_PICK', date: '2024-01-01' });
	});
});

describe('outcome histogram', () => {
	it('renders the distribution of a measured metric across a result set', () => {
		const dates = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];
		function view(ticker: string, closes: number[]): InstanceWindowView {
			return {
				ticker,
				date: dates[2]!,
				completeness: 1,
				bars: dates.map((d, i) => bar(ticker, d, closes[i]!))
			};
		}
		const views = [
			view('A', [100, 100, 100, 100, 110]), // +10% over 2 bars from anchor
			view('B', [100, 100, 100, 100, 105]), // +5%
			view('C', [100, 100, 100, 100, 90]) // -10%
		];

		const returns = computeForwardReturns(views, 2);
		expect(returns, `returns: ${JSON.stringify(returns)}`).toHaveLength(3);
		expect(returns).toContain(0.1);
		expect(returns).toContain(0.05);
		expect(returns).toContainEqual(expect.closeTo(-0.1, 5));

		const histogram = buildHistogram(returns, 4);
		const totalCount = histogram.reduce((sum, b) => sum + b.count, 0);
		expect(
			totalCount,
			`every computed return must fall into exactly one bucket: ${JSON.stringify(histogram)}`
		).toBe(3);
	});
});

describe('agent activity feed', () => {
	afterEach(() => {
		document.modelContext = undefined;
	});

	it('appends one entry per tool call, in call order, as the agent acts', async () => {
		const store = createWorkspaceStore(memoryStorage());
		const engine = createApiEngine(store, { baseUrl: 'http://localhost:8000' });
		const activity = writable<AgentActivityEvent[]>([]);
		const registeredTools = new Map<string, ModelContextToolDescriptor>();
		const mc: ModelContext = {
			registerTool: async (tool) => {
				registeredTools.set(tool.name, tool);
			},
			unregisterTool: async (name) => {
				registeredTools.delete(name);
			}
		};
		document.modelContext = mc;

		await connectWebmcp(engine, activity);
		await registeredTools.get('defineStudy')!.execute({
			name: 'rel_vol_5',
			expression: 'volume / sma(volume, 5)'
		});
		await registeredTools.get('defineSetup')!.execute({ steps: [{ condition: 'rel_vol_5 > 1' }] });

		const events = get(activity);
		expect(
			events.map((e) => e.toolName),
			`events: ${JSON.stringify(events)}`
		).toEqual(['defineStudy', 'defineSetup']);
		expect(events[0]!.summary, 'summary must be human-readable, not raw JSON').not.toMatch(/[{}]/);
		expect(
			new Date(events[0]!.timestamp).toString(),
			`timestamp: ${events[0]!.timestamp}`
		).not.toBe('Invalid Date');
		expect(events[0]!.input).toEqual({ name: 'rel_vol_5', expression: 'volume / sma(volume, 5)' });
	});
});

describe('cross-actor visibility', () => {
	it('reflects a human UI selection in what getWorkspace returns to the agent', async () => {
		const store = createWorkspaceStore(memoryStorage());
		const engine = createApiEngine(store, { baseUrl: 'http://localhost:8000' });

		selectInstance(store, 'panel_1', { ticker: 'ACME', date: '2024-03-08', completeness: 1 });

		const ws = await engine.getWorkspace();
		expect(ws.focus?.selected, `getWorkspace() focus: ${JSON.stringify(ws.focus)}`).toEqual([
			{ ticker: 'ACME', date: '2024-03-08', completeness: 1 }
		]);
		expect(ws.focus?.panelId).toBe('panel_1');
	});
});

// T-1002-1: unify action recording so a human UI control (starting with
// ChartToolbar) and an agent tool call append to the same log through one
// shared entry point, distinguished only by a static `actor` field.
describe('unified action log', () => {
	it('labels an agent tool call event with actor "agent"', () => {
		throw new Error('not implemented');
	});

	it('appends an entry when a human triggers a chart-toolbar action, labeled actor "human"', () => {
		throw new Error('not implemented');
	});

	it('records human and agent actions in true chronological order in the same log', () => {
		throw new Error('not implemented');
	});

	it('shows a readable failure reason when an agent tool call fails', () => {
		throw new Error('not implemented');
	});

	it('shows a readable failure reason when a human chart-toolbar action fails', () => {
		throw new Error('not implemented');
	});
});
