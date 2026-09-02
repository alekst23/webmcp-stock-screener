// Pure geometry for the chart panel: price and time scales, axis ticks, and
// the marks each candle type draws.
//
// The technique here is the one `src/lib/workspace/visualization.ts` uses --
// value-space to viewBox-space closures, evenly spaced ticks, path strings
// built once -- duplicated rather than shared. That module is typed against
// the shipping surface's own bar shape and serves the surface EPIC-1015
// retires; this one works on `OhlcvBar`, adds a logarithmic price scale, and
// derives per-bar candle geometry. Duplication is the deliberate cost of
// letting the old surface keep working untouched.
//
// Everything below is a pure function of its arguments: no DOM, no state.
import type { ChartCandleType, ChartScale } from '../domain/chartState';
import type { OhlcvBar } from '../domain/seriesPort';

export interface PriceScale {
	kind: ChartScale;
	min: number;
	max: number;
	// Price -> SVG y coordinate (viewBox space, top-down).
	y(price: number): number;
	// The inverse, for reading a pointer position back as a price.
	priceAt(y: number): number;
}

export interface TimeScale {
	barCount: number;
	// Bar index -> SVG x coordinate (viewBox space).
	x(index: number): number;
	indexAt(viewBoxX: number): number;
	// The index of the bar nearest a timestamp. Clamped, so an annotation
	// anchored just outside the window still draws at the edge it belongs to
	// rather than vanishing.
	indexOfTime(time: string): number;
}

export type PriceMarkStyle = 'candle' | 'bar' | 'line' | 'area';

export interface CandleMark {
	index: number;
	x: number;
	openY: number;
	highY: number;
	lowY: number;
	closeY: number;
	halfWidth: number;
	direction: 'up' | 'down' | 'flat';
}

export interface PricePane {
	// After any candle-type transform, so `heikin_ashi` marks are the smoothed
	// bars rather than the raw ones they were computed from.
	bars: OhlcvBar[];
	style: PriceMarkStyle;
	// Up bars drawn as an outline rather than a solid body.
	hollow: boolean;
	time: TimeScale;
	price: PriceScale;
	marks: CandleMark[];
	linePath: string;
	areaPath: string;
}

// A logarithmic price axis is only defined for positive prices. Rather than
// dropping the non-positive bars or shifting the whole series by an offset
// nobody asked for, the scale reports linear: the panel then says which scale
// it actually drew on, which is the honest answer.
export function effectivePriceScale(kind: ChartScale, values: readonly number[]): ChartScale {
	if (kind !== 'logarithmic') {
		return 'linear';
	}
	return values.every((value) => value > 0) ? 'logarithmic' : 'linear';
}

