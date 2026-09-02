// Everything the chart panel draws, derived from chart state and one bounded
// read, with no DOM and no framework in sight.
//
// The panel component is deliberately thin: every decision about what appears
// where is made here, so it can be asserted on directly rather than through
// rendered markup. Two inputs, both already the single source of their own
// truth -- `ChartState` for what the chart is configured to show, and the
// `ChartDataResult` that `get_chart_data` returns for the bars, the calculated
// study values and the provenance. Feeding the panel the agent's own read is
// what makes "the human sees what the agent sees" structural rather than a
// convention someone has to keep.
//
// Annotations come in as a `ChartAnnotationsView` rather than off the state,
// because staleness is computed in exactly one place and a second computation
// here could disagree with the one the tools report.
import type { ResourceId } from '../../domain/ids';
import type { MarketDataProvenance } from '../../domain/provenance';
import type { ChartAnnotation } from '../domain/annotations';
import type {
	ChartCandleType,
	ChartPriceAdjustment,
	ChartScale,
	ChartSession,
	ChartState,
	ChartTimeframe
} from '../domain/chartState';
import type { ComparisonRef, InstrumentRef } from '../domain/instrument';
import type { OhlcvBar } from '../domain/seriesPort';
import type { StudyPane } from '../domain/studies';
import { sortStudiesForDisplay } from '../domain/studies';
import type { ChartAnnotationsView } from '../application/chartAnnotations';
import type { ChartDataResult, ChartDataStudy } from '../application/chartData';
import { projectComparison, type SeriesValue } from './chartNormalization';
import {
	barsForCandleType,
	buildPricePane,
	createPriceScale,
	priceAxisTicks,
	seriesPath,
	timeAxisTickIndices,
	type PricePane,
	type PriceScale
} from './chartScales';

export const DEFAULT_PANEL_WIDTH = 720;
export const DEFAULT_PRICE_HEIGHT = 260;
export const DEFAULT_SUB_PANE_HEIGHT = 70;

export interface ComparisonBars {
	instrumentId: string;
	bars: readonly OhlcvBar[];
}

export interface ChartPanelModelInput {
	state: ChartState;
	annotations: ChartAnnotationsView;
	// Null before the first read resolves, or when the chart names no
	// instrument yet: the panel then draws its frame and says why it is empty.
	data: ChartDataResult | null;
	comparisons?: readonly ComparisonBars[];
	width?: number;
	priceHeight?: number;
	subPaneHeight?: number;
}

export interface StudySeriesView {
	name: string;
	values: SeriesValue[];
	path: string;
}

// Every study on the chart, enabled or not, in the order the study list
// defines. A disabled study keeps its entry -- and therefore its place -- and
// simply draws nothing, which is what makes toggling reversible on screen.
export interface StudyListEntry {
	studyId: ResourceId;
	catalogItemId: string;
	pane: StudyPane;
	order: number;
	enabled: boolean;
	drawn: boolean;
}

export interface StudyOverlayView {
	studyId: ResourceId;
	catalogItemId: string;
	order: number;
	series: StudySeriesView[];
	warnings: string[];
}

export interface StudySubPaneView extends StudyOverlayView {
	height: number;
	price: PriceScale;
	axis: { value: number; y: number }[];
}

export type AnnotationShape =
	| { shape: 'trendline'; x1: number; y1: number; x2: number; y2: number }
	| { shape: 'price_level'; y: number; price: number }
	| { shape: 'band'; x: number; width: number; start: string; end: string }
	| { shape: 'label'; x: number; y: number; text: string };

export interface AnnotationMarkView {
	annotationId: ResourceId;
	kind: ChartAnnotation['kind'];
	// The chart's adjustment policy has moved on since this was drawn, so its
	// price no longer means the same number. Drawn differently, never hidden.
	stale: boolean;
	label?: string;
	geometry: AnnotationShape;
}

export interface ComparisonSeriesView {
	instrument: InstrumentRef;
	normalization: ComparisonRef['normalization'];
	unitLabel: string;
	anchorIndex: number;
	path: string;
	values: SeriesValue[];
	// Present only when no bars were supplied for the comparison instrument.
	missing: boolean;
}

export interface ProvenanceView {
	asOf: string;
	liveness: MarketDataProvenance['liveness'];
	delaySeconds: number | null;
	sourceLabel: string;
	timezone: string;
	currency: string | null;
}

export interface ChartPanelModel {
	panelId: ResourceId;
	instrument: InstrumentRef | null;
	timeframe: ChartTimeframe;
	candleType: ChartCandleType;
	// What was configured, and what the pane could actually be drawn on: a
	// logarithmic axis is undefined for a non-positive price.
	requestedScale: ChartScale;
	effectiveScale: ChartScale;
	session: ChartSession;
	priceAdjustment: { chartPolicy: ChartPriceAdjustment; applied: ChartPriceAdjustment | null };
	provenance: ProvenanceView | null;
	width: number;
	priceHeight: number;
	barCount: number;
	// Why there is nothing to draw, when there is nothing to draw.
	emptyReason: 'no_instrument' | 'no_data' | 'no_bars' | null;
	pricePane: PricePane | null;
	priceAxis: { value: number; y: number }[];
	timeAxis: { index: number; x: number; label: string }[];
	studies: StudyListEntry[];
	overlays: StudyOverlayView[];
	subPanes: StudySubPaneView[];
	annotations: AnnotationMarkView[];
	comparisons: ComparisonSeriesView[];
	warnings: string[];
}

