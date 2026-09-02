// A fixed bar series both study-engine test files compute against, so a
// reference value checked in one place means the same thing in the other.
//
// The closes are Wilder's published worked example for the relative strength
// index; the highs and lows sit a fixed 0.15 either side of the close, which is
// tighter than most of the day-to-day moves, so the true-range calculation is
// driven by gaps against the previous close rather than by the bar's own range.

import type { OhlcvBar } from '../studyEngine';

export const REFERENCE_CLOSES: readonly number[] = [
	44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28,
	46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18,
	44.22, 44.57, 43.42, 42.66, 43.13
];

export const REFERENCE_HIGHS: readonly number[] = [
	44.49, 44.24, 44.3, 43.76, 44.48, 44.98, 45.25, 45.57, 45.99, 46.23, 46.04, 46.18, 45.76, 46.43,
	46.43, 46.15, 46.18, 46.56, 46.37, 45.79, 46.36, 46.4, 45.86, 46.6, 45.93, 45.5, 44.18, 44.33,
	44.37, 44.72, 43.57, 42.81, 43.28
];

export const REFERENCE_LOWS: readonly number[] = [
	44.19, 43.94, 44.0, 43.46, 44.18, 44.68, 44.95, 45.27, 45.69, 45.93, 45.74, 45.88, 45.46, 46.13,
	46.13, 45.85, 45.88, 46.26, 46.07, 45.49, 46.06, 46.1, 45.56, 46.3, 45.63, 45.2, 43.88, 44.03,
	44.07, 44.42, 43.27, 42.51, 42.98
];

const MILLISECONDS_PER_DAY = 86_400_000;
const FIRST_BAR_MS = Date.UTC(2026, 0, 5);

// Consecutive calendar days rather than trading days: no study here is
// session-aware, and VWAP's anchoring is exercised by its own fixtures below.
export const REFERENCE_BARS: readonly OhlcvBar[] = REFERENCE_CLOSES.map((close, index) => ({
	time: new Date(FIRST_BAR_MS + index * MILLISECONDS_PER_DAY).toISOString().slice(0, 10),
	// No study in the catalog reads the open; it is set to the close so the bar
	// is still internally consistent.
	open: close,
	high: REFERENCE_HIGHS[index] as number,
	low: REFERENCE_LOWS[index] as number,
	close,
	volume: 1_000 + index * 37
}));

// Two bars each on two consecutive days, with prices flat within a bar so the
// typical price is the close and every expected VWAP is arithmetic anyone can
// check by hand.
export const VWAP_BARS: readonly OhlcvBar[] = [
	{ time: '2026-01-04T14:30:00Z', open: 10, high: 10, low: 10, close: 10, volume: 100 },
	{ time: '2026-01-04T15:30:00Z', open: 12, high: 12, low: 12, close: 12, volume: 100 },
	{ time: '2026-01-05T14:30:00Z', open: 20, high: 20, low: 20, close: 20, volume: 100 },
	{ time: '2026-01-05T15:30:00Z', open: 30, high: 30, low: 30, close: 30, volume: 300 }
];
