// What the panel actually puts on screen. The layout decisions are asserted
// against `chartPanelModel`; this file asserts the half that only exists in
// markup -- that a stale drawing looks different from a current one, that a
// toggled-off study is still on screen in its place, and that each candle type
// draws the marks it should.
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { makeProvenance } from '../../domain/provenance';
import { emptyWorkspace } from '../../domain/workspace';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { ChartDataResult, ChartDataStudy } from '../application/chartData';
import type { ChartAnnotation } from '../domain/annotations';
import { createChartState, writeChartState } from '../domain/chartState';
import type { ChartCandleType, ChartState } from '../domain/chartState';
import type { ComparisonRef, InstrumentRef } from '../domain/instrument';
import type { OhlcvBar } from '../domain/seriesPort';
import type { StudyInstance } from '../domain/studies';
import ChartPanel from './ChartPanel.svelte';

const NOW = '2026-09-02T20:00:00.000Z';
const PANEL_ID = 'panel_chart_1';

const NVDA: InstrumentRef = {
	instrumentId: 'inst:XNAS:NVDA',
	symbol: 'NVDA',
	exchange: 'XNAS',
	assetType: 'equity'
};

const AMD: InstrumentRef = {
	instrumentId: 'inst:XNAS:AMD',
	symbol: 'AMD',
	exchange: 'XNAS',
	assetType: 'equity'
};

function bars(count: number, base = 100): OhlcvBar[] {
	return Array.from({ length: count }, (_, index) => {
		const at = new Date(Date.UTC(2026, 0, 2));
		at.setUTCDate(at.getUTCDate() + index);
		// Alternating direction so up and down candles both appear.
		const close = base + index + (index % 2 === 0 ? 1 : -1);
		return {
			time: at.toISOString().slice(0, 10),
			open: base + index,
			high: close + 2,
			low: close - 2,
			close,
			volume: 1_000
		};
	});
}

const SMA: StudyInstance = {
	id: 'study_1',
	catalogItemId: 'study.sma',
	params: { length: 3 },
	pane: 'price_overlay',
	order: 0,
	enabled: true
};

const RSI: StudyInstance = {
	id: 'study_2',
	catalogItemId: 'study.rsi',
	params: { length: 3 },
	pane: 'sub_pane',
	order: 0,
	enabled: true
};

const CURRENT_LEVEL = {
	id: 'annotation_1',
	kind: 'price_level',
	anchors: { kind: 'price_level', price: 103 },
	priceAdjustment: 'adjusted'
} as ChartAnnotation;

const STALE_LEVEL = {
	id: 'annotation_2',
	kind: 'price_level',
	anchors: { kind: 'price_level', price: 104 },
	priceAdjustment: 'unadjusted'
} as ChartAnnotation;

function chartState(
	overrides: {
		candleType?: ChartCandleType;
		studies?: StudyInstance[];
		annotations?: ChartAnnotation[];
		comparisons?: ComparisonRef[];
		instrument?: InstrumentRef | null;
	} = {}
): ChartState {
	const state = createChartState(PANEL_ID);
	state.config.instrument = overrides.instrument === undefined ? NVDA : overrides.instrument;
	state.config.candleType = overrides.candleType ?? 'candlestick';
	state.config.comparisons = overrides.comparisons ?? [];
	state.studies = overrides.studies ?? [];
	state.annotations = overrides.annotations ?? [];
	return state;
}

function documentFor(state: ChartState): WorkspaceDocument {
	return writeChartState(emptyWorkspace('workspace_1', 'Research', NOW), state);
}

function studyData(
	study: StudyInstance,
	outputs: Record<string, (number | null)[]>
): ChartDataStudy {
	return {
		studyId: study.id,
		catalogItemId: study.catalogItemId,
		params: study.params,
		pane: study.pane,
		outputs,
		warmupBars: 0,
		warnings: []
	};
}

