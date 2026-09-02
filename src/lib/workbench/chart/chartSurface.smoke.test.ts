// The whole epic, end to end, in one run.
//
// This is the ticket's smoke. A live browser run is not achievable here: the
// chart surface is behind CHART_TOOLS_ENABLED and is deliberately not wired
// into any route, because panel creation and layout belong to the panel
// registry another epic owns and that registry is not on main -- there is no
// route on which a chart panel can be brought into existence to look at.
// Flipping the flag to make one would put an unfinished surface into the
// shipping runtime path. Manual browser verification is therefore deferred to
// the ticket that first mounts a chart panel in a route.
//
// What runs instead is the same script against the real machinery: a real
// workspace repository, the real revision service, the real operation
// registry, the real study catalog and calculation engine, and a
// ChartSeriesPort backed by fixed bars. It binds a chart to an instrument and
// timeframe, adds a moving average and an RSI, reads a bounded window back
// through get_chart_data, draws a trendline and a highlighted setup window,
// captures the setup, retrieves it by its returned ID, and renders the panel
// into jsdom to assert what a human would see. A second pass redeems every
// mutation's undo token and asserts the prior state comes back.
import { beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ToolSpec } from '../../webmcp/types';
import { createIdSequencer } from '../domain/ids';
import type { Clock } from '../domain/ports';
import { emptyWorkspace } from '../domain/workspace';
import type { WorkspaceDocument } from '../domain/workspace';
import { createChangeHistory, undoChange } from '../application/changeHistory';
import { createIdempotencyCache } from '../application/idempotency';
import { applyOperations, createOperationRegistry } from '../application/operationRegistry';
import { createRevisionService } from '../application/revisionService';
import { createLocalWorkspaceRepository } from '../infra/workspaceRepository';
import { memoryStorage } from '../testSupport';
import { readChartData } from './application/chartData';
import type { ChartDataResult } from './application/chartData';
import { readCapturedSetup, readCapturedSetups } from './domain/capturedSetup';
import { createChartState, readChartState, writeChartState } from './domain/chartState';
import type { InstrumentRef } from './domain/instrument';
import type { OhlcvBar } from './domain/seriesPort';
import { createInMemoryChartSeries } from './infra/inMemoryChartSeries';
import type { InMemoryChartSeriesFixture } from './infra/inMemoryChartSeries';
import ChartPanel from './components/ChartPanel.svelte';
import { buildChartTools, type ChartToolsDeps } from './tools/index';

const NOW = '2026-09-02T20:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const PANEL_ID = 'panel_chart_1';
const RANGE = { kind: 'explicit', start: '2026-01-01', end: '2026-06-01' } as const;

const clock: Clock = { now: () => NOW };

const NVDA: InstrumentRef = {
	instrumentId: 'inst:XNAS:NVDA',
	symbol: 'NVDA',
	exchange: 'XNAS',
	assetType: 'equity'
};

// A gentle zig-zag rather than a straight ramp: an RSI on a monotonic series
// pins at 100 and proves nothing about the engine having been reached.
function dailyBars(count: number): OhlcvBar[] {
	return Array.from({ length: count }, (_, index) => {
		const at = new Date(Date.UTC(2026, 0, 2));
		at.setUTCDate(at.getUTCDate() + index);
		const close = 100 + index * 0.5 + (index % 5) * 2;
		return {
			time: at.toISOString().slice(0, 10),
			open: close - 0.5,
			high: close + 1.5,
			low: close - 1.5,
			close,
			volume: 1_000_000 + index * 1_000
		};
	});
}

const BARS = dailyBars(60);
const FIRST_BAR = BARS[0]!;
const MID_BAR = BARS[29]!;
const LAST_BAR = BARS[59]!;

interface Envelope {
	change_id: string;
	new_revision: number;
	affected_ids: string[];
	undo_token: string | null;
	warnings: string[];
}

interface ChartDataPayload {
	instrument: { symbol: string };
	bar_count: number;
	bars: { time: string }[];
	studies: { study_id: string; catalog_item_id: string; pane: string }[];
	price_adjustment: { chart_policy: string; applied: string | null };
	provenance: { as_of: string; liveness: string };
}

