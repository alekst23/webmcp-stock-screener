// Pure rendering-data logic for T-0001-7's grid/focus/histogram views --
// kept separate from the Svelte components so it's unit-testable without a
// DOM (matching this codebase's existing test style: store/engine logic is
// tested directly, not through component rendering).
import type { BackendPriceBar, InstanceWindowView } from './apiEngine';

export interface AlignedWindow {
	ticker: string;
	date: string;
	completeness?: number;
	// completeness < 1: the setup pattern hasn't fully resolved yet, so the
	// window may have no bars past the anchor -- see spec.md's
	// "partial instances present" scenario.
	isPartial: boolean;
	bars: BackendPriceBar[];
	// Index into `bars` of the instance's own anchor date (t=0). Found by
	// matching each bar's calendar date rather than assuming a fixed offset
	// from window[0]: InstanceWindow's bars are clipped asymmetrically at
	// the panel's edges (backend/infra/pandas_engine.py's
	// _instance_window), so a fixed offset would misalign edge instances.
	anchorIndex: number;
}

export function alignInstanceWindow(view: InstanceWindowView): AlignedWindow {
	const anchorIndex = Math.max(
		0,
		view.bars.findIndex((bar) => bar.date === view.date)
	);
	return {
		ticker: view.ticker,
		date: view.date,
		completeness: view.completeness,
		isPartial: (view.completeness ?? 1) < 1,
		bars: view.bars,
		anchorIndex
	};
}

// One aligned mini-chart per instance -- AC1's small-multiples grid, each
// indexed to its own anchor date rather than a shared calendar timeline.
export function alignInstanceWindows(views: InstanceWindowView[]): AlignedWindow[] {
	return views.map(alignInstanceWindow);
}

export interface ChartGeometry {
	min: number;
	max: number;
	// Bar index -> SVG x coordinate (viewBox space, not rendered pixels --
	// PriceChart.svelte's pointer handling converts client coordinates into
	// this space via the SVG's own bounding rect before calling nearestBarIndex).
	x: (index: number) => number;
	// Close price -> SVG y coordinate (viewBox space).
	y: (close: number) => number;
	linePath: string;
	// Same path as linePath, closed down to the chart's bottom edge -- for
	// PriceChart.svelte's filled-area gradient under the line.
	areaPath: string;
}

const EMPTY_GEOMETRY: ChartGeometry = {
	min: 0,
	max: 0,
	x: () => 0,
	y: () => 0,
	linePath: '',
	areaPath: ''
};

export function computeChartGeometry(
	bars: BackendPriceBar[],
	width: number,
	height: number
): ChartGeometry {
	const closes = bars.map((b) => b.close);
	if (closes.length === 0) {
		return EMPTY_GEOMETRY;
	}
	const min = Math.min(...closes);
	const max = Math.max(...closes);
	const range = max - min || 1;
	const lastIndex = Math.max(1, closes.length - 1);
	const x = (index: number): number => (index / lastIndex) * width;
	const y = (close: number): number => height - ((close - min) / range) * height;
	const linePath = closes
		.map((close, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(close).toFixed(1)}`)
		.join(' ');
	const areaPath = `${linePath} L${x(lastIndex).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
	return { min, max, x, y, linePath, areaPath };
}

// Maps a pointer's x position (already converted into the chart's viewBox
// coordinate space by the caller) to the nearest bar index, for hover
// tooltips/crosshairs.
export function nearestBarIndex(viewBoxX: number, barCount: number, width: number): number {
	if (barCount === 0) {
		return 0;
	}
	const lastIndex = barCount - 1;
	const fraction = Math.min(1, Math.max(0, viewBoxX / width));
	return Math.round(fraction * lastIndex);
}

// Evenly spaced values between min and max (inclusive), for axis tick
// labels. Collapses to a single tick when the range is zero or count <= 1.
export function axisTicks(min: number, max: number, count: number): number[] {
	if (count <= 1 || min === max) {
		return [max];
	}
	return Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
}

// Evenly spaced bar indices (inclusive of the first and last bar), for
// x-axis date labels.
export function axisTickIndices(barCount: number, count: number): number[] {
	if (barCount === 0) {
		return [];
	}
	const lastIndex = barCount - 1;
	if (count <= 1 || lastIndex === 0) {
		return [0];
	}
	return Array.from({ length: count }, (_, i) => Math.round((lastIndex * i) / (count - 1)));
}

export type ChartRange = '5d' | '1m' | 'max';

const RANGE_TRADING_DAYS: Record<Exclude<ChartRange, 'max'>, number> = {
	'5d': 5,
	'1m': 21
};

// Client-side slice of the already-fetched bars, not a new backend fetch --
// there's no more historical data available than what's already in `bars`.
// Takes the most recent N trading days of whatever was fetched, so this is
// exact for the common case (a trailing window ending at the anchor date,
// e.g. "Show monthly") and a reasonable approximation for a window that
// extends past the anchor into forward-return territory (the slice may not
// include the anchor at all in that case -- see FocusChart.svelte's
// anchor-index clamping).
export function sliceBarsForRange(bars: BackendPriceBar[], range: ChartRange): BackendPriceBar[] {
	if (range === 'max') {
		return bars;
	}
	const days = RANGE_TRADING_DAYS[range];
	return bars.slice(Math.max(0, bars.length - days));
}

