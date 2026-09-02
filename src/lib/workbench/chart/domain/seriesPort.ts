// The chart's own OHLCV bars port. Narrow on purpose: if the market-data
// workstream later publishes an equivalent port, this one becomes a type alias,
// so it stays free of chart-specific vocabulary beyond what a bar request
// genuinely needs.
//
// The single load-bearing design decision here is that an unbounded request is
// not expressible. `window` is required and has exactly one form -- an explicit
// start and end. There is no 'all', no 'max', no `lastNBars`, and no cursor or
// `hasMore` in the result, because a next-page affordance re-creates the
// unbounded pull the spec forbids. A caller that wants more narrows its own
// window and asks again.
import type { WireError } from '../../domain/errors';
import {
	makeProvenance,
	type MarketDataProvenance,
	type ProvenanceLiveness,
	type ReportingPeriod
} from '../../domain/provenance';
// The chart's timeframe, session and price-adjustment vocabulary has one
// definition, in chartState. The port re-exports it rather than declaring a
// parallel copy: two enumerations of the same concept drift, and a port that
// accepted a narrower timeframe set than the chart can hold would reject
// configurations the chart considers valid. The dependency is acyclic --
// chartState never imports this module.
import {
	toProvenancePriceAdjustment,
	type ChartPriceAdjustment,
	type ChartSession,
	type ChartTimeframe
} from './chartState';

export {
	toProvenancePriceAdjustment,
	type ChartPriceAdjustment,
	type ChartSession,
	type ChartTimeframe
};

// What a source is documented to deliver. `'unreported'` is the honest value
// for a source that never states its basis -- guessing 'adjusted' there would
// be exactly the misreport this whole contract exists to prevent.
export type ChartSourceAdjustment = ChartPriceAdjustment | 'unreported';

// Mirrors provenance's own discrimination on liveness, so a delayed source
// cannot be described without stating the magnitude of its delay, and a
// non-delayed one cannot carry a stale delay figure.
export type ChartSeriesLiveness =
	| { liveness: 'delayed'; delaySeconds: number }
	| { liveness: Exclude<ProvenanceLiveness, 'delayed'>; delaySeconds?: never };

// Both bounds are required and inclusive. ISO 8601; a date-only string is
// accepted for daily and coarser timeframes.
export interface ChartSeriesWindow {
	start: string;
	end: string;
}

export interface ChartSeriesRequest {
	// A stable instrument ID, never a bare ticker. Mapping the ID onto whatever
	// symbol a source wants is an adapter's job, not the caller's.
	instrumentId: string;
	timeframe: ChartTimeframe;
	window: ChartSeriesWindow;
	priceAdjustment: ChartPriceAdjustment;
	session: ChartSession;
}

export interface OhlcvBar {
	// ISO 8601 instant, or a date for daily and coarser bars, at the bar's open.
	time: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export interface ChartSeriesResult {
	instrumentId: string;
	timeframe: ChartTimeframe;
	window: ChartSeriesWindow;
	session: ChartSession;
	requestedPriceAdjustment: ChartPriceAdjustment;
	// What the source actually applied, which may be coarser than what was
	// asked for. Null only when the source does not state its basis at all.
	appliedPriceAdjustment: ChartPriceAdjustment | null;
	bars: OhlcvBar[];
	provenance: MarketDataProvenance;
	// Non-fatal facts the caller must be able to relay: an adjustment the source
	// could not honour, a session it does not distinguish.
	warnings: string[];
}

export interface ChartSeriesPort {
	fetchSeries(request: ChartSeriesRequest): Promise<ChartSeriesResult>;
}

export type ChartSeriesErrorReason =
	| 'invalid_window'
	| 'unknown_instrument'
	| 'unsupported_timeframe'
	| 'source_unavailable'
	| 'malformed_response';

// The chart layer's own failure type. A raw transport exception never escapes
// an adapter: it is wrapped here and kept reachable through `cause`, so a
// caller can branch on `reason` without parsing message strings and still get
// at the original for logging.
export class ChartSeriesError extends Error {
	readonly reason: ChartSeriesErrorReason;
	readonly instrumentId: string | null;

	constructor(
		reason: ChartSeriesErrorReason,
		message: string,
		options?: { cause?: unknown; instrumentId?: string }
	) {
		super(message, { cause: options?.cause });
		this.name = 'ChartSeriesError';
		this.reason = reason;
		this.instrumentId = options?.instrumentId ?? null;
	}

