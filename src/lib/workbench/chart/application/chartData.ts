// Reading a bounded slice of a chart: the bars behind the picture, and the
// study values that sit on them, aligned index for index.
//
// Boundedness is the feature, not a guard rail bolted onto it. Three
// independent mechanisms enforce it, and none of them is a truncation:
//
//   1. The bars port cannot express an unbounded request at all -- its window
//      is a required explicit start and end.
//   2. A read may not reach outside the chart's own configured range, so an
//      agent that wants more history has to change the chart, visibly, first.
//   3. A window resolving to more bars than CHART_DATA_BAR_CAP is refused with
//      remedies, never silently shortened, because a caller handed a truncated
//      series has no way to know it was truncated.
//
// There is deliberately no pagination anywhere in this module. See
// `BOUNDEDNESS_NOTE` for why a "next page" would undo all three.
import { builtinCatalogRegistry, type CatalogRegistry } from '../../../catalog/registry';
import type { ResourceId } from '../../domain/ids';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import { toWireProvenance, type MarketDataProvenance } from '../../domain/provenance';
import type { InstrumentRef } from '../domain/instrument';
import {
	readChartStateOrNull,
	type ChartPriceAdjustment,
	type ChartRange,
	type ChartSession,
	type ChartState,
	type ChartTimeframe,
	type RelativeRangeToken
} from '../domain/chartState';
import type {
	ChartSeriesPort,
	ChartSeriesResult,
	ChartSeriesWindow,
	OhlcvBar
} from '../domain/seriesPort';
import { sortStudiesForDisplay, type StudyInstance, type StudyPane } from '../domain/studies';
import { computeStudy, type StudyOutputSeries } from '../domain/studyEngine';

// The one place the number lives. `get_chart_data` interpolates it into its
// own description and every result states it, so an agent never has to
// discover the limit by hitting it, and a change here changes every mention.
// 500 daily bars is about two years, so a year of dailies fits in one call.
export const CHART_DATA_BAR_CAP = 500;

// Travels in every successful result. An agent that goes looking for a way to
// fetch "the rest" should find the reason there isn't one, not silence.
export const BOUNDEDNESS_NOTE =
	'Every call is independently bounded by the caller: there is no continuation ' +
	'cursor, no page token and no offset, because an affordance for fetching "the ' +
	'next page" would let an unbounded series be reassembled by looping. To read a ' +
	'different slice, name a different window.';

export type ChartDataWindowForm = 'visible_range' | 'explicit' | 'last_n_bars' | 'anchored';

export type ChartDataWindowRequest =
	| { form: 'visible_range' }
	| { form: 'explicit'; start: string; end: string }
	| { form: 'last_n_bars'; lastNBars: number }
	| { form: 'anchored'; anchorTime: string; barsBefore: number; barsAfter: number };

export interface ChartDataRequest {
	panelId: ResourceId;
	workspaceId?: ResourceId;
	// Omitted means the chart's currently visible range, and the result says so.
	window?: ChartDataWindowRequest;
	// Strictly coarser than the chart's timeframe; the returned bars are then
	// labelled as aggregated rather than passed off as raw.
	aggregateTo?: ChartTimeframe;
}

export interface ChartDataDeps {
	repository: WorkspaceRepository;
	series: ChartSeriesPort;
	// A relative range token ("6mo") cannot become an explicit window without a
	// notion of now, so the read needs a clock even though it changes nothing.
	clock: Clock;
	registry?: CatalogRegistry;
}

export type ChartDataRefusalReason =
	| 'workspace_not_found'
	| 'chart_panel_not_found'
	| 'chart_not_configured'
	| 'invalid_window'
	| 'window_outside_chart_range'
	| 'window_over_bar_cap'
	| 'invalid_aggregation'
	| 'series_unavailable';

export interface AggregationOption {
	timeframe: ChartTimeframe;
	barCount: number;
}

// Every refusal states what would make the next call succeed. The fields are
// typed rather than a free-form bag so a caller can branch on them.
export interface ChartDataRefusal {
	reason: ChartDataRefusalReason;
	message: string;
	remedies: string[];
	panelId?: ResourceId;
	barCap?: number;
	barsInWindow?: number;
	timeframe?: ChartTimeframe;
	chartRange?: ChartSeriesWindow;
	requestedWindow?: ChartSeriesWindow;
	// Coarser timeframes whose rolled-up bar count actually fits, so the
	// "aggregate instead" remedy names something that will not be refused too.
	fitsWithAggregation?: AggregationOption[];
}