interface CapturePayload extends Envelope {
	setup_id: string;
	setup: Record<string, unknown>;
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

const BIND_INPUT = {
	panel_id: PANEL_ID,
	instrument: NVDA,
	timeframe: '1d',
	range: RANGE
};

const VIEW_INPUT = {
	panel_id: PANEL_ID,
	candle_type: 'hollow_candle',
	scale: 'logarithmic'
};

const STUDIES_INPUT = {
	panel_id: PANEL_ID,
	operations: [
		{ op: 'add', catalog_item_id: 'study.sma', params: { length: 20 } },
		{ op: 'add', catalog_item_id: 'study.rsi', params: { length: 14 } }
	]
};

const TRENDLINE_INPUT = {
	panel_id: PANEL_ID,
	kind: 'trendline',
	label: 'rising support',
	anchors: {
		kind: 'trendline',
		from: { time: FIRST_BAR.time, price: FIRST_BAR.low },
		to: { time: LAST_BAR.time, price: LAST_BAR.low }
	}
};

const SETUP_WINDOW_INPUT = {
	panel_id: PANEL_ID,
	kind: 'setup_window',
	label: 'the base',
	anchors: { kind: 'setup_window', start: MID_BAR.time, end: LAST_BAR.time }
};

const CAPTURE_INPUT = {
	panel_id: PANEL_ID,
	name: 'NVDA base breakout',
	notes: 'Volume dry-up into the rim.'
};

describe('the chart surface, end to end', () => {
	let deps: ChartToolsDeps;
	let tools: Map<string, ToolSpec>;

	function currentDoc(): WorkspaceDocument {
		const doc = deps.repository.get(WORKSPACE_ID);
		if (!doc) {
			throw new Error('the workspace vanished mid-run');
		}
		return doc;
	}

	// Everything this epic can change about a workspace, in one comparable
	// value: the chart itself and the captured setups it wrote.
	function snapshot(): string {
		const doc = currentDoc();
		return JSON.stringify({
			chart: readChartState(doc, PANEL_ID),
			setups: readCapturedSetups(doc)
		});
	}

	function tool(name: string): ToolSpec {
		const found = tools.get(name);
		if (!found) {
			throw new Error(`${name} is not on the chart surface`);
		}
		return found;
	}

	async function call(name: string, input: Record<string, unknown>): Promise<Envelope> {
		const result = await tool(name).execute(input);
		expect(result.isError, `${name} failed: ${JSON.stringify(jsonOf(result))}`).toBeUndefined();
		return jsonOf(result) as Envelope;
	}

	function operate(kind: string, input: unknown): Envelope {
		const envelope = applyOperations(
			[{ kind, input }],
			{ actor: 'agent' },
			{
				registry: deps.registry,
				workspaceId: WORKSPACE_ID,
				history: deps.history,
				revisionService: deps.revisions,
				clock: deps.clock,
				ids: deps.ids
			}
		);
		return {
			change_id: envelope.changeId,
			new_revision: envelope.newRevision,
			affected_ids: [...envelope.affectedIds],
			undo_token: envelope.undoToken,
			warnings: [...envelope.warnings]
		};
	}

	// The six mutations the smoke performs, in order, each reduced to one
	// callable so the forward run and the undo run drive exactly the same
	// script rather than two lists that can drift apart.
	function smokeSteps(): { name: string; apply: () => Promise<Envelope> }[] {
		return [
			{
				name: 'bind the chart to NVDA daily',
				apply: async () => operate('chart.bind_source', BIND_INPUT)
			},
			{
				name: 'configure the view',
				apply: async () => operate('chart.configure_view', VIEW_INPUT)
			},
			{
				name: 'add a moving average and an RSI',
				apply: async () => operate('chart.edit_studies', STUDIES_INPUT)
			},
			{ name: 'draw a trendline', apply: () => call('add_chart_annotation', TRENDLINE_INPUT) },
			{
				name: 'highlight a setup window',
				apply: () => call('add_chart_annotation', SETUP_WINDOW_INPUT)
			},
			{ name: 'capture the setup', apply: () => call('capture_chart_setup', CAPTURE_INPUT) }
		];
	}

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const ids = createIdSequencer();
		const fixture = {
			instrumentId: NVDA.instrumentId,
			timeframe: '1d',
			bars: BARS,
			sourceAdjustment: 'adjusted',
			currency: 'USD',
			timezone: 'America/New_York',
			liveness: 'delayed',
			delaySeconds: 900
		} as InMemoryChartSeriesFixture;
		deps = {
			repository,
			revisions: createRevisionService({
				repository,
				clock,
				ids,
				idempotency: createIdempotencyCache()
			}),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			clock,
			ids,
			series: createInMemoryChartSeries({ clock, series: [fixture] })
		};
		const base: WorkspaceDocument = {
			...emptyWorkspace(WORKSPACE_ID, 'Research', NOW),
			panels: [
				{
					id: PANEL_ID,
					kind: 'chart',
					title: 'Chart',
					collapsed: false,
					visible: true,
					boundResourceId: null,
					config: {}
				}
			]
		};
		repository.put(writeChartState(base, createChartState(PANEL_ID)));
		repository.setActiveId(WORKSPACE_ID);
		tools = new Map(buildChartTools(deps).map((spec) => [spec.name, spec]));
	});

