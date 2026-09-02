// Reference values were produced from the published definitions independently
// of this implementation and are checked in as literals. The ones that are
// hand-checkable are re-derived in the comments below; the recursive ones
// (Wilder smoothing, EMA seeding) come from a separate reference
// implementation run over the same fixture.
//
// Tolerance: 8 decimal places -- far tighter than the 10-decimal rounding of
// the checked-in literals, and far looser than accumulated double-precision
// drift over a 33-bar series.
//
// Each expectation states its warm-up length separately from its values, so
// the count of leading absences is asserted rather than buried in an array.

import { describe, expect, it } from 'vitest';
import {
	averageTrueRange,
	bollingerBands,
	exponentialMovingAverage,
	macd,
	relativeStrengthIndex,
	simpleMovingAverage,
	trueRanges,
	volumeWeightedAveragePrice,
	vwapAnchorKey,
	type OutputSeries
} from './calculators';
import { REFERENCE_CLOSES, REFERENCE_HIGHS, REFERENCE_LOWS, VWAP_BARS } from './testSupport';

const TOLERANCE_PLACES = 8;

const CLOSES = REFERENCE_CLOSES;
const HIGHS = REFERENCE_HIGHS;
const LOWS = REFERENCE_LOWS;

function expectSeries(
	actual: OutputSeries,
	warmupBars: number,
	values: readonly number[],
	label: string
) {
	expect(actual.length, `${label} must carry one entry per input value`).toBe(
		warmupBars + values.length
	);
	for (let i = 0; i < warmupBars; i += 1) {
		expect(actual[i], `${label}[${i}] is warm-up and must be an explicit absence`).toBeNull();
	}
	for (let i = 0; i < values.length; i += 1) {
		const index = warmupBars + i;
		expect(actual[index], `${label}[${index}] must have a value`).not.toBeNull();
		expect(actual[index] as number, `${label}[${index}]`).toBeCloseTo(
			values[i] as number,
			TOLERANCE_PLACES
		);
	}
}

describe('simpleMovingAverage', () => {
	// (44.34 + 44.09 + 44.15 + 43.61 + 44.33) / 5 = 220.52 / 5 = 44.104
	it('matches the hand-computed mean at the first fully formed window', () => {
		const out = simpleMovingAverage(CLOSES, 5);
		expect(out[4] as number, 'mean of the first five closes').toBeCloseTo(44.104, 10);
	});

	it('matches reference values across the whole series', () => {
		expectSeries(
			simpleMovingAverage(CLOSES, 5),
			4,
			[
				44.104, 44.202, 44.404, 44.658, 45.104, 45.454, 45.666, 45.852, 45.89, 45.978, 46.018,
				46.04, 46.04, 46.2, 46.188, 46.06, 46.102, 46.146, 46.006, 46.052, 46.08, 45.908, 45.464,
				45.158, 44.712, 44.47, 44.084, 43.81, 43.6
			],
			'sma(5)'
		);
	});

	it('leaves length - 1 leading bars absent rather than shortening the series', () => {
		const out = simpleMovingAverage(CLOSES, 10);
		expect(
			out.slice(0, 9).every((v) => v === null),
			'nine leading absences'
		).toBe(true);
		expect(out[9], 'the tenth bar is the first with a value').not.toBeNull();
	});

	it('produces an all-absent series when the window is longer than the input', () => {
		const out = simpleMovingAverage([1, 2, 3], 5);
		expect(out, 'every bar absent, still one entry per bar').toEqual([null, null, null]);
	});
});

describe('exponentialMovingAverage', () => {
	// Seed = SMA(5) = 44.104. Next: (44.83 - 44.104) * 2/6 + 44.104 = 44.346
	it('seeds on the simple mean and advances by the 2/(n+1) weight', () => {
		const out = exponentialMovingAverage(CLOSES, 5);
		expect(out[4] as number, 'seed is the simple mean of the first five').toBeCloseTo(44.104, 10);
		expect(out[5] as number, 'one hand-computed step past the seed').toBeCloseTo(44.346, 10);
	});

	it('matches reference values across the whole series', () => {
		expectSeries(
			exponentialMovingAverage(CLOSES, 5),
			4,
			[
				44.104, 44.346, 44.5973333333, 44.8715555556, 45.1943703704, 45.4895802469, 45.6230534979,
				45.758702332, 45.709134888, 45.8994232586, 46.0262821724, 46.0175214483, 46.0216809655,
				46.1511206437, 46.1740804291, 45.9960536194, 46.0673690796, 46.1282460531, 45.988830702,
				46.1425538014, 46.0217025342, 45.7978016895, 45.2085344597, 44.8656896398, 44.6504597599,
				44.6236398399, 44.2224265599, 43.7016177066, 43.5110784711
			],
			'ema(5)'
		);
	});
});

