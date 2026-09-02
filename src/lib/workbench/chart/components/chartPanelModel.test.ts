import { describe, expect, it } from 'vitest';
import { makeProvenance } from '../../domain/provenance';
import { emptyWorkspace } from '../../domain/workspace';
import type { WorkspaceDocument } from '../../domain/workspace';
import { readChartAnnotationsView } from '../application/chartAnnotations';
import type { ChartDataResult, ChartDataStudy } from '../application/chartData';
import type { ChartAnnotation } from '../domain/annotations';
import { createChartState, writeChartState } from '../domain/chartState';
import type { ChartCandleType, ChartScale, ChartState } from '../domain/chartState';
import type { ComparisonRef, InstrumentRef, Normalization } from '../domain/instrument';
import type { OhlcvBar } from '../domain/seriesPort';
import type { StudyInstance } from '../domain/studies';
import { buildChartPanelModel } from './chartPanelModel';

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
		const close = base + index;
		return {
			time: at.toISOString().slice(0, 10),
			open: close - 1,
			high: close + 2,
			low: close - 3,
			close,
			volume: 1_000 + index
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

function state(
	overrides: {
		candleType?: ChartCandleType;
		scale?: ChartScale;
		studies?: StudyInstance[];
		annotations?: ChartAnnotation[];
		comparisons?: ComparisonRef[];
		instrument?: InstrumentRef | null;
		priceAdjustment?: ChartState['config']['priceAdjustment'];
	} = {}
): ChartState {
	const built = createChartState(PANEL_ID);
	built.config.instrument = overrides.instrument === undefined ? NVDA : overrides.instrument;
	built.config.candleType = overrides.candleType ?? 'candlestick';
	built.config.scale = overrides.scale ?? 'linear';
	built.config.comparisons = overrides.comparisons ?? [];
	built.config.priceAdjustment = overrides.priceAdjustment ?? 'adjusted';
	built.studies = overrides.studies ?? [];
	built.annotations = overrides.annotations ?? [];
	return built;
}

function docFor(chart: ChartState): WorkspaceDocument {
	return writeChartState(emptyWorkspace('workspace_1', 'Research', NOW), chart);
}

function annotationsOf(chart: ChartState) {
	return readChartAnnotationsView(docFor(chart), PANEL_ID);
}

function data(overrides: Partial<ChartDataResult> = {}): ChartDataResult {
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
			liveness: 'end_of_day',
			timezone: 'America/New_York',
			currency: 'USD'
		}),
		warnings: [],
		...overrides
	};
}

function model(chart: ChartState, result: ChartDataResult | null, extra = {}) {
	return buildChartPanelModel({
		state: chart,
		annotations: annotationsOf(chart),
		data: result,
		...extra
	});
}

describe('buildChartPanelModel — the frame', () => {
	it('says a chart pointed at nothing has no instrument to draw', () => {
		const built = model(state({ instrument: null }), data());
		expect(built.emptyReason).toBe('no_instrument');
		expect(built.pricePane).toBeNull();
		expect(built.instrument).toBeNull();
	});

	it('says a chart with no read yet has no data, not no instrument', () => {
		const built = model(state(), null);
		expect(built.emptyReason).toBe('no_data');
		expect(built.instrument).toEqual(NVDA);
	});

	it('says a range holding no bars is empty without losing the instrument', () => {
		const built = model(state(), data({ bars: [], barCount: 0 }));
		expect(built.emptyReason).toBe('no_bars');
		expect(built.instrument).toEqual(NVDA);
	});

	it('draws a date axis and a price axis over the visible range', () => {
		const built = model(state(), data({ bars: bars(5) }));
		expect(built.timeAxis).toHaveLength(5);
		expect(built.timeAxis[0]?.label).toBe('2026-01-02');
		expect(built.timeAxis[4]?.label).toBe('2026-01-06');
		expect(built.priceAxis).toHaveLength(5);
		expect(built.priceAxis[0]?.value).toBeLessThan(built.priceAxis[4]!.value);
	});
});