const PRICE_TICK_COUNT = 5;
const TIME_TICK_COUNT = 5;
const SUB_PANE_TICK_COUNT = 2;

function toProvenanceView(provenance: MarketDataProvenance): ProvenanceView {
	return {
		asOf: provenance.asOf,
		liveness: provenance.liveness,
		// An explicit null rather than an omitted key: the panel should say "no
		// delay" outright rather than leave a reader to infer it from silence.
		delaySeconds: provenance.delaySeconds ?? null,
		sourceLabel: provenance.sourceLabel,
		timezone: provenance.timezone,
		currency: provenance.currency ?? null
	};
}

function emptyModel(
	input: ChartPanelModelInput,
	reason: 'no_instrument' | 'no_data'
): ChartPanelModel {
	const config = input.state.config;
	return {
		panelId: config.panelId,
		instrument: config.instrument,
		timeframe: config.timeframe,
		candleType: config.candleType,
		requestedScale: config.scale,
		effectiveScale: 'linear',
		session: config.session,
		priceAdjustment: { chartPolicy: config.priceAdjustment, applied: null },
		provenance: null,
		width: input.width ?? DEFAULT_PANEL_WIDTH,
		priceHeight: input.priceHeight ?? DEFAULT_PRICE_HEIGHT,
		barCount: 0,
		emptyReason: reason,
		pricePane: null,
		priceAxis: [],
		timeAxis: [],
		studies: studyList(input.state, []),
		overlays: [],
		subPanes: [],
		annotations: [],
		comparisons: [],
		warnings: []
	};
}

function studyList(state: ChartState, drawn: readonly ResourceId[]): StudyListEntry[] {
	return sortStudiesForDisplay(state.studies).map((study) => ({
		studyId: study.id,
		catalogItemId: study.catalogItemId,
		pane: study.pane,
		order: study.order,
		enabled: study.enabled,
		drawn: drawn.includes(study.id)
	}));
}

function annotationPriceValues(annotations: readonly ChartAnnotation[]): number[] {
	return annotations.flatMap((annotation) => {
		const anchors = annotation.anchors;
		switch (anchors.kind) {
			case 'trendline':
				return [anchors.from.price, anchors.to.price];
			case 'price_level':
				return [anchors.price];
			case 'label':
				return [anchors.at.price];
			default:
				return [];
		}
	});
}

function annotationGeometry(annotation: ChartAnnotation, pane: PricePane): AnnotationShape {
	const anchors = annotation.anchors;
	const { time, price } = pane;
	switch (anchors.kind) {
		case 'trendline':
			return {
				shape: 'trendline',
				x1: time.x(time.indexOfTime(anchors.from.time)),
				y1: price.y(anchors.from.price),
				x2: time.x(time.indexOfTime(anchors.to.time)),
				y2: price.y(anchors.to.price)
			};
		case 'price_level':
			return { shape: 'price_level', y: price.y(anchors.price), price: anchors.price };
		case 'date_range':
		case 'setup_window': {
			const from = time.x(time.indexOfTime(anchors.start));
			const to = time.x(time.indexOfTime(anchors.end));
			return {
				shape: 'band',
				x: Math.min(from, to),
				width: Math.abs(to - from),
				start: anchors.start,
				end: anchors.end
			};
		}
		case 'label':
			return {
				shape: 'label',
				x: time.x(time.indexOfTime(anchors.at.time)),
				y: price.y(anchors.at.price),
				text: anchors.text
			};
	}
}

function overlayView(study: ChartDataStudy, pane: PricePane): StudyOverlayView {
	return {
		studyId: study.studyId,
		catalogItemId: study.catalogItemId,
		order: 0,
		series: Object.entries(study.outputs).map(([name, values]) => ({
			name,
			values: [...values],
			path: seriesPath(values, pane.time, pane.price)
		})),
		warnings: [...study.warnings]
	};
}

function subPaneView(study: ChartDataStudy, pane: PricePane, height: number): StudySubPaneView {
	const values = Object.values(study.outputs).flatMap((series) =>
		[...series].filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
	);
	// A sub-pane study is on its own units -- an RSI is not a price -- so it
	// gets its own linear scale rather than borrowing the price axis.
	const scale = createPriceScale(values, height, 'linear');
	return {
		studyId: study.studyId,
		catalogItemId: study.catalogItemId,
		order: 0,
		height,
		price: scale,
		axis: priceAxisTicks(scale, SUB_PANE_TICK_COUNT).map((value) => ({ value, y: scale.y(value) })),
		series: Object.entries(study.outputs).map(([name, series]) => ({
			name,
			values: [...series],
			path: seriesPath(series, pane.time, scale)
		})),
		warnings: [...study.warnings]
	};
}

