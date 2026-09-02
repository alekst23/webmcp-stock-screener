// The preview evaluator (T-1014-8, AC4-7): a bounded, cheap recent-window
// read, not the backtest engine -- T-1014-5 ships that separately and this
// ticket does not depend on it. This module owns two things: the narrow port
// a preview reads history through, and the pure aggregation of whatever the
// port reports into the count/rate/instruments/dates a preview promises.
//
// Domain layer: the port is a values-in/values-out contract (mirrors
// screener/ports.ts's ScreenerMarketData) and the aggregator is pure. No I/O
// happens in this file.
import type { FilterNode, UniverseSpec } from '../../../screener/definition';

export interface AlertPreviewWindow {
	// ISO-8601 dates, inclusive.
	start: string;
	end: string;
}

export interface AlertFiringEvent {
	instrumentId: string;
	// ISO-8601 date the condition held.
	firedAt: string;
}

export interface AlertHistoricalEvaluation {
	firings: AlertFiringEvent[];
	// The number of trading days the port actually evaluated -- stated by the
	// port rather than recomputed from the window's calendar span, since only
	// the port knows what it could evaluate (weekends, holidays, listing gaps).
	evaluatedDays: number;
	warnings: string[];
}

// The seam a preview reads history through. Deliberately narrow -- resolve
// the universe, evaluate a filter tree over a window -- so infra owns *how*
// to evaluate history and this ticket owns only what a preview reports once
// it has an answer.
export interface AlertHistoricalDataPort {
	resolveUniverse(universe: UniverseSpec): Promise<string[]>;
	evaluate(input: {
		instrumentIds: string[];
		filterTree: FilterNode;
		window: AlertPreviewWindow;
	}): Promise<AlertHistoricalEvaluation>;
}

// Fires per evaluated trading day, on average. A default this permissive
// (more than one firing per trading day, averaged) is deliberately generous:
// it flags an alert that would page the researcher more than about once a
// day, not one that fires occasionally. Configurable per call.
export const DEFAULT_ALERT_NOISE_THRESHOLD = 1;

export const DEFAULT_PREVIEW_WINDOW_DAYS = 90;
export const MAX_PREVIEW_WINDOW_DAYS = 365;

// Bounded read (AC's "bounded, not a full backtest" guidance, mirroring
// get_chart_data's own bar cap): a preview lists at most this many individual
// firing events, even when more occurred.
export const PREVIEW_FIRINGS_LIST_CAP = 200;

export interface AlertPreviewReport {
	window: AlertPreviewWindow;
	evaluatedDays: number;
	firingCount: number;
	firingRate: number;
	noisy: boolean;
	noiseThreshold: number;
	instruments: string[];
	firings: AlertFiringEvent[];
	firingsTruncated: boolean;
	warnings: string[];
}

// Pure aggregation over an already-computed AlertHistoricalEvaluation. Zero
// firings is a perfectly normal report (AC7): there is no error branch here,
// only arithmetic.
export function summarizePreview(input: {
	window: AlertPreviewWindow;
	evaluation: AlertHistoricalEvaluation;
	noiseThreshold?: number;
}): AlertPreviewReport {
	const threshold = input.noiseThreshold ?? DEFAULT_ALERT_NOISE_THRESHOLD;
	const { firings, evaluatedDays, warnings } = input.evaluation;
	const firingCount = firings.length;
	// No evaluable trading days in the window (e.g. a weekend-only span) means
	// there is nothing to divide by -- reported as zero rate, never NaN or
	// Infinity, with the reason surfaced as a warning rather than silently
	// folded into "never fires".
	const firingRate = evaluatedDays > 0 ? firingCount / evaluatedDays : 0;
	const instruments = [...new Set(firings.map((f) => f.instrumentId))].sort();
	const sortedFirings = [...firings].sort((a, b) => a.firedAt.localeCompare(b.firedAt));
	const truncated = sortedFirings.length > PREVIEW_FIRINGS_LIST_CAP;
	const allWarnings = [...warnings];
	if (evaluatedDays === 0) {
		allWarnings.push('The window had no evaluable trading days.');
	}
	if (truncated) {
		allWarnings.push(
			`Showing the first ${PREVIEW_FIRINGS_LIST_CAP} of ${sortedFirings.length} firings.`
		);
	}
	return {
		window: input.window,
		evaluatedDays,
		firingCount,
		firingRate,
		noisy: firingRate > threshold,
		noiseThreshold: threshold,
		instruments,
		firings: sortedFirings.slice(0, PREVIEW_FIRINGS_LIST_CAP),
		firingsTruncated: truncated,
		warnings: allWarnings
	};
}