export interface ChartDataStudy {
	studyId: ResourceId;
	catalogItemId: string;
	params: Record<string, unknown>;
	pane: StudyPane;
	// One entry per returned bar, in the same order. Warm-up entries are null.
	outputs: Record<string, StudyOutputSeries>;
	warmupBars: number;
	warnings: string[];
}

export interface ChartDataAggregation {
	from: ChartTimeframe;
	to: ChartTimeframe;
	method: 'ohlcv_rollup';
	sourceBarCount: number;
}

export interface ChartDataWindow {
	start: string;
	end: string;
	form: ChartDataWindowForm;
	isChartVisibleRange: boolean;
	note: string;
}

export interface ChartDataResult {
	panelId: ResourceId;
	instrument: InstrumentRef;
	// The timeframe of the bars actually returned, which differs from
	// `sourceTimeframe` whenever an aggregation was applied.
	timeframe: ChartTimeframe;
	sourceTimeframe: ChartTimeframe;
	session: ChartSession;
	window: ChartDataWindow;
	chartRange: ChartSeriesWindow;
	barCap: number;
	barCount: number;
	bars: OhlcvBar[];
	aggregation: ChartDataAggregation | null;
	studies: ChartDataStudy[];
	priceAdjustment: {
		chartPolicy: ChartPriceAdjustment;
		// Exactly what the bars were computed under. Null when the source states
		// no basis at all -- never defaulted to the requested policy, because a
		// guessed adjustment basis is the misreport provenance exists to prevent.
		applied: ChartPriceAdjustment | null;
	};
	provenance: MarketDataProvenance;
	warnings: string[];
}

export type ChartDataOutcome =
	{ ok: true; data: ChartDataResult } | { ok: false; refusal: ChartDataRefusal };

// Coarsest last. Every boundary nests inside the next one up, which is what
// makes rolling 1m -> 5m -> 1h give the same bars as 1m -> 1h.
export const TIMEFRAME_ORDER: readonly ChartTimeframe[] = [
	'1m',
	'5m',
	'15m',
	'30m',
	'1h',
	'4h',
	'1d',
	'1wk',
	'1mo'
];

// Only used to bucket intraday bars and to order timeframes by coarseness. The
// daily-and-coarser entries are nominal: those bucket by calendar period, not
// by elapsed minutes, because months are not all the same length.
const TIMEFRAME_MINUTES: Record<ChartTimeframe, number> = {
	'1m': 1,
	'5m': 5,
	'15m': 15,
	'30m': 30,
	'1h': 60,
	'4h': 240,
	'1d': 1440,
	'1wk': 10080,
	'1mo': 43200
};

// A bar plus how many source bars were folded into it: 1 for a raw bar. Kept
// alongside the bar so a slice taken after aggregation can still report how
// many raw bars the bars it kept were built from.
interface CountedBar {
	bar: OhlcvBar;
	sources: number;
}

function timeframeRank(timeframe: ChartTimeframe): number {
	return TIMEFRAME_ORDER.indexOf(timeframe);
}

function refuse(refusal: ChartDataRefusal): ChartDataOutcome {
	return { ok: false, refusal };
}

function relativeRangeStart(token: RelativeRangeToken, endMs: number): number {
	const at = new Date(endMs);
	switch (token) {
		case '1d':
			at.setUTCDate(at.getUTCDate() - 1);
			break;
		case '5d':
			at.setUTCDate(at.getUTCDate() - 5);
			break;
		case '1mo':
			at.setUTCMonth(at.getUTCMonth() - 1);
			break;
		case '3mo':
			at.setUTCMonth(at.getUTCMonth() - 3);
			break;
		case '6mo':
			at.setUTCMonth(at.getUTCMonth() - 6);
			break;
		case 'ytd':
			return Date.UTC(at.getUTCFullYear(), 0, 1);
		case '1y':
			at.setUTCFullYear(at.getUTCFullYear() - 1);
			break;
		case '2y':
			at.setUTCFullYear(at.getUTCFullYear() - 2);
			break;
		case '5y':
			at.setUTCFullYear(at.getUTCFullYear() - 5);
			break;
		// "As much as there is" still has to become an explicit window, so it
		// becomes the widest one expressible rather than an absent bound.
		case 'max':
			return 0;
	}
	return at.getTime();
}

