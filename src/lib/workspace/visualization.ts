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