function chartData(overrides: Partial<ChartDataResult> = {}): ChartDataResult {
	const seriesBars = overrides.bars ?? bars(5);
	return {
		panelId: PANEL_ID,
		instrument: NVDA,
		timeframe: '1d',
		sourceTimeframe: '1d',
		session: 'regular',
		window: {
			start: seriesBars[0]?.time ?? '',
			end: seriesBars[seriesBars.length - 1]?.time ?? '',
			form: 'visible_range',
			isChartVisibleRange: true,
			note: ''
		},
		chartRange: { start: '2026-01-01', end: '2026-02-01' },
		barCap: 500,
		barCount: seriesBars.length,
		bars: seriesBars,
		aggregation: null,
		studies: [],
		priceAdjustment: { chartPolicy: 'adjusted', applied: 'adjusted' },
		provenance: makeProvenance({
			asOf: NOW,
			sourceId: 'src.test',
			sourceLabel: 'Test source',
			liveness: 'delayed',
			delaySeconds: 900,
			timezone: 'America/New_York'
		}),
		warnings: [],
		...overrides
	};
}

let mounted: (() => void)[] = [];

afterEach(() => {
	mounted.forEach((dispose) => dispose());
	mounted = [];
});

function render(state: ChartState, data: ChartDataResult | null, props = {}): HTMLElement {
	const target = window.document.createElement('div');
	window.document.body.appendChild(target);
	const app = mount(ChartPanel, {
		target,
		props: { workspace: documentFor(state), panelId: PANEL_ID, data, ...props }
	});
	flushSync();
	mounted.push(() => {
		unmount(app);
		target.remove();
	});
	return target;
}