// Projected before the price scale exists, because the scale has to be wide
// enough to hold the comparison: a rebased series that runs off the top of the
// pane is not "a shared scale", it is a line nobody can see.
function projectComparisons(
	state: ChartState,
	drawnBars: readonly OhlcvBar[],
	supplied: readonly ComparisonBars[]
): Omit<ComparisonSeriesView, 'path'>[] {
	const primary = drawnBars.map((bar) => bar.close as SeriesValue);
	return state.config.comparisons.map((comparison) => {
		const bars = supplied.find(
			(entry) => entry.instrumentId === comparison.instrument.instrumentId
		);
		const aligned = alignToPrimary(drawnBars, bars?.bars ?? []);
		const projected = projectComparison(primary, aligned, comparison.normalization);
		return {
			instrument: comparison.instrument,
			normalization: comparison.normalization,
			unitLabel: projected.unitLabel,
			anchorIndex: projected.anchorIndex,
			values: projected.values,
			missing: bars === undefined
		};
	});
}

function drawComparisons(
	projected: readonly Omit<ComparisonSeriesView, 'path'>[],
	pane: PricePane
): ComparisonSeriesView[] {
	return projected.map((comparison) => ({
		...comparison,
		path: comparison.missing ? '' : seriesPath(comparison.values, pane.time, pane.price)
	}));
}

// The comparison is drawn against the primary's bars, so a comparison bar only
// counts when it shares a primary bar's timestamp. A missing session leaves a
// hole in the line rather than shifting every later value one bar left.
function alignToPrimary(
	primary: readonly OhlcvBar[],
	comparison: readonly OhlcvBar[]
): SeriesValue[] {
	const byTime = new Map(comparison.map((bar) => [bar.time, bar.close]));
	return primary.map((bar) => byTime.get(bar.time) ?? null);
}

export function buildChartPanelModel(input: ChartPanelModelInput): ChartPanelModel {
	const config = input.state.config;
	if (!config.instrument) {
		return emptyModel(input, 'no_instrument');
	}
	const data = input.data;
	if (!data) {
		return emptyModel(input, 'no_data');
	}
	const width = input.width ?? DEFAULT_PANEL_WIDTH;
	const priceHeight = input.priceHeight ?? DEFAULT_PRICE_HEIGHT;
	const subPaneHeight = input.subPaneHeight ?? DEFAULT_SUB_PANE_HEIGHT;
	const annotations = input.annotations.annotations;
	const drawnBars = barsForCandleType(data.bars, config.candleType);
	const projected = projectComparisons(input.state, drawnBars, input.comparisons ?? []);
	const pane = buildPricePane({
		bars: drawnBars,
		candleType: config.candleType,
		scale: config.scale,
		width,
		height: priceHeight,
		extraPrices: [
			...annotationPriceValues(annotations.map((entry) => entry.annotation)),
			...projected.flatMap((comparison) =>
				comparison.values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
			)
		]
	});
	const overlays = data.studies.filter((study) => study.pane === 'price_overlay');
	const subPanes = data.studies.filter((study) => study.pane === 'sub_pane');
	return {
		panelId: config.panelId,
		instrument: data.instrument,
		timeframe: data.timeframe,
		candleType: config.candleType,
		requestedScale: config.scale,
		effectiveScale: pane.price.kind,
		session: data.session,
		priceAdjustment: { ...data.priceAdjustment },
		provenance: toProvenanceView(data.provenance),
		width,
		priceHeight,
		barCount: data.barCount,
		emptyReason: data.bars.length === 0 ? 'no_bars' : null,
		pricePane: pane,
		priceAxis: priceAxisTicks(pane.price, PRICE_TICK_COUNT).map((value) => ({
			value,
			y: pane.price.y(value)
		})),
		timeAxis: timeAxisTickIndices(pane.bars.length, TIME_TICK_COUNT).map((index) => ({
			index,
			x: pane.time.x(index),
			label: pane.bars[index]?.time ?? ''
		})),
		studies: studyList(
			input.state,
			data.studies.map((study) => study.studyId)
		),
		overlays: overlays.map((study, order) => ({ ...overlayView(study, pane), order })),
		subPanes: subPanes.map((study, order) => ({
			...subPaneView(study, pane, subPaneHeight),
			order
		})),
		annotations: annotations.map((entry) => ({
			annotationId: entry.annotation.id,
			kind: entry.annotation.kind,
			stale: entry.stale,
			...(entry.annotation.label !== undefined ? { label: entry.annotation.label } : {}),
			geometry: annotationGeometry(entry.annotation, pane)
		})),
		comparisons: drawComparisons(projected, pane),
		warnings: [...data.warnings]
	};
}