describe('trueRanges', () => {
	it('has no value on the first bar, which has no previous close', () => {
		expect(trueRanges(HIGHS, LOWS, CLOSES)[0], 'bar 0 true range').toBeNull();
	});

	// Bar 1: high 44.24, low 43.94, previous close 44.34.
	// max(0.30, |44.24 - 44.34| = 0.10, |43.94 - 44.34| = 0.40) = 0.40
	it('takes the gap against the previous close when it exceeds the bar range', () => {
		expect(trueRanges(HIGHS, LOWS, CLOSES)[1] as number, 'downward gap dominates').toBeCloseTo(
			0.4,
			10
		);
	});

	// Bar 4: high 44.48, low 44.18, previous close 43.61.
	// max(0.30, |44.48 - 43.61| = 0.87, |44.18 - 43.61| = 0.57) = 0.87
	it('takes the upward gap when the market opens above the previous close', () => {
		expect(trueRanges(HIGHS, LOWS, CLOSES)[4] as number, 'upward gap dominates').toBeCloseTo(
			0.87,
			10
		);
	});
});

describe('averageTrueRange', () => {
	it('matches reference values, first defined at bar `length`', () => {
		expectSeries(
			averageTrueRange(HIGHS, LOWS, CLOSES, 14),
			14,
			[
				0.5064285714, 0.5009693878, 0.4866144315, 0.4897134007, 0.4790195863, 0.4969467587,
				0.5128791331, 0.4976734807, 0.5114110893, 0.5384531543, 0.5585636433, 0.5600948116,
				0.6250880394, 0.6018674651, 0.5803055033, 0.574569396, 0.6263858677, 0.64664402,
				0.6447408757
			],
			'atr(14)'
		);
	});

	it('is all absent when the series is one bar short of the warm-up', () => {
		const out = averageTrueRange(HIGHS.slice(0, 14), LOWS.slice(0, 14), CLOSES.slice(0, 14), 14);
		expect(
			out.every((v) => v === null),
			'14 bars give only 13 true ranges'
		).toBe(true);
	});
});

describe('relativeStrengthIndex', () => {
	// Gains over the first 14 changes sum to 3.34, losses to 1.40.
	// RS = (3.34 / 14) / (1.40 / 14) = 2.3857142857; RSI = 100 - 100 / (1 + RS)
	it('matches the hand-computed first value', () => {
		const out = relativeStrengthIndex(CLOSES, 14);
		expect(out[14] as number, 'first Wilder RSI').toBeCloseTo(70.46413502109705, 8);
	});

	it('matches reference values across the whole series', () => {
		expectSeries(
			relativeStrengthIndex(CLOSES, 14),
			14,
			[
				70.4641350211, 66.2496185536, 66.4809418347, 69.3468531629, 66.2947126589, 57.9150206701,
				62.88071831, 63.2087887183, 56.0115847895, 62.3399293109, 54.6709713777, 50.3868151951,
				40.0194237913, 41.4926354042, 41.9024296785, 45.4994972387, 37.3227783134, 33.0904825727,
				37.7887719821
			],
			'rsi(14)'
		);
	});

	it('reports 100 for a window with no losing bar rather than dividing by zero', () => {
		const out = relativeStrengthIndex([1, 2, 3, 4, 5], 2);
		expect(out[2] as number, 'a pure uptrend').toBe(100);
	});

	it('stays within 0 and 100 for every defined value', () => {
		const values = relativeStrengthIndex(CLOSES, 14).filter((v): v is number => v !== null);
		expect(values.length, 'the series has defined values to check').toBeGreaterThan(0);
		expect(
			values.every((v) => v >= 0 && v <= 100),
			'RSI is bounded by definition'
		).toBe(true);
	});
});