function finite(values: readonly (number | null | undefined)[]): number[] {
	return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

export function createPriceScale(
	values: readonly number[],
	height: number,
	kind: ChartScale
): PriceScale {
	const usable = finite(values);
	const effective = effectivePriceScale(kind, usable);
	const min = usable.length > 0 ? Math.min(...usable) : 0;
	const max = usable.length > 0 ? Math.max(...usable) : 0;
	const project = effective === 'logarithmic' ? Math.log10 : (v: number) => v;
	const lo = project(min);
	const hi = project(max);
	const span = hi - lo || 1;
	return {
		kind: effective,
		min,
		max,
		y: (price) => height - ((project(price) - lo) / span) * height,
		priceAt: (y) => {
			const projected = lo + ((height - y) / height) * span;
			return effective === 'logarithmic' ? 10 ** projected : projected;
		}
	};
}

export function createTimeScale(times: readonly string[], width: number): TimeScale {
	const barCount = times.length;
	const lastIndex = Math.max(1, barCount - 1);
	const stamps = times.map((time) => Date.parse(time));
	const x = (index: number): number => (index / lastIndex) * width;
	return {
		barCount,
		x,
		indexAt: (viewBoxX) => {
			if (barCount === 0) {
				return 0;
			}
			const fraction = Math.min(1, Math.max(0, viewBoxX / width));
			return Math.round(fraction * (barCount - 1));
		},
		indexOfTime: (time) => nearestTimeIndex(stamps, time)
	};
}

function nearestTimeIndex(stamps: readonly number[], time: string): number {
	if (stamps.length === 0) {
		return 0;
	}
	const target = Date.parse(time);
	if (Number.isNaN(target)) {
		return 0;
	}
	let best = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	stamps.forEach((stamp, index) => {
		const distance = Math.abs(stamp - target);
		if (distance < bestDistance) {
			best = index;
			bestDistance = distance;
		}
	});
	return best;
}

// Evenly spaced in the scale's own space, so a logarithmic axis gets
// geometrically spaced tick values and its gridlines land evenly on screen.
export function priceAxisTicks(scale: PriceScale, count: number): number[] {
	if (count <= 1 || scale.min === scale.max) {
		return [scale.max];
	}
	if (scale.kind === 'logarithmic') {
		const lo = Math.log10(scale.min);
		const hi = Math.log10(scale.max);
		return Array.from({ length: count }, (_, i) => 10 ** (lo + ((hi - lo) * i) / (count - 1)));
	}
	return Array.from(
		{ length: count },
		(_, i) => scale.min + ((scale.max - scale.min) * i) / (count - 1)
	);
}

// De-duplicated, because asking for more ticks than there are bars rounds
// several of them onto the same bar -- two labels stacked on one date, and a
// keyed render of them is a hard error rather than a cosmetic one.
export function timeAxisTickIndices(barCount: number, count: number): number[] {
	if (barCount === 0) {
		return [];
	}
	const lastIndex = barCount - 1;
	if (count <= 1 || lastIndex === 0) {
		return [0];
	}
	const indices = Array.from({ length: count }, (_, i) =>
		Math.round((lastIndex * i) / (count - 1))
	);
	return [...new Set(indices)];
}

// Heikin-Ashi is a bar transform, not a different mark: the smoothed bars go
// through exactly the same candle geometry afterwards. Volume and time are
// carried through unchanged -- only the four prices are recomputed.
export function heikinAshiBars(bars: readonly OhlcvBar[]): OhlcvBar[] {
	const out: OhlcvBar[] = [];
	bars.forEach((bar, index) => {
		const close = (bar.open + bar.high + bar.low + bar.close) / 4;
		const previous = out[index - 1];
		const open = previous ? (previous.open + previous.close) / 2 : (bar.open + bar.close) / 2;
		out.push({
			time: bar.time,
			open,
			high: Math.max(bar.high, open, close),
			low: Math.min(bar.low, open, close),
			close,
			volume: bar.volume
		});
	});
	return out;
}

const MARK_STYLES: Record<ChartCandleType, PriceMarkStyle> = {
	candlestick: 'candle',
	hollow_candle: 'candle',
	heikin_ashi: 'candle',
	ohlc_bar: 'bar',
	line: 'line',
	area: 'area'
};

export function markStyleFor(candleType: ChartCandleType): PriceMarkStyle {
	return MARK_STYLES[candleType];
}

// Every price a mark of this style occupies. A line or area chart is drawn from
// closes alone, so scaling it to the highs and lows would leave it hugging the
// middle of a pane that is mostly empty.
export function priceExtentValues(bars: readonly OhlcvBar[], style: PriceMarkStyle): number[] {
	if (style === 'line' || style === 'area') {
		return bars.map((bar) => bar.close);
	}
	return bars.flatMap((bar) => [bar.high, bar.low]);
}

function directionOf(bar: OhlcvBar): CandleMark['direction'] {
	if (bar.close > bar.open) {
		return 'up';
	}
	return bar.close < bar.open ? 'down' : 'flat';
}

export function candleMarks(
	bars: readonly OhlcvBar[],
	time: TimeScale,
	price: PriceScale,
	width: number
): CandleMark[] {
	// A single bar has no spacing to derive a width from, so it gets a fixed
	// share of the pane instead of a zero-width body.
	const spacing = bars.length > 1 ? width / (bars.length - 1) : width / 3;
	const halfWidth = Math.max(0.5, (spacing * 0.6) / 2);
	return bars.map((bar, index) => ({
		index,
		x: time.x(index),
		openY: price.y(bar.open),
		highY: price.y(bar.high),
		lowY: price.y(bar.low),
		closeY: price.y(bar.close),
		halfWidth,
		direction: directionOf(bar)
	}));
}

export function seriesPath(
	values: readonly (number | null)[],
	time: TimeScale,
	price: PriceScale
): string {
	let path = '';
	let penDown = false;
	values.forEach((value, index) => {
		if (value === null || !Number.isFinite(value)) {
			penDown = false;
			return;
		}
		// A gap re-opens with a move, so a warm-up hole is a break in the line
		// rather than a straight segment across values that were never computed.
		path += `${path === '' || !penDown ? 'M' : 'L'}${time.x(index).toFixed(1)},${price
			.y(value)
			.toFixed(1)} `;
		penDown = true;
	});
	return path.trim();
}

export function closeAreaPath(
	bars: readonly OhlcvBar[],
	time: TimeScale,
	price: PriceScale,
	height: number
): string {
	if (bars.length === 0) {
		return '';
	}
	const line = seriesPath(
		bars.map((bar) => bar.close),
		time,
		price
	);
	const lastIndex = bars.length - 1;
	return `${line} L${time.x(lastIndex).toFixed(1)},${height} L${time.x(0).toFixed(1)},${height} Z`;
}

// The bars a candle type actually draws, which for Heikin-Ashi are not the
// bars that were fetched. Separate from `buildPricePane` because everything
// else the pane must stay on-scale with -- a comparison series, an annotation
// anchor -- is computed against the drawn bars and has to be known before the
// scale exists.
export function barsForCandleType(
	bars: readonly OhlcvBar[],
	candleType: ChartCandleType
): OhlcvBar[] {
	return candleType === 'heikin_ashi' ? heikinAshiBars(bars) : bars.map((bar) => ({ ...bar }));
}

export interface PricePaneInput {
	// Already through `barsForCandleType`.
	bars: readonly OhlcvBar[];
	candleType: ChartCandleType;
	scale: ChartScale;
	width: number;
	height: number;
	// Prices that must stay on-scale even though no bar reaches them -- an
	// annotation drawn above the visible high, or a comparison series rebased
	// onto this axis, would otherwise be drawn off the edge of the pane.
	extraPrices?: readonly number[];
}

export function buildPricePane(input: PricePaneInput): PricePane {
	const style = markStyleFor(input.candleType);
	const bars = input.bars.map((bar) => ({ ...bar }));
	const price = createPriceScale(
		[...priceExtentValues(bars, style), ...(input.extraPrices ?? [])],
		input.height,
		input.scale
	);
	const time = createTimeScale(
		bars.map((bar) => bar.time),
		input.width
	);
	return {
		bars,
		style,
		hollow: input.candleType === 'hollow_candle',
		time,
		price,
		marks: style === 'candle' || style === 'bar' ? candleMarks(bars, time, price, input.width) : [],
		linePath:
			style === 'line' || style === 'area'
				? seriesPath(
						bars.map((bar) => bar.close),
						time,
						price
					)
				: '',
		areaPath: style === 'area' ? closeAreaPath(bars, time, price, input.height) : ''
	};
}
