import { describe, expect, it } from 'vitest';
import type { OhlcvBar } from '../domain/seriesPort';
import {
	barsForCandleType,
	buildPricePane,
	candleMarks,
	closeAreaPath,
	createPriceScale,
	createTimeScale,
	effectivePriceScale,
	heikinAshiBars,
	markStyleFor,
	priceAxisTicks,
	priceExtentValues,
	seriesPath,
	timeAxisTickIndices
} from './chartScales';

const HEIGHT = 100;
const WIDTH = 200;

function bar(time: string, open: number, high: number, low: number, close: number): OhlcvBar {
	return { time, open, high, low, close, volume: 1_000 };
}

const BARS: OhlcvBar[] = [
	bar('2026-01-02', 100, 110, 95, 105),
	bar('2026-01-03', 105, 115, 100, 102),
	bar('2026-01-04', 102, 120, 101, 118)
];

describe('createPriceScale', () => {
	it('maps the lowest price to the bottom edge and the highest to the top', () => {
		const scale = createPriceScale([10, 20], HEIGHT, 'linear');
		expect(scale.y(10)).toBe(HEIGHT);
		expect(scale.y(20)).toBe(0);
	});

	it('places the midpoint halfway up a linear scale', () => {
		const scale = createPriceScale([10, 20], HEIGHT, 'linear');
		expect(scale.y(15)).toBe(HEIGHT / 2);
	});

	it('places the geometric mean halfway up a logarithmic scale', () => {
		const scale = createPriceScale([10, 1_000], HEIGHT, 'logarithmic');
		// sqrt(10 * 1000) = 100: the log midpoint, not the arithmetic 505.
		expect(scale.y(100)).toBeCloseTo(HEIGHT / 2, 6);
		expect(scale.y(505)).toBeLessThan(HEIGHT / 2);
	});

	it('inverts back to the price a y coordinate stands for on both scales', () => {
		const linear = createPriceScale([10, 20], HEIGHT, 'linear');
		const log = createPriceScale([10, 1_000], HEIGHT, 'logarithmic');
		expect(linear.priceAt(linear.y(17.5))).toBeCloseTo(17.5, 6);
		expect(log.priceAt(log.y(250))).toBeCloseTo(250, 6);
	});

	it('falls back to linear when a price is not positive, and says so', () => {
		const scale = createPriceScale([0, 50], HEIGHT, 'logarithmic');
		expect(scale.kind).toBe('linear');
		expect(scale.y(25)).toBe(HEIGHT / 2);
	});

	it('reports the requested scale as usable only for positive prices', () => {
		expect(effectivePriceScale('logarithmic', [1, 2])).toBe('logarithmic');
		expect(effectivePriceScale('logarithmic', [-1, 2])).toBe('linear');
		expect(effectivePriceScale('linear', [1, 2])).toBe('linear');
	});

	it('does not divide by zero when every price is the same', () => {
		const scale = createPriceScale([42, 42], HEIGHT, 'linear');
		expect(Number.isFinite(scale.y(42))).toBe(true);
	});
});

describe('createTimeScale', () => {
	it('spreads the bars from the left edge to the right edge', () => {
		const time = createTimeScale(
			BARS.map((b) => b.time),
			WIDTH
		);
		expect(time.x(0)).toBe(0);
		expect(time.x(2)).toBe(WIDTH);
		expect(time.x(1)).toBe(WIDTH / 2);
	});

	it('finds the bar nearest a timestamp that falls between two bars', () => {
		const time = createTimeScale(
			BARS.map((b) => b.time),
			WIDTH
		);
		expect(time.indexOfTime('2026-01-03T10:00:00Z')).toBe(1);
		expect(time.indexOfTime('2026-01-03T20:00:00Z')).toBe(2);
	});

	it('clamps an anchor outside the window to the nearest edge bar', () => {
		const time = createTimeScale(
			BARS.map((b) => b.time),
			WIDTH
		);
		expect(time.indexOfTime('2020-01-01')).toBe(0);
		expect(time.indexOfTime('2030-01-01')).toBe(2);
	});

	it('maps a pointer position back to the nearest bar index', () => {
		const time = createTimeScale(
			BARS.map((b) => b.time),
			WIDTH
		);
		expect(time.indexAt(0)).toBe(0);
		expect(time.indexAt(WIDTH)).toBe(2);
		expect(time.indexAt(WIDTH * 10)).toBe(2);
	});
});