describe('buildChartPanelModel — candle types and scale', () => {
	const CANDLE_TYPES: ChartCandleType[] = [
		'candlestick',
		'ohlc_bar',
		'line',
		'area',
		'heikin_ashi',
		'hollow_candle'
	];

	it.each(CANDLE_TYPES)('draws something for candle type %s', (candleType) => {
		const built = model(state({ candleType }), data());
		const pane = built.pricePane;
		expect(pane).not.toBeNull();
		const drawn = pane!.marks.length > 0 || pane!.linePath !== '';
		expect(drawn).toBe(true);
	});

	it('honours a logarithmic price scale', () => {
		const built = model(state({ scale: 'logarithmic' }), data());
		expect(built.requestedScale).toBe('logarithmic');
		expect(built.effectiveScale).toBe('logarithmic');
	});

	it('reports linear when a logarithmic axis is not defined for the prices', () => {
		const withZero = bars(3).map((bar, index) => (index === 0 ? { ...bar, low: 0 } : bar));
		const built = model(state({ scale: 'logarithmic' }), data({ bars: withZero }));
		expect(built.requestedScale).toBe('logarithmic');
		expect(built.effectiveScale).toBe('linear');
	});
});

describe('buildChartPanelModel — studies', () => {
	it('draws a price-overlay study on the price pane and an RSI in its own pane', () => {
		const built = model(
			state({ studies: [SMA, RSI] }),
			data({
				studies: [
					studyData(SMA, { sma: [null, null, 101, 102, 103] }),
					studyData(RSI, { rsi: [null, null, 55, 60, 65] })
				]
			})
		);
		expect(built.overlays.map((o) => o.studyId)).toEqual(['study_1']);
		expect(built.subPanes.map((s) => s.studyId)).toEqual(['study_2']);
		expect(built.overlays[0]?.series[0]?.path).not.toBe('');
		expect(built.subPanes[0]?.series[0]?.path).not.toBe('');
	});

	it('gives a sub-pane study its own scale rather than the price axis', () => {
		const built = model(
			state({ studies: [RSI] }),
			data({ studies: [studyData(RSI, { rsi: [50, 55, 60, 65, 70] })] })
		);
		const scale = built.subPanes[0]?.price;
		expect(scale?.min).toBe(50);
		expect(scale?.max).toBe(70);
		expect(built.pricePane?.price.min).not.toBe(50);
	});

	it('draws overlays in the order the study list defines', () => {
		const second: StudyInstance = { ...SMA, id: 'study_3', order: 1 };
		const built = model(
			state({ studies: [SMA, second] }),
			data({
				studies: [
					studyData(SMA, { sma: [1, 2, 3, 4, 5] }),
					studyData(second, { sma: [5, 4, 3, 2, 1] })
				]
			})
		);
		expect(built.overlays.map((o) => o.studyId)).toEqual(['study_1', 'study_3']);
		expect(built.overlays.map((o) => o.order)).toEqual([0, 1]);
	});

	it('keeps a toggled-off study in the list, in place, drawing nothing', () => {
		const off = { ...RSI, enabled: false };
		// A disabled study is not in the read's studies -- that is what "drawing
		// nothing" means -- but it must not vanish from the list.
		const built = model(
			state({ studies: [SMA, off] }),
			data({ studies: [studyData(SMA, { sma: [1, 2, 3, 4, 5] })] })
		);
		expect(built.studies.map((s) => s.studyId)).toEqual(['study_1', 'study_2']);
		expect(built.studies.map((s) => s.enabled)).toEqual([true, false]);
		expect(built.studies.map((s) => s.drawn)).toEqual([true, false]);
		expect(built.subPanes).toEqual([]);
	});

	it('breaks an overlay line across warm-up bars rather than bridging them', () => {
		const built = model(
			state({ studies: [SMA] }),
			data({ studies: [studyData(SMA, { sma: [null, null, 101, 102, 103] })] })
		);
		const path = built.overlays[0]!.series[0]!.path;
		expect(path.startsWith('M')).toBe(true);
		expect(path.match(/M/g)).toHaveLength(1);
	});
});

