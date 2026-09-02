// Pure numeric kernels behind the study engine. Arrays in, arrays out: no
// catalog lookup, no parameter validation, no I/O -- studyEngine.ts owns all of
// that and calls in here only with values it has already checked.
//
// Every function returns a series the same length as its input with `null` at
// every index the definition does not reach. Warm-up is an absence, never a
// substituted number, because a caller reading index i of an output must be
// reading the same bar as index i of the input.
//
// Where an implementation choice would move a number, this file is the record
// of which choice was made; the engine version covers those choices.

export type OutputSeries = (number | null)[];

export function nullSeries(length: number): OutputSeries {
	return new Array<number | null>(length).fill(null);
}

// Loop bounds in this module always keep indices inside their array, but
// `noUncheckedIndexedAccess` cannot see that. Reading through these two helpers
// keeps the arithmetic free of non-null assertions.
function at(values: readonly number[], index: number): number {
	return values[index] as number;
}

function valueAt(series: readonly (number | null)[], index: number): number | null {
	return series[index] ?? null;
}

function windowMean(values: readonly number[], end: number, length: number): number {
	let sum = 0;
	for (let i = end - length + 1; i <= end; i += 1) {
		sum += at(values, i);
	}
	return sum / length;
}

export function simpleMovingAverage(values: readonly number[], length: number): OutputSeries {
	const out = nullSeries(values.length);
	for (let i = length - 1; i < values.length; i += 1) {
		out[i] = windowMean(values, i, length);
	}
	return out;
}

// Seeded with the simple mean of the first `length` values rather than with the
// first value alone: seeding on one observation makes the early output depend
// almost entirely on a single bar, which reads as a spike on the chart.
export function exponentialMovingAverage(values: readonly number[], length: number): OutputSeries {
	const out = nullSeries(values.length);
	if (values.length < length) {
		return out;
	}
	const weight = 2 / (length + 1);
	let previous = windowMean(values, length - 1, length);
	out[length - 1] = previous;
	for (let i = length; i < values.length; i += 1) {
		previous = (at(values, i) - previous) * weight + previous;
		out[i] = previous;
	}
	return out;
}

// True ranges from bar 1 onward. Bar 0 has no previous close, so its true range
// is undefined -- not its own high-low range, which would understate a gap.
function denseTrueRanges(
	highs: readonly number[],
	lows: readonly number[],
	closes: readonly number[]
): number[] {
	const out: number[] = [];
	for (let i = 1; i < closes.length; i += 1) {
		const previousClose = at(closes, i - 1);
		const high = at(highs, i);
		const low = at(lows, i);
		out.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
	}
	return out;
}

export function trueRanges(
	highs: readonly number[],
	lows: readonly number[],
	closes: readonly number[]
): OutputSeries {
	return alignDense(denseTrueRanges(highs, lows, closes), 1, closes.length);
}

// Wilder's smoothing: a simple mean of the first `length` observations, then
// `(previous * (length - 1) + next) / length`. `offset` is the bar index that
// `dense[0]` belongs to, so the result stays aligned to the bar series.
function wilderSmoothed(
	dense: readonly number[],
	length: number,
	offset: number,
	total: number
): OutputSeries {
	const out = nullSeries(total);
	if (dense.length < length) {
		return out;
	}
	let previous = windowMean(dense, length - 1, length);
	out[offset + length - 1] = previous;
	for (let j = length; j < dense.length; j += 1) {
		previous = (previous * (length - 1) + at(dense, j)) / length;
		out[offset + j] = previous;
	}
	return out;
}

export function averageTrueRange(
	highs: readonly number[],
	lows: readonly number[],
	closes: readonly number[],
	length: number
): OutputSeries {
	return wilderSmoothed(denseTrueRanges(highs, lows, closes), length, 1, closes.length);
}

export function relativeStrengthIndex(closes: readonly number[], length: number): OutputSeries {
	const total = closes.length;
	const gains: number[] = [];
	const losses: number[] = [];
	for (let i = 1; i < total; i += 1) {
		const change = at(closes, i) - at(closes, i - 1);
		gains.push(Math.max(change, 0));
		losses.push(Math.max(-change, 0));
	}
	const averageGain = wilderSmoothed(gains, length, 1, total);
	const averageLoss = wilderSmoothed(losses, length, 1, total);
	const out = nullSeries(total);
	for (let i = 0; i < total; i += 1) {
		const gain = valueAt(averageGain, i);
		const loss = valueAt(averageLoss, i);
		if (gain === null || loss === null) {
			continue;
		}
		// A window with no downside has no ratio to form; RSI is 100 by definition.
		out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
	}
	return out;
}

export interface MacdSeries {
	macd: OutputSeries;
	signal: OutputSeries;
	histogram: OutputSeries;
}

