// Pure rendering-data logic for T-1001-7's grid/focus/histogram views --
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

export interface HistogramBucket {
	rangeStart: number;
	rangeEnd: number;
	count: number;
}

// (close[anchor + horizonDays] - close[anchor]) / close[anchor], mirroring
// backend/infra/pandas_engine.py's _forward_return exactly -- computed here
// from the same InstanceWindow bars the grid already renders, so the
// histogram (AC3) needs no extra tool call or backend endpoint: measure()
// only returns an aggregate (median/mean/hit_rate), never the per-instance
// values a distribution requires. An instance without enough bars past its
// anchor (too close to the panel's trailing edge, or a partial/unresolved
// match) is silently skipped -- there's no outcome to plot yet, same as
// the backend's own _forward_return returning None.
export function computeForwardReturns(views: InstanceWindowView[], horizonDays: number): number[] {
	const returns: number[] = [];
	for (const view of views) {
		const { bars, anchorIndex } = alignInstanceWindow(view);
		const anchorBar = bars[anchorIndex];
		const targetBar = bars[anchorIndex + horizonDays];
		if (!anchorBar || !targetBar || anchorBar.close === 0) {
			continue;
		}
		returns.push((targetBar.close - anchorBar.close) / anchorBar.close);
	}
	return returns;
}

export function buildHistogram(values: number[], bucketCount = 10): HistogramBucket[] {
	if (values.length === 0) {
		return [];
	}
	const min = Math.min(...values);
	const max = Math.max(...values);
	if (min === max) {
		return [{ rangeStart: min, rangeEnd: max, count: values.length }];
	}
	const width = (max - min) / bucketCount;
	const buckets: HistogramBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
		rangeStart: min + i * width,
		rangeEnd: min + (i + 1) * width,
		count: 0
	}));
	for (const value of values) {
		const index = Math.min(bucketCount - 1, Math.floor((value - min) / width));
		buckets[index]!.count++;
	}
	return buckets;
}