describe('buildChartPanelModel — annotations', () => {
	function annotation(partial: Partial<ChartAnnotation> & Pick<ChartAnnotation, 'id'>) {
		return partial as ChartAnnotation;
	}

	const ALL_KINDS: ChartAnnotation[] = [
		annotation({
			id: 'annotation_1',
			kind: 'trendline',
			anchors: {
				kind: 'trendline',
				from: { time: '2026-01-02', price: 100 },
				to: { time: '2026-01-06', price: 104 }
			},
			priceAdjustment: 'adjusted'
		}),
		annotation({
			id: 'annotation_2',
			kind: 'price_level',
			anchors: { kind: 'price_level', price: 102 },
			priceAdjustment: 'adjusted'
		}),
		annotation({
			id: 'annotation_3',
			kind: 'date_range',
			anchors: { kind: 'date_range', start: '2026-01-03', end: '2026-01-05' },
			priceAdjustment: 'adjusted'
		}),
		annotation({
			id: 'annotation_4',
			kind: 'setup_window',
			anchors: { kind: 'setup_window', start: '2026-01-03', end: '2026-01-06' },
			priceAdjustment: 'adjusted'
		}),
		annotation({
			id: 'annotation_5',
			kind: 'label',
			anchors: { kind: 'label', at: { time: '2026-01-04', price: 103 }, text: 'breakout' },
			priceAdjustment: 'adjusted'
		})
	];

	it('draws all five annotation kinds at their anchors', () => {
		const built = model(state({ annotations: ALL_KINDS }), data());
		expect(built.annotations.map((a) => a.kind)).toEqual([
			'trendline',
			'price_level',
			'date_range',
			'setup_window',
			'label'
		]);
		expect(built.annotations.map((a) => a.geometry.shape)).toEqual([
			'trendline',
			'price_level',
			'band',
			'band',
			'label'
		]);
	});

	it('anchors a trendline to the bars its times name', () => {
		const built = model(state({ annotations: [ALL_KINDS[0]!] }), data({ bars: bars(5) }));
		const geometry = built.annotations[0]!.geometry;
		if (geometry.shape !== 'trendline') {
			throw new Error('expected a trendline geometry');
		}
		expect(geometry.x1).toBe(0);
		expect(geometry.x2).toBe(built.width);
		// Anchored at 100 and 104 on a series running 100..104: bottom to top.
		expect(geometry.y1).toBeGreaterThan(geometry.y2);
	});

	it('spans a band across exactly the bars its dates name', () => {
		const built = model(state({ annotations: [ALL_KINDS[2]!] }), data({ bars: bars(5) }));
		const geometry = built.annotations[0]!.geometry;
		if (geometry.shape !== 'band') {
			throw new Error('expected a band geometry');
		}
		expect(geometry.x).toBeCloseTo(built.width * 0.25, 6);
		expect(geometry.width).toBeCloseTo(built.width * 0.5, 6);
	});

	it('keeps a price level on the axis even when no bar reaches it', () => {
		const high = annotation({
			id: 'annotation_9',
			kind: 'price_level',
			anchors: { kind: 'price_level', price: 500 },
			priceAdjustment: 'adjusted'
		});
		const built = model(state({ annotations: [high] }), data());
		const geometry = built.annotations[0]!.geometry;
		if (geometry.shape !== 'price_level') {
			throw new Error('expected a price level geometry');
		}
		expect(geometry.y).toBe(0);
		expect(built.pricePane?.price.max).toBe(500);
	});

	it('marks an annotation drawn under a different adjustment policy as stale', () => {
		const drawnUnadjusted = annotation({
			id: 'annotation_6',
			kind: 'price_level',
			anchors: { kind: 'price_level', price: 102 },
			priceAdjustment: 'unadjusted'
		});
		const built = model(
			state({ annotations: [ALL_KINDS[1]!, drawnUnadjusted], priceAdjustment: 'adjusted' }),
			data()
		);
		expect(built.annotations.map((a) => a.stale)).toEqual([false, true]);
	});

	it('never hides a stale annotation, only distinguishes it', () => {
		const drawnUnadjusted = annotation({
			id: 'annotation_7',
			kind: 'price_level',
			anchors: { kind: 'price_level', price: 102 },
			priceAdjustment: 'unadjusted'
		});
		const built = model(state({ annotations: [drawnUnadjusted] }), data());
		expect(built.annotations).toHaveLength(1);
		expect(built.annotations[0]?.stale).toBe(true);
		expect(built.annotations[0]?.geometry).toBeDefined();
	});
});