	it('registers the three chart tools the surface exposes', () => {
		expect([...tools.keys()]).toEqual([
			'get_chart_data',
			'add_chart_annotation',
			'capture_chart_setup'
		]);
	});

	it('configures a chart, reads it back, draws on it and captures it', async () => {
		expect(readChartState(currentDoc(), PANEL_ID).config.instrument).toBeNull();

		operate('chart.bind_source', BIND_INPUT);
		expect(readChartState(currentDoc(), PANEL_ID).config.instrument).toEqual(NVDA);

		operate('chart.configure_view', VIEW_INPUT);
		expect(readChartState(currentDoc(), PANEL_ID).config.candleType).toBe('hollow_candle');
		expect(readChartState(currentDoc(), PANEL_ID).config.scale).toBe('logarithmic');

		const studies = operate('chart.edit_studies', STUDIES_INPUT);
		expect(studies.affected_ids).toEqual(['study_1', 'study_2']);
		const stored = readChartState(currentDoc(), PANEL_ID).studies;
		expect(stored.map((study) => study.catalogItemId)).toEqual(['study.sma', 'study.rsi']);
		// Placement is derived, never chosen: an SMA is a price and overlays it,
		// an RSI is not and gets its own pane.
		expect(stored.map((study) => study.pane)).toEqual(['price_overlay', 'sub_pane']);

		const read = jsonOf(
			await tool('get_chart_data').execute({ panel_id: PANEL_ID, window: { last_n_bars: 30 } })
		) as ChartDataPayload;
		expect(read.instrument.symbol).toBe('NVDA');
		expect(read.bar_count).toBe(30);
		expect(read.bars[29]?.time).toBe(LAST_BAR.time);
		expect(read.studies.map((study) => study.study_id)).toEqual(['study_1', 'study_2']);
		expect(read.studies.map((study) => study.pane)).toEqual(['price_overlay', 'sub_pane']);
		// The provenance a human is shown on the panel is this same record.
		expect(read.price_adjustment).toEqual({ chart_policy: 'adjusted', applied: 'adjusted' });
		expect(read.provenance.as_of).toBe(NOW);
		expect(read.provenance.liveness).toBe('delayed');

		const trendline = await call('add_chart_annotation', TRENDLINE_INPUT);
		expect(trendline.affected_ids).toContain('annotation_1');
		const window = await call('add_chart_annotation', SETUP_WINDOW_INPUT);
		expect(window.affected_ids).toContain('annotation_2');
		expect(readChartState(currentDoc(), PANEL_ID).annotations).toHaveLength(2);

		const captured = (await call('capture_chart_setup', CAPTURE_INPUT)) as CapturePayload;
		expect(captured.setup_id).toBe('setup_1');

		// Retrievable by the ID the tool returned, holding what the chart showed.
		const setup = readCapturedSetup(currentDoc(), captured.setup_id);
		expect(setup?.setupId).toBe(captured.setup_id);
		expect(setup?.instrument.symbol).toBe('NVDA');
		expect(setup?.name).toBe('NVDA base breakout');
		expect(setup?.studies.map((study) => study.catalogItemId)).toEqual(['study.sma', 'study.rsi']);
		expect(setup?.annotations).toHaveLength(2);
	});