// A relative range is only meaningful relative to an instant, so resolution
// happens once here and the explicit result is what every later step and the
// result payload talk about.
export function resolveChartRange(range: ChartRange, now: string): ChartSeriesWindow {
	if (range.kind === 'explicit') {
		return { start: range.start, end: range.end };
	}
	const endMs = Date.parse(now);
	return {
		start: new Date(relativeRangeStart(range.token, endMs)).toISOString(),
		end: new Date(endMs).toISOString()
	};
}

export function bucketKey(time: string, timeframe: ChartTimeframe): string {
	const ms = Date.parse(time);
	if (Number.isNaN(ms)) {
		return time;
	}
	const minutes = TIMEFRAME_MINUTES[timeframe];
	if (minutes < TIMEFRAME_MINUTES['1d']) {
		return String(Math.floor(ms / (minutes * 60_000)));
	}
	const at = new Date(ms);
	if (timeframe === '1d') {
		return at.toISOString().slice(0, 10);
	}
	if (timeframe === '1mo') {
		return at.toISOString().slice(0, 7);
	}
	// The UTC Monday that opens the bar's week, so a week has one key however
	// many sessions it actually held.
	const monday = new Date(ms);
	monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
	return monday.toISOString().slice(0, 10);
}

// The standard OHLCV fold: first open, extreme high and low, last close, summed
// volume, timestamped at the period's first bar. Input must be in ascending
// time order, which is what the bars port guarantees.
function rollUp(list: readonly CountedBar[], timeframe: ChartTimeframe): CountedBar[] {
	const out: CountedBar[] = [];
	let key: string | null = null;
	for (const entry of list) {
		const entryKey = bucketKey(entry.bar.time, timeframe);
		const open = out[out.length - 1];
		if (!open || entryKey !== key) {
			out.push({ bar: { ...entry.bar }, sources: entry.sources });
			key = entryKey;
			continue;
		}
		open.bar.high = Math.max(open.bar.high, entry.bar.high);
		open.bar.low = Math.min(open.bar.low, entry.bar.low);
		open.bar.close = entry.bar.close;
		open.bar.volume += entry.bar.volume;
		open.sources += entry.sources;
	}
	return out;
}

function coarserOptions(list: readonly CountedBar[], from: ChartTimeframe): AggregationOption[] {
	return TIMEFRAME_ORDER.slice(timeframeRank(from) + 1)
		.map((timeframe) => ({ timeframe, barCount: rollUp(list, timeframe).length }))
		.filter((option) => option.barCount > 0 && option.barCount <= CHART_DATA_BAR_CAP);
}

function validateWindowRequest(window: ChartDataWindowRequest): string[] {
	if (window.form === 'explicit') {
		const issues: string[] = [];
		if (Number.isNaN(Date.parse(window.start))) {
			issues.push(`window.start: "${window.start}" is not an ISO 8601 timestamp.`);
		}
		if (Number.isNaN(Date.parse(window.end))) {
			issues.push(`window.end: "${window.end}" is not an ISO 8601 timestamp.`);
		}
		if (issues.length === 0 && Date.parse(window.end) < Date.parse(window.start)) {
			issues.push(`window.end: "${window.end}" precedes window.start "${window.start}".`);
		}
		return issues;
	}
	if (window.form === 'last_n_bars') {
		return Number.isInteger(window.lastNBars) && window.lastNBars >= 1
			? []
			: [`window.last_n_bars: expected a whole number of at least 1, got ${window.lastNBars}.`];
	}
	if (window.form === 'anchored') {
		const issues: string[] = [];
		if (Number.isNaN(Date.parse(window.anchorTime))) {
			issues.push(`window.anchor_time: "${window.anchorTime}" is not an ISO 8601 timestamp.`);
		}
		for (const [name, value] of [
			['bars_before', window.barsBefore],
			['bars_after', window.barsAfter]
		] as const) {
			if (!Number.isInteger(value) || value < 0) {
				issues.push(`window.${name}: expected a whole number of at least 0, got ${value}.`);
			}
		}
		return issues;
	}
	return [];
}