describe('axis ticks', () => {
	it('spaces linear ticks arithmetically', () => {
		const scale = createPriceScale([0, 100], HEIGHT, 'linear');
		expect(priceAxisTicks(scale, 5)).toEqual([0, 25, 50, 75, 100]);
	});

	it('spaces logarithmic ticks geometrically', () => {
		const scale = createPriceScale([1, 10_000], HEIGHT, 'logarithmic');
		const ticks = priceAxisTicks(scale, 5).map((tick) => Math.round(tick));
		expect(ticks).toEqual([1, 10, 100, 1_000, 10_000]);
	});

	it('collapses to one tick when the range is flat', () => {
		const scale = createPriceScale([7, 7], HEIGHT, 'linear');
		expect(priceAxisTicks(scale, 5)).toEqual([7]);
	});

	it('picks evenly spaced bar indices including both ends', () => {
		expect(timeAxisTickIndices(9, 5)).toEqual([0, 2, 4, 6, 8]);
		expect(timeAxisTickIndices(1, 5)).toEqual([0]);
		expect(timeAxisTickIndices(0, 5)).toEqual([]);
	});

	it('never labels the same bar twice when there are fewer bars than ticks', () => {
		const ticks = timeAxisTickIndices(3, 5);
		expect(ticks).toEqual([0, 1, 2]);
		expect(new Set(ticks).size).toBe(ticks.length);
	});
});

describe('heikinAshiBars', () => {
	it('smooths the close to the average of the raw bar', () => {
		const [first] = heikinAshiBars([bar('2026-01-02', 100, 110, 90, 104)]);
		expect(first?.close).toBe((100 + 110 + 90 + 104) / 4);
	});

	it('opens each bar at the midpoint of the previous smoothed bar', () => {
		const smoothed = heikinAshiBars(BARS);
		const previous = smoothed[0]!;
		expect(smoothed[1]?.open).toBe((previous.open + previous.close) / 2);
	});

	it('never lets the smoothed high fall below the smoothed body', () => {
		for (const smoothed of heikinAshiBars(BARS)) {
			expect(smoothed.high).toBeGreaterThanOrEqual(Math.max(smoothed.open, smoothed.close));
			expect(smoothed.low).toBeLessThanOrEqual(Math.min(smoothed.open, smoothed.close));
		}
	});

	it('carries time and volume through untouched', () => {
		const smoothed = heikinAshiBars(BARS);
		expect(smoothed.map((b) => b.time)).toEqual(BARS.map((b) => b.time));
		expect(smoothed.map((b) => b.volume)).toEqual(BARS.map((b) => b.volume));
	});
});

describe('mark styles', () => {
	it('maps each supported candle type to the mark it draws', () => {
		expect(markStyleFor('candlestick')).toBe('candle');
		expect(markStyleFor('hollow_candle')).toBe('candle');
		expect(markStyleFor('heikin_ashi')).toBe('candle');
		expect(markStyleFor('ohlc_bar')).toBe('bar');
		expect(markStyleFor('line')).toBe('line');
		expect(markStyleFor('area')).toBe('area');
	});

	it('scales a line chart to its closes, not to highs it never draws', () => {
		expect(priceExtentValues(BARS, 'line')).toEqual([105, 102, 118]);
		expect(priceExtentValues(BARS, 'candle')).toEqual([110, 95, 115, 100, 120, 101]);
	});

	it('marks an up bar, a down bar and an unchanged bar by direction', () => {
		const flat = bar('2026-01-05', 50, 55, 45, 50);
		const time = createTimeScale(
			[...BARS, flat].map((b) => b.time),
			WIDTH
		);
		const price = createPriceScale([45, 120], HEIGHT, 'linear');
		const marks = candleMarks([...BARS, flat], time, price, WIDTH);
		expect(marks.map((m) => m.direction)).toEqual(['up', 'down', 'up', 'flat']);
	});

	it('gives a lone candle a visible width instead of a zero-width body', () => {
		const time = createTimeScale(['2026-01-02'], WIDTH);
		const price = createPriceScale([95, 110], HEIGHT, 'linear');
		const [mark] = candleMarks([BARS[0]!], time, price, WIDTH);
		expect(mark!.halfWidth).toBeGreaterThan(0);
	});
});