	it('shows the instrument, both studies and both drawings on the rendered panel', async () => {
		for (const step of smokeSteps()) {
			await step.apply();
		}
		const outcome = await readChartData(
			{ repository: deps.repository, series: deps.series, clock: deps.clock },
			{ panelId: PANEL_ID, window: { form: 'last_n_bars', lastNBars: 30 } }
		);
		if (!outcome.ok) {
			throw new Error(`the panel had nothing to render: ${outcome.refusal.message}`);
		}
		const panel = renderPanel(currentDoc(), outcome.data);
		try {
			expect(panel.querySelector('[data-testid="chart-instrument"]')?.textContent).toBe('NVDA');
			// Both studies appear, each drawn where the studies contract places it.
			expect(panel.querySelector('path[data-study-id="study_1"]')).not.toBeNull();
			expect(panel.querySelector('svg[data-study-id="study_2"]')).not.toBeNull();
			expect(
				[...panel.querySelectorAll('li[data-study-id]')].map((li) =>
					li.getAttribute('data-study-id')
				)
			).toEqual(['study_1', 'study_2']);
			// Both drawings appear, at their anchors.
			expect(panel.querySelector('line[data-annotation-id="annotation_1"]')).not.toBeNull();
			expect(panel.querySelector('rect[data-annotation-id="annotation_2"]')).not.toBeNull();
			// The provenance the agent was handed is on screen too.
			expect(panel.querySelector('[data-testid="chart-liveness"]')?.textContent).toContain(
				'delayed by 900s'
			);
			expect(panel.querySelector('[data-testid="chart-as-of"]')?.textContent).toContain(NOW);
			expect(panel.querySelector('[data-testid="chart-adjustment"]')?.textContent).toContain(
				'adjusted'
			);
			expect(panel.querySelector('[data-testid="chart-scale"]')?.textContent).toContain(
				'logarithmic'
			);
		} finally {
			panel.dispose();
		}
	});

	// Undo is one step deep by design -- a token is only redeemable while its
	// change is the newest, and rolling further back is what
	// restore_workspace_revision is for. So each mutation is undone while it is
	// still the newest change, then re-applied to reach the next one.
	it('restores the prior chart when each mutation undo token is redeemed', async () => {
		for (const step of smokeSteps()) {
			const before = snapshot();
			const envelope = await step.apply();
			expect(envelope.undo_token, `${step.name} returned no undo token`).not.toBeNull();
			expect(snapshot(), `${step.name} changed nothing`).not.toBe(before);

			undoChange(envelope.undo_token!, {
				history: deps.history,
				revisionService: deps.revisions,
				clock: deps.clock,
				context: { actor: 'agent' }
			});
			expect(snapshot(), `undoing "${step.name}" did not restore the prior chart`).toBe(before);

			await step.apply();
		}
		// The undone-and-redone run still ends where the forward run ends.
		const finalState = readChartState(currentDoc(), PANEL_ID);
		expect(finalState.config.instrument).toEqual(NVDA);
		expect(finalState.studies).toHaveLength(2);
		expect(finalState.annotations).toHaveLength(2);
		expect(readCapturedSetups(currentDoc())).toHaveLength(1);
	});

	it('renders the empty frame, not a broken one, before the chart is bound', () => {
		const panel = renderPanel(currentDoc(), null);
		try {
			expect(panel.querySelector('[data-testid="chart-panel"]')).not.toBeNull();
			expect(panel.querySelector('[data-testid="chart-empty"]')?.textContent).toContain(
				'not pointed at an instrument'
			);
		} finally {
			panel.dispose();
		}
	});
});

interface RenderedPanel {
	querySelector(selector: string): Element | null;
	querySelectorAll(selector: string): NodeListOf<Element>;
	dispose(): void;
}

function renderPanel(doc: WorkspaceDocument, data: ChartDataResult | null): RenderedPanel {
	const target = window.document.createElement('div');
	window.document.body.appendChild(target);
	const app = mount(ChartPanel, {
		target,
		props: { workspace: doc, panelId: PANEL_ID, data }
	});
	flushSync();
	return {
		querySelector: (selector) => target.querySelector(selector),
		querySelectorAll: (selector) => target.querySelectorAll(selector),
		dispose: () => {
			unmount(app);
			target.remove();
		}
	};
}