// The only window form that can name times of its own is the explicit one, so
// it is the only one that can reach outside the chart. The count-based forms
// slice bars already inside the chart's range and cannot escape it.
function containmentIssue(
	window: ChartDataWindowRequest,
	range: ChartSeriesWindow
): { at: string; side: 'before' | 'after' } | null {
	const rangeStart = Date.parse(range.start);
	const rangeEnd = Date.parse(range.end);
	const points: string[] =
		window.form === 'explicit'
			? [window.start, window.end]
			: window.form === 'anchored'
				? [window.anchorTime]
				: [];
	for (const point of points) {
		const at = Date.parse(point);
		if (at < rangeStart) {
			return { at: point, side: 'before' };
		}
		if (at > rangeEnd) {
			return { at: point, side: 'after' };
		}
	}
	return null;
}

// Index of the last bar at or before the anchor; 0 when the anchor precedes
// every bar, so an anchor that falls on a market holiday still resolves to the
// nearest real bar instead of an empty slice.
function anchorIndex(bars: readonly CountedBar[], anchorTime: string): number {
	const anchor = Date.parse(anchorTime);
	let index = 0;
	for (let i = 0; i < bars.length; i += 1) {
		if (Date.parse((bars[i] as CountedBar).bar.time) <= anchor) {
			index = i;
		} else {
			break;
		}
	}
	return index;
}

function sliceForWindow(
	bars: readonly CountedBar[],
	window: ChartDataWindowRequest
): { kept: CountedBar[]; warnings: string[] } {
	if (window.form === 'last_n_bars') {
		const kept = bars.slice(Math.max(0, bars.length - window.lastNBars));
		return { kept, warnings: shortfallWarning(window.lastNBars, kept.length) };
	}
	if (window.form === 'anchored') {
		const at = anchorIndex(bars, window.anchorTime);
		const from = Math.max(0, at - window.barsBefore);
		const kept = bars.slice(from, at + window.barsAfter + 1);
		const asked = window.barsBefore + window.barsAfter + 1;
		return { kept, warnings: shortfallWarning(asked, kept.length) };
	}
	return { kept: [...bars], warnings: [] };
}

// Running out of chart is not the truncation the cap refusal exists to
// prevent: nothing was dropped from a window the caller named, the window
// simply reached the edge of what the chart is configured to show.
function shortfallWarning(asked: number, got: number): string[] {
	return got < asked
		? [
				`Asked for ${asked} bars but the chart's configured range holds only ${got} in that ` +
					'position; widen the chart range to see more.'
			]
		: [];
}

function buildStudy(
	study: StudyInstance,
	bars: readonly OhlcvBar[],
	registry: CatalogRegistry
): ChartDataStudy {
	const base = {
		studyId: study.id,
		catalogItemId: study.catalogItemId,
		params: { ...study.params },
		pane: study.pane
	};
	try {
		const computed = computeStudy(bars, study.catalogItemId, study.params, { registry });
		return {
			...base,
			params: { ...computed.params },
			outputs: { ...computed.outputs },
			warmupBars: computed.warmupBars,
			warnings: [...computed.warnings]
		};
	} catch (error) {
		// One study the engine cannot compute must not cost the caller its
		// prices, so it degrades to an empty, explicitly explained entry.
		return {
			...base,
			outputs: {},
			warmupBars: 0,
			warnings: [error instanceof Error ? error.message : String(error)]
		};
	}
}

function windowNote(form: ChartDataWindowForm, count: number): string {
	if (form === 'visible_range') {
		return "No window was named, so the chart's currently visible range was used.";
	}
	if (form === 'explicit') {
		return `The explicit window you named holds ${count} bars.`;
	}
	if (form === 'last_n_bars') {
		return `The last ${count} bars inside the chart's configured range.`;
	}
	return `${count} bars around the anchor time, inside the chart's configured range.`;
}