describe('ChartPanel', () => {
	it('names the instrument and the panel it is drawing', () => {
		const panel = render(chartState(), chartData());
		expect(panel.querySelector('[data-testid="chart-instrument"]')?.textContent).toBe('NVDA');
		expect(panel.querySelector('[data-panel-id]')?.getAttribute('data-panel-id')).toBe(PANEL_ID);
	});

	it('says why it is empty rather than drawing an empty frame silently', () => {
		const panel = render(chartState({ instrument: null }), null);
		expect(panel.querySelector('[data-testid="chart-empty"]')?.textContent).toContain(
			'not pointed at an instrument'
		);
		expect(panel.querySelector('svg.price-pane')).toBeNull();
	});

	it('draws candle bodies for a candlestick chart', () => {
		const panel = render(chartState({ candleType: 'candlestick' }), chartData());
		expect(panel.querySelectorAll('g.candle')).toHaveLength(5);
		expect(panel.querySelectorAll('g.candle rect.body')).toHaveLength(5);
	});

	it('marks up and down candles apart so direction is readable', () => {
		const panel = render(chartState({ candleType: 'candlestick' }), chartData());
		expect(panel.querySelectorAll('g.candle--up').length).toBeGreaterThan(0);
		expect(panel.querySelectorAll('g.candle--down').length).toBeGreaterThan(0);
	});

	it('draws open and close ticks rather than bodies for an OHLC bar chart', () => {
		const panel = render(chartState({ candleType: 'ohlc_bar' }), chartData());
		expect(panel.querySelectorAll('g.candle rect.body')).toHaveLength(0);
		expect(panel.querySelectorAll('g.candle line.tick')).toHaveLength(10);
	});

	it('flags hollow candles so an up bar reads as an outline', () => {
		const panel = render(chartState({ candleType: 'hollow_candle' }), chartData());
		expect(panel.querySelectorAll('g.candle--hollow').length).toBe(5);
	});

	it('draws a single path rather than candles for a line chart', () => {
		const panel = render(chartState({ candleType: 'line' }), chartData());
		expect(panel.querySelectorAll('g.candle')).toHaveLength(0);
		expect(panel.querySelector('path.series-line')?.getAttribute('d')).toBeTruthy();
	});

	it('fills under the line for an area chart', () => {
		const panel = render(chartState({ candleType: 'area' }), chartData());
		expect(panel.querySelector('path.series-area')?.getAttribute('d')).toBeTruthy();
	});

	it('overlays a price study on the price pane and puts an RSI in its own pane', () => {
		const panel = render(
			chartState({ studies: [SMA, RSI] }),
			chartData({
				studies: [
					studyData(SMA, { sma: [101, 102, 103, 104, 105] }),
					studyData(RSI, { rsi: [50, 55, 60, 65, 70] })
				]
			})
		);
		expect(panel.querySelector('svg.price-pane path[data-study-id="study_1"]')).not.toBeNull();
		expect(panel.querySelector('svg.sub-pane[data-study-id="study_2"]')).not.toBeNull();
		expect(panel.querySelector('svg.price-pane path[data-study-id="study_2"]')).toBeNull();
	});

	// AC3: turning a study off must not lose its place, or turning it back on
	// would visibly be a different study.
	it('keeps a toggled-off study on screen, in place and marked off', () => {
		const off = { ...RSI, enabled: false };
		const panel = render(
			chartState({ studies: [SMA, off] }),
			chartData({ studies: [studyData(SMA, { sma: [101, 102, 103, 104, 105] })] })
		);
		const entries = [...panel.querySelectorAll('li[data-study-id]')];
		expect(entries.map((li) => li.getAttribute('data-study-id'))).toEqual(['study_1', 'study_2']);
		expect(entries.map((li) => li.getAttribute('data-enabled'))).toEqual(['true', 'false']);
		expect(entries[1]?.classList.contains('study--off')).toBe(true);
		expect(panel.querySelector('svg.sub-pane[data-study-id="study_2"]')).toBeNull();
	});

	// AC4: a stale drawing is neither hidden nor drawn as if it were current.
	it('draws a stale annotation differently from a current one, without hiding it', () => {
		const panel = render(chartState({ annotations: [CURRENT_LEVEL, STALE_LEVEL] }), chartData());
		const current = panel.querySelector('[data-annotation-id="annotation_1"]');
		const stale = panel.querySelector('[data-annotation-id="annotation_2"]');
		expect(current).not.toBeNull();
		expect(stale).not.toBeNull();
		expect(current?.getAttribute('data-stale')).toBe('false');
		expect(stale?.getAttribute('data-stale')).toBe('true');
		expect(current?.classList.contains('annotation--stale')).toBe(false);
		expect(stale?.classList.contains('annotation--stale')).toBe(true);
	});

	it('explains what the different drawing means when anything is stale', () => {
		const withStale = render(chartState({ annotations: [STALE_LEVEL] }), chartData());
		expect(withStale.querySelector('[data-testid="chart-stale-note"]')).not.toBeNull();
		const withoutStale = render(chartState({ annotations: [CURRENT_LEVEL] }), chartData());
		expect(withoutStale.querySelector('[data-testid="chart-stale-note"]')).toBeNull();
	});

	it('draws every annotation kind with the element its shape needs', () => {
		const all: ChartAnnotation[] = [
			{
				id: 'annotation_1',
				kind: 'trendline',
				anchors: {
					kind: 'trendline',
					from: { time: '2026-01-02', price: 100 },
					to: { time: '2026-01-06', price: 105 }
				},
				priceAdjustment: 'adjusted'
			},
			CURRENT_LEVEL_WITH_ID('annotation_2'),
			{
				id: 'annotation_3',
				kind: 'date_range',
				anchors: { kind: 'date_range', start: '2026-01-03', end: '2026-01-05' },
				priceAdjustment: 'adjusted'
			},
			{
				id: 'annotation_4',
				kind: 'setup_window',
				anchors: { kind: 'setup_window', start: '2026-01-03', end: '2026-01-06' },
				priceAdjustment: 'adjusted'
			},
			{
				id: 'annotation_5',
				kind: 'label',
				anchors: { kind: 'label', at: { time: '2026-01-04', price: 103 }, text: 'breakout' },
				priceAdjustment: 'adjusted'
			}
		];
		const panel = render(chartState({ annotations: all }), chartData());
		expect(panel.querySelector('line[data-annotation-id="annotation_1"]')).not.toBeNull();
		expect(panel.querySelector('line[data-annotation-id="annotation_2"]')).not.toBeNull();
		expect(panel.querySelector('rect[data-annotation-id="annotation_3"]')).not.toBeNull();
		expect(panel.querySelector('rect[data-annotation-id="annotation_4"]')).not.toBeNull();
		expect(panel.querySelector('text[data-annotation-id="annotation_5"]')?.textContent).toBe(
			'breakout'
		);
	});

	it('draws a comparison series and names the units it is stated in', () => {
		const panel = render(
			chartState({
				comparisons: [
					{ instrument: AMD, normalization: { mode: 'percent_change', anchor: 'window_start' } }
				]
			}),
			chartData(),
			{ comparisons: [{ instrumentId: AMD.instrumentId, bars: bars(5, 10) }] }
		);
		const path = panel.querySelector(`path[data-comparison-id="${AMD.instrumentId}"]`);
		expect(path?.getAttribute('d')).toBeTruthy();
		expect(path?.getAttribute('data-normalization')).toBe('percent_change');
		expect(panel.querySelector('[data-testid="chart-comparison-list"]')?.textContent).toContain(
			'% change'
		);
	});

	it('says a comparison has no data rather than drawing a line for it', () => {
		const panel = render(
			chartState({
				comparisons: [
					{ instrument: AMD, normalization: { mode: 'percent_change', anchor: 'window_start' } }
				]
			}),
			chartData()
		);
		expect(panel.querySelector(`path[data-comparison-id="${AMD.instrumentId}"]`)).toBeNull();
		expect(panel.querySelector('[data-testid="chart-comparison-list"]')?.textContent).toContain(
			'no data loaded'
		);
	});

	// AC6: the human sees the same provenance the agent is handed.
	it('shows the adjustment policy, the as-of time and the live/delayed status', () => {
		const panel = render(chartState(), chartData());
		expect(panel.querySelector('[data-testid="chart-adjustment"]')?.textContent).toContain(
			'adjusted'
		);
		expect(panel.querySelector('[data-testid="chart-liveness"]')?.textContent).toContain(
			'delayed by 900s'
		);
		expect(panel.querySelector('[data-testid="chart-as-of"]')?.textContent).toContain(NOW);
	});

	it('states both policies when the source could not honour the one requested', () => {
		const panel = render(
			chartState(),
			chartData({ priceAdjustment: { chartPolicy: 'split_adjusted', applied: 'adjusted' } })
		);
		const text = panel.querySelector('[data-testid="chart-adjustment"]')?.textContent ?? '';
		expect(text).toContain('split_adjusted requested');
		expect(text).toContain('adjusted applied');
	});

	it('says the source stated no basis rather than implying one', () => {
		const panel = render(
			chartState(),
			chartData({ priceAdjustment: { chartPolicy: 'adjusted', applied: null } })
		);
		expect(panel.querySelector('[data-testid="chart-adjustment"]')?.textContent).toContain(
			'source states no basis'
		);
	});

	it('says which scale it actually drew on when the configured one is not usable', () => {
		const state = chartState();
		state.config.scale = 'logarithmic';
		const withZero = bars(3).map((bar, index) => (index === 0 ? { ...bar, low: 0 } : bar));
		const panel = render(state, chartData({ bars: withZero }));
		const text = panel.querySelector('[data-testid="chart-scale"]')?.textContent ?? '';
		expect(text).toContain('linear');
		expect(text).toContain('logarithmic not usable here');
	});
});

function CURRENT_LEVEL_WITH_ID(id: string): ChartAnnotation {
	return { ...CURRENT_LEVEL, id } as ChartAnnotation;
}