describe('macd', () => {
	const series = macd(CLOSES, 3, 6, 4);

	// EMA(6) seeds at bar 5 (265.35 / 6 = 44.225); EMA(3) at bar 5 is
	// 44.4729166667, so the first MACD value is 0.2479166667.
	it('matches the hand-computed first line value', () => {
		expect(series.macd[5] as number, 'fast EMA minus slow EMA').toBeCloseTo(0.2479166667, 9);
	});

	it('matches reference values for the line', () => {
		expectSeries(
			series.macd,
			5,
			[
				0.2479166667, 0.3114583333, 0.3582291667, 0.4137574405, 0.4259093325, 0.3286908178,
				0.2770140886, 0.1289846727, 0.2012620709, 0.198323703, 0.1089423283, 0.0678857904,
				0.1249533426, 0.086769848, -0.0635485212, 0.0139875642, 0.0482522284, -0.0621178527,
				0.0659096687, -0.041353312, -0.1658967606, -0.4695341693, -0.4787569339, -0.4050855021,
				-0.2459049191, -0.4003540081, -0.5611781102, -0.4377327023
			],
			'macd line'
		);
	});

	it('matches reference values for the signal line', () => {
		expectSeries(
			series.signal,
			8,
			[
				0.3328404018, 0.3700679741, 0.3535171116, 0.3229159024, 0.2453434105, 0.2277108747,
				0.215956006, 0.1731505349, 0.1310446371, 0.1286081193, 0.1118728108, 0.041704278,
				0.0306175925, 0.0376714468, -0.002244273, 0.0250173037, -0.0015309426, -0.0672772698,
				-0.2281800296, -0.3284107913, -0.3590806756, -0.313810373, -0.348427827, -0.4335279403,
				-0.4352098451
			],
			'signal line'
		);
	});

	it('matches reference values for the histogram', () => {
		expectSeries(
			series.histogram,
			8,
			[
				0.0809170387, 0.0558413584, -0.0248262937, -0.0459018138, -0.1163587378, -0.0264488038,
				-0.017632303, -0.0642082066, -0.0631588467, -0.0036547767, -0.0251029628, -0.1052527992,
				-0.0166300283, 0.0105807816, -0.0598735797, 0.040892365, -0.0398223694, -0.0986194908,
				-0.2413541397, -0.1503461426, -0.0460048265, 0.0679054539, -0.0519261811, -0.1276501699,
				-0.0025228572
			],
			'histogram'
		);
	});

	it('starts the signal line later than the line it smooths', () => {
		expect(series.macd[5], 'the line is defined at bar slow - 1').not.toBeNull();
		expect(series.signal[5], 'the signal has no input to smooth yet').toBeNull();
		expect(series.signal[8], 'the signal is defined at bar slow + signal - 2').not.toBeNull();
	});

	it('emits an all-absent signal when the line is too short to smooth', () => {
		const short = macd(CLOSES.slice(0, 8), 3, 6, 4);
		expect(short.macd.filter((v) => v !== null).length, 'three line values exist').toBe(3);
		expect(
			short.signal.every((v) => v === null),
			'four are needed to seed the signal'
		).toBe(true);
		expect(
			short.histogram.every((v) => v === null),
			'no signal means no histogram'
		).toBe(true);
	});
});

describe('bollingerBands', () => {
	const bands = bollingerBands(CLOSES, 5, 2);

	// Window [44.34, 44.09, 44.15, 43.61, 44.33], mean 44.104.
	// Population variance 0.35312 / 5 = 0.070624, sd 0.2657518...,
	// so the bands sit 0.5315036... either side of the mean.
	it('matches hand-computed bands at the first fully formed window', () => {
		expect(bands.middle[4] as number, 'middle band is the simple mean').toBeCloseTo(44.104, 10);
		expect(bands.upper[4] as number, 'mean + 2 population sd').toBeCloseTo(44.6355035277, 9);
		expect(bands.lower[4] as number, 'mean - 2 population sd').toBeCloseTo(43.5724964723, 9);
	});

	it('matches reference values for the upper band', () => {
		expectSeries(
			bands.upper,
			4,
			[
				44.6355035277, 44.9901522696, 45.4494931851, 45.9265361642, 46.1299512659, 46.3734433098,
				46.3774604697, 46.3183732411, 46.2205752562, 46.4229539302, 46.5241857367, 46.5313654445,
				46.5313654445, 46.5172380809, 46.4966486676, 46.5730302135, 46.6228301067, 46.6722090839,
				46.5489696124, 46.6902977362, 46.6524334022, 46.6967610538, 47.064479928, 47.0174364738,
				46.136887364, 45.4185146282, 44.8364466759, 45.1832297696, 45.0034813857
			],
			'upper band'
		);
	});

	it('matches reference values for the lower band', () => {
		expectSeries(
			bands.lower,
			4,
			[
				43.5724964723, 43.4138477304, 43.3585068149, 43.3894638358, 44.0780487341, 44.5345566902,
				44.9545395303, 45.3856267589, 45.5594247438, 45.5330460698, 45.5118142633, 45.5486345555,
				45.5486345555, 45.8827619191, 45.8793513324, 45.5469697865, 45.5811698933, 45.6197909161,
				45.4630303876, 45.4137022638, 45.5075665978, 45.1192389462, 43.863520072, 43.2985635262,
				43.287112636, 43.5214853718, 43.3315533241, 42.4367702304, 42.1965186143
			],
			'lower band'
		);
	});

	it('draws its middle band as the simple moving average of the same window', () => {
		expect(bands.middle, 'middle band is the SMA').toEqual(simpleMovingAverage(CLOSES, 5));
	});

	it('collapses the bands onto the mean when the window has no variance', () => {
		const flat = bollingerBands([5, 5, 5, 5], 4, 2);
		expect(flat.upper[3] as number, 'zero standard deviation').toBe(5);
		expect(flat.lower[3] as number, 'zero standard deviation').toBe(5);
	});
});