function overCapRefusal(
	count: number,
	timeframe: ChartTimeframe,
	list: readonly CountedBar[],
	range: ChartSeriesWindow
): ChartDataOutcome {
	const options = coarserOptions(list, timeframe);
	const remedies = [
		`Narrow the window: request last_n_bars of at most ${CHART_DATA_BAR_CAP}, or a shorter ` +
			'explicit start and end.',
		'Read the window in named pieces of your own choosing, one bounded call each — there is ' +
			'no continuation cursor to follow.'
	];
	if (options.length > 0) {
		const fits = options.map((o) => `${o.timeframe} (${o.barCount} bars)`).join(', ');
		remedies.push(`Request a coarser aggregation that fits: aggregate_to ${fits}.`);
	}
	return refuse({
		reason: 'window_over_bar_cap',
		message:
			`That window holds ${count} ${timeframe} bars, over the per-call cap of ` +
			`${CHART_DATA_BAR_CAP}. The read is refused rather than truncated, so you are never ` +
			'handed a shortened series without knowing it.',
		remedies,
		barCap: CHART_DATA_BAR_CAP,
		barsInWindow: count,
		timeframe,
		chartRange: range,
		fitsWithAggregation: options
	});
}

function outsideRangeRefusal(
	offending: { at: string; side: 'before' | 'after' },
	range: ChartSeriesWindow,
	requested: ChartSeriesWindow
): ChartDataOutcome {
	return refuse({
		reason: 'window_outside_chart_range',
		message:
			`"${offending.at}" falls ${offending.side} the chart's configured range ` +
			`(${range.start} to ${range.end}). A read cannot reach past what the human can see, so ` +
			'change the chart configuration first and then read the new range.',
		remedies: [
			"Change the chart's range to cover the period you want, then read it.",
			"Keep the window inside the chart's configured range."
		],
		chartRange: range,
		requestedWindow: requested
	});
}

function aggregationIssue(
	aggregateTo: ChartTimeframe,
	from: ChartTimeframe
): ChartDataOutcome | null {
	if (timeframeRank(aggregateTo) > timeframeRank(from)) {
		return null;
	}
	const coarser = TIMEFRAME_ORDER.slice(timeframeRank(from) + 1);
	return refuse({
		reason: 'invalid_aggregation',
		message:
			`aggregate_to "${aggregateTo}" is not coarser than the chart's "${from}" bars. Bars can ` +
			'only be rolled up, never split, so a finer or equal aggregation cannot be produced from ' +
			'what the chart shows.',
		remedies:
			coarser.length > 0
				? [
						`Choose a coarser timeframe: ${coarser.join(', ')}.`,
						"Omit aggregate_to to read the chart's own bars."
					]
				: [
						`The chart is already at the coarsest timeframe (${from}); omit aggregate_to.`,
						'Narrow the window instead.'
					],
		timeframe: from
	});
}

function resolveState(
	deps: ChartDataDeps,
	request: ChartDataRequest
): { state: ChartState; instrument: InstrumentRef } | ChartDataOutcome {
	const workspaceId = request.workspaceId ?? deps.repository.getActiveId();
	const doc = workspaceId ? deps.repository.get(workspaceId) : null;
	if (!doc) {
		return refuse({
			reason: 'workspace_not_found',
			message: workspaceId
				? `Workspace "${workspaceId}" was not found.`
				: 'There is no active workspace to read a chart from.',
			remedies: ['Name an existing workspace_id.', 'Create or activate a workspace first.']
		});
	}
	const state = readChartStateOrNull(doc, request.panelId);
	if (!state) {
		return refuse({
			reason: 'chart_panel_not_found',
			message: `Panel "${request.panelId}" has no chart on it.`,
			remedies: ['Name a chart panel that exists.', 'Read the canvas state to list the panels.'],
			panelId: request.panelId
		});
	}
	if (!state.config.instrument) {
		return refuse({
			reason: 'chart_not_configured',
			message: `Chart panel "${request.panelId}" has no instrument, so it has no bars to read.`,
			remedies: [
				'Bind the chart to a resolved instrument ID first.',
				'Resolve the ticker through instrument search, then configure the chart.'
			],
			panelId: request.panelId
		});
	}
	return { state, instrument: state.config.instrument };
}

async function fetchSeries(
	deps: ChartDataDeps,
	state: ChartState,
	instrument: InstrumentRef,
	window: ChartSeriesWindow
): Promise<ChartSeriesResult | ChartDataOutcome> {
	try {
		return await deps.series.fetchSeries({
			instrumentId: instrument.instrumentId,
			timeframe: state.config.timeframe,
			window,
			priceAdjustment: state.config.priceAdjustment,
			session: state.config.session
		});
	} catch (error) {
		return refuse({
			reason: 'series_unavailable',
			message: error instanceof Error ? error.message : String(error),
			remedies: ['Retry the read.', 'Read a different instrument or timeframe.'],
			requestedWindow: window
		});
	}
}