describe('buildChartPanelModel — comparisons', () => {
	function comparison(mode: Normalization['mode']): ComparisonRef {
		return { instrument: AMD, normalization: { mode, anchor: 'window_start' } };
	}

	it('draws the comparison under the configured normalization mode', () => {
		const built = model(state({ comparisons: [comparison('percent_change')] }), data(), {
			comparisons: [{ instrumentId: AMD.instrumentId, bars: bars(5, 10) }]
		});
		expect(built.comparisons).toHaveLength(1);
		expect(built.comparisons[0]?.normalization.mode).toBe('percent_change');
		expect(built.comparisons[0]?.path).not.toBe('');
		expect(built.comparisons[0]?.missing).toBe(false);
	});

	it('puts a ten-times-cheaper comparison on the primary price scale', () => {
		const built = model(state({ comparisons: [comparison('indexed_100')] }), data(), {
			comparisons: [{ instrumentId: AMD.instrumentId, bars: bars(5, 10) }]
		});
		const values = built.comparisons[0]!.values as number[];
		const pane = built.pricePane!;
		// Every projected point lands inside the price pane rather than below it.
		for (const value of values) {
			expect(pane.price.y(value)).toBeGreaterThanOrEqual(0);
			expect(pane.price.y(value)).toBeLessThanOrEqual(built.priceHeight);
		}
	});

	it('overlays raw prices when the mode is none', () => {
		const built = model(state({ comparisons: [comparison('none')] }), data(), {
			comparisons: [{ instrumentId: AMD.instrumentId, bars: bars(5, 10) }]
		});
		expect(built.comparisons[0]?.values).toEqual([10, 11, 12, 13, 14]);
		expect(built.comparisons[0]?.unitLabel).toBe('price');
	});

	it('reports a comparison with no bars loaded rather than drawing a wrong line', () => {
		const built = model(state({ comparisons: [comparison('percent_change')] }), data());
		expect(built.comparisons[0]?.missing).toBe(true);
		expect(built.comparisons[0]?.path).toBe('');
	});

	it('leaves a hole where the comparison is missing a session', () => {
		const sparse = bars(5, 10).filter((_, index) => index !== 2);
		const built = model(state({ comparisons: [comparison('indexed_100')] }), data(), {
			comparisons: [{ instrumentId: AMD.instrumentId, bars: sparse }]
		});
		expect(built.comparisons[0]?.values[2]).toBeNull();
		expect(built.comparisons[0]?.values[3]).not.toBeNull();
	});
});

describe('buildChartPanelModel — provenance', () => {
	it('shows the effective adjustment policy and what the bars were computed under', () => {
		const built = model(
			state({ priceAdjustment: 'split_adjusted' }),
			data({ priceAdjustment: { chartPolicy: 'split_adjusted', applied: 'adjusted' } })
		);
		expect(built.priceAdjustment.chartPolicy).toBe('split_adjusted');
		expect(built.priceAdjustment.applied).toBe('adjusted');
	});

	it('keeps a null applied basis null rather than defaulting it to the request', () => {
		const built = model(
			state(),
			data({ priceAdjustment: { chartPolicy: 'adjusted', applied: null } })
		);
		expect(built.priceAdjustment.applied).toBeNull();
	});

	it('shows the as-of time, the source and the liveness the agent is given', () => {
		const built = model(state(), data());
		expect(built.provenance?.asOf).toBe(NOW);
		expect(built.provenance?.liveness).toBe('end_of_day');
		expect(built.provenance?.sourceLabel).toBe('Test source');
		expect(built.provenance?.timezone).toBe('America/New_York');
		expect(built.provenance?.currency).toBe('USD');
	});

	it('states the delay for a delayed feed and a null delay otherwise', () => {
		const delayed = model(
			state(),
			data({
				provenance: makeProvenance({
					asOf: NOW,
					sourceId: 'src.test',
					sourceLabel: 'Test source',
					liveness: 'delayed',
					delaySeconds: 900,
					timezone: 'America/New_York'
				})
			})
		);
		expect(delayed.provenance?.liveness).toBe('delayed');
		expect(delayed.provenance?.delaySeconds).toBe(900);
		expect(model(state(), data()).provenance?.delaySeconds).toBeNull();
	});

	it('carries the read warnings through so the human sees what the agent saw', () => {
		const built = model(state(), data({ warnings: ['Source supplies unadjusted prices.'] }));
		expect(built.warnings).toEqual(['Source supplies unadjusted prices.']);
	});
});