	toWireError(): WireError {
		return {
			error: `chart_series_${this.reason}`,
			message: this.message,
			reason: this.reason,
			instrument_id: this.instrumentId
		};
	}
}

export function parseWindowBound(bound: string): number | null {
	const parsed = Date.parse(bound);
	return Number.isNaN(parsed) ? null : parsed;
}

// A window whose bounds do not parse, or whose end precedes its start, is a
// caller mistake. A window that simply holds no bars is not -- that returns an
// empty series with valid provenance.
export function assertBoundedWindow(window: ChartSeriesWindow, instrumentId: string): void {
	const start = parseWindowBound(window.start);
	const end = parseWindowBound(window.end);
	if (start === null || end === null) {
		throw new ChartSeriesError(
			'invalid_window',
			`Window bounds must be ISO 8601 timestamps; got start "${window.start}" and end "${window.end}".`,
			{ instrumentId }
		);
	}
	if (end < start) {
		throw new ChartSeriesError(
			'invalid_window',
			`Window end "${window.end}" precedes its start "${window.start}".`,
			{ instrumentId }
		);
	}
}

export function barsWithinWindow(bars: readonly OhlcvBar[], window: ChartSeriesWindow): OhlcvBar[] {
	const start = parseWindowBound(window.start);
	const end = parseWindowBound(window.end);
	if (start === null || end === null) {
		return [];
	}
	return bars
		.filter((bar) => {
			const at = parseWindowBound(bar.time);
			return at !== null && at >= start && at <= end;
		})
		.sort((a, b) => (parseWindowBound(a.time) ?? 0) - (parseWindowBound(b.time) ?? 0));
}

// Null when the source honoured the request, otherwise a sentence naming both
// policies -- the caller has to be able to say which one it got.
export function adjustmentWarning(
	requested: ChartPriceAdjustment,
	applied: ChartPriceAdjustment | null
): string | null {
	if (applied === null) {
		return (
			`The source does not state its price-adjustment basis, so "${requested}" could not be ` +
			'confirmed; treat these prices as being on an unknown basis.'
		);
	}
	return applied === requested
		? null
		: `Requested "${requested}" prices but the source supplies "${applied}" prices.`;
}

// Null when the source covers the session that was asked for. A session it
// does not distinguish is a warning, not a failure: the bars are still real.
export function sessionWarning(requested: ChartSession, supplied: ChartSession): string | null {
	return requested === supplied
		? null
		: `Requested the "${requested}" session but the source supplies "${supplied}" session bars.`;
}

// Everything a caller has to be told about a series that was still returned.
export function seriesWarnings(
	request: Pick<ChartSeriesRequest, 'priceAdjustment' | 'session'>,
	applied: ChartPriceAdjustment | null,
	suppliedSession: ChartSession
): string[] {
	return [
		adjustmentWarning(request.priceAdjustment, applied),
		sessionWarning(request.session, suppliedSession)
	].filter((warning): warning is string => warning !== null);
}

interface ChartSeriesProvenanceCore {
	asOf: string;
	sourceId: string;
	sourceLabel: string;
	timezone: string;
	currency?: string;
	// Absent when the source does not state its basis; never a guess.
	appliedPriceAdjustment: ChartPriceAdjustment | null;
	reportingPeriod?: ReportingPeriod;
}

export type ChartSeriesProvenanceInput = ChartSeriesProvenanceCore & ChartSeriesLiveness;

export function buildSeriesProvenance(input: ChartSeriesProvenanceInput): MarketDataProvenance {
	const priceAdjustment =
		input.appliedPriceAdjustment === null
			? undefined
			: toProvenancePriceAdjustment(input.appliedPriceAdjustment);
	const core = {
		asOf: input.asOf,
		sourceId: input.sourceId,
		sourceLabel: input.sourceLabel,
		timezone: input.timezone,
		currency: input.currency,
		priceAdjustment,
		reportingPeriod: input.reportingPeriod
	};
	return input.liveness === 'delayed'
		? makeProvenance({ ...core, liveness: 'delayed', delaySeconds: input.delaySeconds })
		: makeProvenance({ ...core, liveness: input.liveness });
}