function isOutcome(value: unknown): value is ChartDataOutcome {
	return typeof value === 'object' && value !== null && 'ok' in value;
}

export async function readChartData(
	deps: ChartDataDeps,
	request: ChartDataRequest
): Promise<ChartDataOutcome> {
	const resolved = resolveState(deps, request);
	if (isOutcome(resolved)) {
		return resolved;
	}
	const { state, instrument } = resolved;
	const window = request.window ?? { form: 'visible_range' };
	const issues = validateWindowRequest(window);
	if (issues.length > 0) {
		return refuse({
			reason: 'invalid_window',
			message: issues.join(' '),
			remedies: [
				'Correct the named field and call again.',
				"Omit window to read the chart's visible range."
			]
		});
	}
	const chartRange = resolveChartRange(state.config.range, deps.clock.now());
	const outside = containmentIssue(window, chartRange);
	if (outside) {
		return outsideRangeRefusal(outside, chartRange, requestedWindowOf(window, chartRange));
	}
	if (request.aggregateTo) {
		const bad = aggregationIssue(request.aggregateTo, state.config.timeframe);
		if (bad) {
			return bad;
		}
	}
	// The explicit form fetches only what it named; every other form is resolved
	// by slicing bars from inside the chart's own range, which is the bound the
	// design gives reads.
	const fetchWindow: ChartSeriesWindow =
		window.form === 'explicit' ? { start: window.start, end: window.end } : chartRange;
	const series = await fetchSeries(deps, state, instrument, fetchWindow);
	if (isOutcome(series)) {
		return series;
	}
	return assemble(deps, { state, instrument, window, chartRange, series, request });
}

function requestedWindowOf(
	window: ChartDataWindowRequest,
	range: ChartSeriesWindow
): ChartSeriesWindow {
	if (window.form === 'explicit') {
		return { start: window.start, end: window.end };
	}
	if (window.form === 'anchored') {
		return { start: window.anchorTime, end: window.anchorTime };
	}
	return range;
}

interface AssembleInput {
	state: ChartState;
	instrument: InstrumentRef;
	window: ChartDataWindowRequest;
	chartRange: ChartSeriesWindow;
	series: ChartSeriesResult;
	request: ChartDataRequest;
}

function assemble(deps: ChartDataDeps, input: AssembleInput): ChartDataOutcome {
	const { state, window, chartRange, series, request } = input;
	const raw: CountedBar[] = series.bars.map((bar) => ({ bar: { ...bar }, sources: 1 }));
	const aggregateTo = request.aggregateTo;
	// Aggregation runs before the slice so a count-based window means the bars
	// the caller gets back, and before the cap check so "aggregate to fit" is a
	// remedy that actually changes the answer.
	const rolled = aggregateTo ? rollUp(raw, aggregateTo) : raw;
	const timeframe = aggregateTo ?? state.config.timeframe;
	const { kept, warnings } = sliceForWindow(rolled, window);
	if (kept.length > CHART_DATA_BAR_CAP) {
		return overCapRefusal(kept.length, timeframe, kept, chartRange);
	}
	const bars = kept.map((entry) => entry.bar);
	const registry = deps.registry ?? builtinCatalogRegistry;
	const studies = sortStudiesForDisplay(state.studies)
		.filter((study) => study.enabled)
		.map((study) => buildStudy(study, bars, registry));
	return {
		ok: true,
		data: {
			panelId: state.config.panelId,
			instrument: { ...input.instrument },
			timeframe,
			sourceTimeframe: state.config.timeframe,
			session: series.session,
			window: effectiveWindow(window, chartRange, bars),
			chartRange,
			barCap: CHART_DATA_BAR_CAP,
			barCount: bars.length,
			bars,
			aggregation: aggregateTo
				? {
						from: state.config.timeframe,
						to: aggregateTo,
						method: 'ohlcv_rollup',
						sourceBarCount: kept.reduce((total, entry) => total + entry.sources, 0)
					}
				: null,
			studies,
			priceAdjustment: {
				chartPolicy: state.config.priceAdjustment,
				applied: series.appliedPriceAdjustment
			},
			provenance: series.provenance,
			warnings: [...series.warnings, ...warnings, ...aggregationWarnings(aggregateTo)]
		}
	};
}

