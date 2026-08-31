import { get, writable } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { connectWebmcp } from '../webmcp/register';
import { ok, fail } from '../webmcp/tools';
import { recordAction, type AgentActivityEvent } from './activity';
import {
	alignInstanceWindows,
	axisTickIndices,
	axisTicks,
	computeChartGeometry,
	nearestBarIndex
} from './visualization';
import { createApiEngine, type BackendPriceBar, type InstanceWindowView } from './apiEngine';
import { createWorkspaceStore, selectInstance } from './store';
import type { ModelContext, ModelContextToolDescriptor } from '../webmcp/types';
import { memoryStorage } from './testSupport';

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

describe('chart geometry and hover interaction', () => {
	it('scales bars into the chart viewport and finds the nearest bar under a pointer', () => {
		const bars = [bar('X', '2024-01-01', 10), bar('X', '2024-01-02', 20), bar('X', '2024-01-03', 15)];

		const geometry = computeChartGeometry(bars, 100, 50);

		expect(geometry.min).toBe(10);
		expect(geometry.max).toBe(20);
		expect(geometry.x(0), 'first bar sits at the left edge').toBe(0);
		expect(geometry.x(2), 'last bar sits at the right edge').toBe(100);
		expect(geometry.y(20), 'the max close sits at the top (y=0)').toBe(0);
		expect(geometry.y(10), 'the min close sits at the bottom (y=height)').toBe(50);

		expect(nearestBarIndex(0, bars.length, 100)).toBe(0);
		expect(nearestBarIndex(100, bars.length, 100)).toBe(2);
		expect(
			nearestBarIndex(51, bars.length, 100),
			'a pointer just past the midpoint snaps to the middle bar'
		).toBe(1);
		expect(
			nearestBarIndex(-10, bars.length, 100),
			'a pointer outside the chart clamps to the nearest edge bar'
		).toBe(0);
	});

	it('handles an empty bar list without throwing', () => {
		const geometry = computeChartGeometry([], 100, 50);
		expect(geometry.linePath).toBe('');
		expect(geometry.areaPath).toBe('');
		expect(nearestBarIndex(50, 0, 100)).toBe(0);
	});

	it('spaces axis ticks evenly across the value and bar-index range', () => {
		expect(axisTicks(0, 10, 3)).toEqual([0, 5, 10]);
		expect(axisTicks(5, 5, 3), 'a flat range collapses to one tick').toEqual([5]);

		expect(axisTickIndices(9, 3), 'first, middle, last bar').toEqual([0, 4, 8]);
		expect(axisTickIndices(1, 3), 'a single bar has only one index to show').toEqual([0]);
		expect(axisTickIndices(0, 3), 'no bars means no ticks').toEqual([]);
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
	it('labels an agent tool call event with actor "agent"', async () => {
		const store = createWorkspaceStore(memoryStorage());
		const engine = createApiEngine(store, { baseUrl: 'http://localhost:8000' });
		const activity = writable<AgentActivityEvent[]>([]);
		const registeredTools = new Map<string, ModelContextToolDescriptor>();
		document.modelContext = {
			registerTool: async (tool) => {
				registeredTools.set(tool.name, tool);
			},
			unregisterTool: async (name) => {
				registeredTools.delete(name);
			}
		};

		await connectWebmcp(engine, activity);
		await registeredTools.get('defineStudy')!.execute({
			name: 'rel_vol_5',
			expression: 'volume / sma(volume, 5)'
		});

		const events = get(activity);
		expect(events, `events: ${JSON.stringify(events)}`).toHaveLength(1);
		expect(events[0]!.actor).toBe('agent');
	});

	it('appends an entry when a human triggers a chart-toolbar action, labeled actor "human"', () => {
		const activity = writable<AgentActivityEvent[]>([]);

		recordAction(activity, 'human', 'clearPanels', undefined, ok({ panels: [] }));

		const events = get(activity);
		expect(events, `events: ${JSON.stringify(events)}`).toHaveLength(1);
		expect(events[0]!.actor).toBe('human');
		expect(events[0]!.toolName).toBe('clearPanels');
		expect(events[0]!.summary, 'summary must be human-readable, not raw JSON').not.toMatch(/[{}]/);
	});

	it('records human and agent actions in true chronological order in the same log', async () => {
		const store = createWorkspaceStore(memoryStorage());
		const engine = createApiEngine(store, { baseUrl: 'http://localhost:8000' });
		const activity = writable<AgentActivityEvent[]>([]);
		const registeredTools = new Map<string, ModelContextToolDescriptor>();
		document.modelContext = {
			registerTool: async (tool) => {
				registeredTools.set(tool.name, tool);
			},
			unregisterTool: async (name) => {
				registeredTools.delete(name);
			}
		};

		await connectWebmcp(engine, activity);
		recordAction(activity, 'human', 'clearPanels', undefined, ok({ panels: [] }));
		await registeredTools.get('defineStudy')!.execute({
			name: 'rel_vol_5',
			expression: 'volume / sma(volume, 5)'
		});
		recordAction(activity, 'human', 'showTickerCharts', undefined, ok({}));

		const events = get(activity);
		expect(
			events.map((e) => `${e.actor}:${e.toolName}`),
			`events: ${JSON.stringify(events)}`
		).toEqual(['human:clearPanels', 'agent:defineStudy', 'human:showTickerCharts']);
	});

	it('shows a readable failure reason when an agent tool call fails', async () => {
		const store = createWorkspaceStore(memoryStorage());
		const engine = createApiEngine(store, { baseUrl: 'http://localhost:8000' });
		const activity = writable<AgentActivityEvent[]>([]);
		const registeredTools = new Map<string, ModelContextToolDescriptor>();
		document.modelContext = {
			registerTool: async (tool) => {
				registeredTools.set(tool.name, tool);
			},
			unregisterTool: async (name) => {
				registeredTools.delete(name);
			}
		};

		await connectWebmcp(engine, activity);
		await registeredTools.get('defineStudy')!.execute({
			name: 'bad',
			expression: 'not_a_real_function(close)'
		});

		const events = get(activity);
		expect(events, `events: ${JSON.stringify(events)}`).toHaveLength(1);
		expect(events[0]!.actor).toBe('agent');
		expect(events[0]!.summary, `summary: ${events[0]!.summary}`).toMatch(/failed/i);
	});

	it('shows a readable failure reason when a human chart-toolbar action fails', () => {
		const activity = writable<AgentActivityEvent[]>([]);

		recordAction(activity, 'human', 'showTickerCharts', undefined, fail('backend unreachable'));

		const events = get(activity);
		expect(events, `events: ${JSON.stringify(events)}`).toHaveLength(1);
		expect(events[0]!.actor).toBe('human');
		expect(events[0]!.summary, `summary: ${events[0]!.summary}`).toMatch(/backend unreachable/);
	});
});