describe('seriesPath', () => {
	it('breaks the line at a warm-up hole rather than bridging it', () => {
		const time = createTimeScale(
			BARS.map((b) => b.time),
			WIDTH
		);
		const price = createPriceScale([0, 100], HEIGHT, 'linear');
		const path = seriesPath([10, null, 30], time, price);
		expect(path.match(/M/g)).toHaveLength(2);
		expect(path.match(/L/g)).toBeNull();
	});

	it('draws one continuous run when no value is missing', () => {
		const time = createTimeScale(
			BARS.map((b) => b.time),
			WIDTH
		);
		const price = createPriceScale([0, 100], HEIGHT, 'linear');
		const path = seriesPath([10, 20, 30], time, price);
		expect(path.match(/M/g)).toHaveLength(1);
		expect(path.match(/L/g)).toHaveLength(2);
	});

	it('is empty when there is nothing to draw', () => {
		const time = createTimeScale([], WIDTH);
		const price = createPriceScale([], HEIGHT, 'linear');
		expect(seriesPath([], time, price)).toBe('');
		expect(closeAreaPath([], time, price, HEIGHT)).toBe('');
	});

	it('closes the area path down to the bottom edge', () => {
		const time = createTimeScale(
			BARS.map((b) => b.time),
			WIDTH
		);
		const price = createPriceScale([95, 120], HEIGHT, 'linear');
		expect(closeAreaPath(BARS, time, price, HEIGHT)).toContain(`,${HEIGHT} L0.0,${HEIGHT} Z`);
	});
});

describe('buildPricePane', () => {
	it('draws candle marks and no line path for a candlestick chart', () => {
		const pane = buildPricePane({
			bars: BARS,
			candleType: 'candlestick',
			scale: 'linear',
			width: WIDTH,
			height: HEIGHT
		});
		expect(pane.marks).toHaveLength(3);
		expect(pane.linePath).toBe('');
		expect(pane.hollow).toBe(false);
	});

	it('draws a line and an area path for an area chart and no marks', () => {
		const pane = buildPricePane({
			bars: BARS,
			candleType: 'area',
			scale: 'linear',
			width: WIDTH,
			height: HEIGHT
		});
		expect(pane.marks).toEqual([]);
		expect(pane.linePath).not.toBe('');
		expect(pane.areaPath).not.toBe('');
	});

	it('flags a hollow candle chart without changing its geometry', () => {
		const solid = buildPricePane({
			bars: BARS,
			candleType: 'candlestick',
			scale: 'linear',
			width: WIDTH,
			height: HEIGHT
		});
		const hollow = buildPricePane({
			bars: BARS,
			candleType: 'hollow_candle',
			scale: 'linear',
			width: WIDTH,
			height: HEIGHT
		});
		expect(hollow.hollow).toBe(true);
		expect(hollow.marks).toEqual(solid.marks);
	});

	it('smooths the bars a heikin-ashi chart draws and leaves every other type alone', () => {
		expect(barsForCandleType(BARS, 'heikin_ashi')).toEqual(heikinAshiBars(BARS));
		expect(barsForCandleType(BARS, 'heikin_ashi')[0]?.close).not.toBe(BARS[0]?.close);
		expect(barsForCandleType(BARS, 'candlestick')).toEqual(BARS);
	});

	it('keeps a price drawn above every bar on the scale', () => {
		const pane = buildPricePane({
			bars: BARS,
			candleType: 'candlestick',
			scale: 'linear',
			width: WIDTH,
			height: HEIGHT,
			extraPrices: [500]
		});
		expect(pane.price.max).toBe(500);
		expect(pane.price.y(500)).toBe(0);
	});

	it('honours a logarithmic configuration when every price is positive', () => {
		const pane = buildPricePane({
			bars: BARS,
			candleType: 'candlestick',
			scale: 'logarithmic',
			width: WIDTH,
			height: HEIGHT
		});
		expect(pane.price.kind).toBe('logarithmic');
	});
});