// Edge buckets are rolled up from whatever fell inside the window, which for
// the first and last period may be only part of it. Saying so is cheaper than
// a calendar this layer does not have.
function aggregationWarnings(aggregateTo: ChartTimeframe | undefined): string[] {
	return aggregateTo
		? [
				`Bars are aggregated to ${aggregateTo} from the bars inside the window, so the first ` +
					'and last aggregated bar may cover a partial period.'
			]
		: [];
}

function effectiveWindow(
	window: ChartDataWindowRequest,
	range: ChartSeriesWindow,
	bars: readonly OhlcvBar[]
): ChartDataWindow {
	const note = windowNote(window.form, bars.length);
	if (window.form === 'explicit') {
		return {
			start: window.start,
			end: window.end,
			form: 'explicit',
			isChartVisibleRange: false,
			note
		};
	}
	if (window.form === 'visible_range') {
		return { ...range, form: 'visible_range', isChartVisibleRange: true, note };
	}
	// The span the returned bars actually cover; the chart's bounds when the
	// slice came back empty and there is no span to report.
	const first = bars[0];
	const last = bars[bars.length - 1];
	return {
		start: first ? first.time : range.start,
		end: last ? last.time : range.end,
		form: window.form,
		isChartVisibleRange: false,
		note
	};
}

function toWireStudy(study: ChartDataStudy): Record<string, unknown> {
	return {
		study_id: study.studyId,
		catalog_item_id: study.catalogItemId,
		params: study.params,
		pane: study.pane,
		outputs: study.outputs,
		warmup_bars: study.warmupBars,
		warnings: study.warnings
	};
}

// The single snake_case serializer for this module. Note what is absent: no
// cursor, no has_more, no next_page, no offset, no token. That absence is the
// contract -- see BOUNDEDNESS_NOTE.
export function toWireChartData(data: ChartDataResult): Record<string, unknown> {
	return {
		panel_id: data.panelId,
		instrument: {
			instrument_id: data.instrument.instrumentId,
			symbol: data.instrument.symbol,
			exchange: data.instrument.exchange,
			asset_type: data.instrument.assetType
		},
		timeframe: data.timeframe,
		source_timeframe: data.sourceTimeframe,
		session: data.session,
		window: {
			start: data.window.start,
			end: data.window.end,
			form: data.window.form,
			is_chart_visible_range: data.window.isChartVisibleRange,
			note: data.window.note
		},
		chart_range: { start: data.chartRange.start, end: data.chartRange.end },
		bar_cap: data.barCap,
		bar_count: data.barCount,
		aggregated: data.aggregation !== null,
		aggregation: data.aggregation
			? {
					from: data.aggregation.from,
					to: data.aggregation.to,
					method: data.aggregation.method,
					source_bar_count: data.aggregation.sourceBarCount
				}
			: null,
		bars: data.bars,
		studies: data.studies.map(toWireStudy),
		price_adjustment: {
			chart_policy: data.priceAdjustment.chartPolicy,
			applied: data.priceAdjustment.applied
		},
		provenance: toWireProvenance(data.provenance),
		warnings: data.warnings,
		boundedness: BOUNDEDNESS_NOTE
	};
}

function withoutUndefined(value: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

export function toWireChartDataRefusal(refusal: ChartDataRefusal): Record<string, unknown> {
	return withoutUndefined({
		error: refusal.reason,
		reason: refusal.reason,
		message: refusal.message,
		remedies: refusal.remedies,
		panel_id: refusal.panelId,
		bar_cap: refusal.barCap,
		bars_in_window: refusal.barsInWindow,
		timeframe: refusal.timeframe,
		chart_range: refusal.chartRange
			? { start: refusal.chartRange.start, end: refusal.chartRange.end }
			: undefined,
		requested_window: refusal.requestedWindow
			? { start: refusal.requestedWindow.start, end: refusal.requestedWindow.end }
			: undefined,
		fits_with_aggregation: refusal.fitsWithAggregation
			? refusal.fitsWithAggregation.map((o) => ({ timeframe: o.timeframe, bar_count: o.barCount }))
			: undefined
	});
}