describe('vwapAnchorKey', () => {
	it('keys a session by calendar day', () => {
		expect(vwapAnchorKey('2026-01-05T14:30:00Z', 'session')).toBe('2026-01-05');
		expect(vwapAnchorKey('2026-01-05T21:00:00Z', 'session')).toBe('2026-01-05');
	});

	it('keys a week by the Monday it starts on, across a year boundary', () => {
		expect(vwapAnchorKey('2026-01-04T14:30:00Z', 'week'), 'Sunday belongs to the prior week').toBe(
			'2025-12-29'
		);
		expect(vwapAnchorKey('2026-01-05T14:30:00Z', 'week'), 'Monday starts its own week').toBe(
			'2026-01-05'
		);
	});

	it('keys a month by year and month', () => {
		expect(vwapAnchorKey('2026-01-31T14:30:00Z', 'month')).toBe('2026-01');
		expect(vwapAnchorKey('2026-02-01T14:30:00Z', 'month')).toBe('2026-02');
	});

	it('reports an unparseable timestamp rather than guessing a span', () => {
		expect(vwapAnchorKey('not a date', 'session'), 'no span can be derived').toBeNull();
	});
});

describe('volumeWeightedAveragePrice', () => {
	const highs = VWAP_BARS.map((b) => b.high);
	const lows = VWAP_BARS.map((b) => b.low);
	const closes = VWAP_BARS.map((b) => b.close);
	const volumes = VWAP_BARS.map((b) => b.volume);

	function forAnchor(anchor: 'session' | 'week' | 'month'): OutputSeries {
		const keys = VWAP_BARS.map((bar) => vwapAnchorKey(bar.time, anchor) as string);
		return volumeWeightedAveragePrice(highs, lows, closes, volumes, keys);
	}

	// Day 1: 10, then (10 * 100 + 12 * 100) / 200 = 11.
	// Day 2 restarts: 20, then (20 * 100 + 30 * 300) / 400 = 27.5.
	it('restarts on the session boundary instead of accumulating across it', () => {
		expectSeries(forAnchor('session'), 0, [10, 11, 20, 27.5], 'session vwap');
	});

	// The same bars anchored monthly never reset:
	// 10, 11, 4200 / 300 = 14, 13200 / 600 = 22.
	it('accumulates across days when the anchor is the month', () => {
		expectSeries(forAnchor('month'), 0, [10, 11, 14, 22], 'month vwap');
	});

	// Typical price is (high + low + close) / 3 = (12 + 6 + 9) / 3 = 9.
	it('weights the typical price, not the close', () => {
		const out = volumeWeightedAveragePrice([12], [6], [9], [100], ['d']);
		expect(out[0] as number, 'mean of high, low and close').toBe(9);
	});

	it('reports an absence for a span that has traded no volume', () => {
		const out = volumeWeightedAveragePrice([10, 10], [10, 10], [10, 10], [0, 5], ['d', 'd']);
		expect(out[0], 'no volume yet, so no volume-weighted price').toBeNull();
		expect(out[1] as number, 'the span becomes defined once volume arrives').toBe(10);
	});
});