export function macd(
	closes: readonly number[],
	fast: number,
	slow: number,
	signal: number
): MacdSeries {
	const total = closes.length;
	const fastEma = exponentialMovingAverage(closes, fast);
	const slowEma = exponentialMovingAverage(closes, slow);
	const line = nullSeries(total);
	const dense: number[] = [];
	let offset = -1;
	for (let i = 0; i < total; i += 1) {
		const fastValue = valueAt(fastEma, i);
		const slowValue = valueAt(slowEma, i);
		if (fastValue === null || slowValue === null) {
			continue;
		}
		line[i] = fastValue - slowValue;
		if (offset < 0) {
			offset = i;
		}
		dense.push(fastValue - slowValue);
	}
	// The signal line is an EMA of the MACD line itself, so it is seeded on the
	// first defined MACD value rather than on the first bar.
	const signalLine =
		offset < 0
			? nullSeries(total)
			: alignDense(exponentialMovingAverage(dense, signal), offset, total);
	const histogram = nullSeries(total);
	for (let i = 0; i < total; i += 1) {
		const lineValue = valueAt(line, i);
		const signalValue = valueAt(signalLine, i);
		if (lineValue !== null && signalValue !== null) {
			histogram[i] = lineValue - signalValue;
		}
	}
	return { macd: line, signal: signalLine, histogram };
}

function alignDense(
	dense: readonly (number | null)[],
	offset: number,
	total: number
): OutputSeries {
	const out = nullSeries(total);
	for (let j = 0; j < dense.length; j += 1) {
		out[offset + j] = valueAt(dense, j);
	}
	return out;
}

export interface BollingerSeries {
	upper: OutputSeries;
	middle: OutputSeries;
	lower: OutputSeries;
}

// Population standard deviation over the same window as the middle band. The
// sample form would widen the bands by sqrt(n / (n - 1)) and disagree with the
// charting packages a user is likely to compare against.
export function bollingerBands(
	closes: readonly number[],
	length: number,
	standardDeviations: number
): BollingerSeries {
	const middle = simpleMovingAverage(closes, length);
	const upper = nullSeries(closes.length);
	const lower = nullSeries(closes.length);
	for (let i = length - 1; i < closes.length; i += 1) {
		const mean = valueAt(middle, i) as number;
		let squared = 0;
		for (let j = i - length + 1; j <= i; j += 1) {
			const deviation = at(closes, j) - mean;
			squared += deviation * deviation;
		}
		const spread = Math.sqrt(squared / length) * standardDeviations;
		upper[i] = mean + spread;
		lower[i] = mean - spread;
	}
	return { upper, middle, lower };
}

export type VwapAnchor = 'session' | 'week' | 'month';

const MILLISECONDS_PER_DAY = 86_400_000;

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

// Null for a timestamp that cannot be parsed -- the caller rejects the bar
// rather than silently lumping it into whichever span it happens to follow.
export function vwapAnchorKey(time: string, anchor: VwapAnchor): string | null {
	const parsed = Date.parse(time);
	if (Number.isNaN(parsed)) {
		return null;
	}
	const date = new Date(parsed);
	const year = date.getUTCFullYear();
	const month = pad(date.getUTCMonth() + 1);
	if (anchor === 'month') {
		return `${year}-${month}`;
	}
	if (anchor === 'week') {
		// Keyed by the Monday the bar's week starts on, which stays unambiguous
		// across a year boundary in a way an ISO week number does not.
		const mondayOffset = (date.getUTCDay() + 6) % 7;
		const monday = new Date(parsed - mondayOffset * MILLISECONDS_PER_DAY);
		return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
	}
	return `${year}-${month}-${pad(date.getUTCDate())}`;
}

// Accumulates the typical price weighted by volume and restarts whenever the
// anchor key changes, so no value ever mixes two sessions.
export function volumeWeightedAveragePrice(
	highs: readonly number[],
	lows: readonly number[],
	closes: readonly number[],
	volumes: readonly number[],
	anchorKeys: readonly string[]
): OutputSeries {
	const out = nullSeries(closes.length);
	let currentKey: string | null = null;
	let cumulativeWeighted = 0;
	let cumulativeVolume = 0;
	for (let i = 0; i < closes.length; i += 1) {
		const key = anchorKeys[i] ?? '';
		if (key !== currentKey) {
			currentKey = key;
			cumulativeWeighted = 0;
			cumulativeVolume = 0;
		}
		const typicalPrice = (at(highs, i) + at(lows, i) + at(closes, i)) / 3;
		cumulativeWeighted += typicalPrice * at(volumes, i);
		cumulativeVolume += at(volumes, i);
		// A span that has traded no volume has no volume-weighted price.
		out[i] = cumulativeVolume === 0 ? null : cumulativeWeighted / cumulativeVolume;
	}
	return out;
}
