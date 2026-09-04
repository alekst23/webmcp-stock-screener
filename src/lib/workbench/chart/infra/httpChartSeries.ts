// ChartSeriesPort over the backend's own bar-serving endpoint,
// GET /api/chart/bars (bug fix, see git history). Previously this adapter
// called POST /api/research/instance-windows -- an instance-oriented route
// from the retired legacy surface -- and had to synthesize a fake "one
// synthetic instance per calendar day in the window" instance set just to
// coax whole-window bars out of it. api/chart.py (backend) now serves bars
// directly for a ticker and date range, so that synthesis is gone: this is
// a plain GET with the request's own shape.
import type { Clock } from '../../domain/ports';
import type { MarketDataProvenance } from '../../domain/provenance';
import {
	assertBoundedWindow,
	barsWithinWindow,
	buildSeriesProvenance,
	ChartSeriesError,
	parseWindowBound,
	seriesWarnings,
	type ChartPriceAdjustment,
	type ChartSeriesLiveness,
	type ChartSeriesPort,
	type ChartSeriesRequest,
	type ChartSeriesResult,
	type ChartSourceAdjustment,
	type ChartTimeframe,
	type OhlcvBar
} from '../domain/seriesPort';

const SERIES_PATH = '/api/chart/bars';

// A transport guard, not the epic's agent-facing per-call bar cap: the
// backend reads one row per calendar day in [start, end], so a decade-wide
// window is refused before the request is sent rather than after.
const DEFAULT_MAX_WINDOW_DAYS = 3660;

const MS_PER_DAY = 86_400_000;

export interface BackendPriceBarRow {
	ticker: string;
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

interface BackendBarsResponse {
	ticker: string;
	start: string;
	end: string;
	bars: BackendPriceBarRow[];
}

interface HttpChartSeriesCore {
	baseUrl: string;
	// Maps the caller's stable instrument ID onto the symbol this backend wants.
	// Null for an ID this source does not carry. Keeping it here rather than in
	// the port is what lets the port refuse bare tickers.
	resolveSymbol(instrumentId: string): string | null;
	clock: Clock;
	sourceId: string;
	sourceLabel: string;
	timezone: string;
	// Required with no default: the basis the source is documented to deliver.
	// A guessed basis is the exact misreport provenance exists to prevent, so
	// the composition root has to state it -- or state 'unreported'.
	sourceAdjustment: ChartSourceAdjustment;
	currency?: string;
	// The stored panel is daily; anything else has to be refused rather than
	// served as daily bars wearing another label.
	supportedTimeframes?: ChartTimeframe[];
	// The session the source's bars actually cover.
	sourceSession?: 'regular' | 'extended' | 'continuous';
	maxWindowDays?: number;
	fetchImpl?: typeof fetch;
}

export type HttpChartSeriesConfig = HttpChartSeriesCore & ChartSeriesLiveness;

function toIsoDate(epochMs: number): string {
	return new Date(epochMs).toISOString().slice(0, 10);
}

// UTC-based so the same window always produces the same [start, end] pair,
// whatever the machine's local zone is.
function dateBounds(window: { start: string; end: string }, maxDays: number, instrumentId: string) {
	const start = parseWindowBound(window.start) as number;
	const end = parseWindowBound(window.end) as number;
	const firstDay = Date.parse(toIsoDate(start));
	const lastDay = Date.parse(toIsoDate(end));
	const dayCount = Math.floor((lastDay - firstDay) / MS_PER_DAY) + 1;
	if (dayCount > maxDays) {
		throw new ChartSeriesError(
			'invalid_window',
			`Window spans ${dayCount} days, more than this source will serve in one request (${maxDays}). Narrow the window.`,
			{ instrumentId }
		);
	}
	return { start: toIsoDate(start), end: toIsoDate(end) };
}

function toOhlcvBar(row: BackendPriceBarRow): OhlcvBar {
	return {
		time: row.date,
		open: row.open,
		high: row.high,
		low: row.low,
		close: row.close,
		volume: row.volume
	};
}

function readBarsResponse(payload: unknown, instrumentId: string): BackendBarsResponse {
	if (
		typeof payload !== 'object' ||
		payload === null ||
		!Array.isArray((payload as { bars?: unknown }).bars)
	) {
		throw new ChartSeriesError(
			'malformed_response',
			'The price source returned a payload that is not a bars response.',
			{ instrumentId }
		);
	}
	return payload as BackendBarsResponse;
}

function toTransportError(response: Response, rawBody: string): Error {
	const suffix = rawBody ? `: ${rawBody}` : '';
	return new Error(`price source returned ${response.status} ${response.statusText}${suffix}`);
}

// The backend's 404 body carries the loaded panel's as-of date alongside its
// message (api/routes/chart.py, T-0020-13) -- the same provenance concept
// PanelPriceSeriesPort.provenance() already surfaces on every successful
// read. Reading it here is what lets a refusal say "this panel's data runs
// through <date>" instead of just naming the instrument, so a caller can
// tell "never covered" apart from "not ingested that far yet." Absent or
// unparseable is silent, not an error: the instrument-naming half of the
// message still stands on its own.
function asOfDateFromBody(rawBody: string): string | null {
	if (!rawBody) {
		return null;
	}
	try {
		const payload = JSON.parse(rawBody) as { detail?: { as_of?: unknown }; as_of?: unknown };
		const asOf = payload.detail?.as_of ?? payload.as_of;
		return typeof asOf === 'string' ? asOf : null;
	} catch {
		return null;
	}
}

export function createHttpChartSeries(config: HttpChartSeriesConfig): ChartSeriesPort {
	const doFetch = config.fetchImpl ?? fetch;
	const supported = config.supportedTimeframes ?? ['1d'];
	const sourceSession = config.sourceSession ?? 'regular';
	const maxWindowDays = config.maxWindowDays ?? DEFAULT_MAX_WINDOW_DAYS;

	function requireSymbol(instrumentId: string): string {
		const symbol = config.resolveSymbol(instrumentId);
		if (!symbol) {
			throw new ChartSeriesError(
				'unknown_instrument',
				`This price source carries no data for instrument "${instrumentId}".`,
				{ instrumentId }
			);
		}
		return symbol;
	}

	function requireTimeframe(timeframe: ChartTimeframe, instrumentId: string): void {
		if (!supported.includes(timeframe)) {
			throw new ChartSeriesError(
				'unsupported_timeframe',
				`This price source serves ${supported.join(', ')} bars, not "${timeframe}".`,
				{ instrumentId }
			);
		}
	}

	async function getBars(
		symbol: string,
		bounds: { start: string; end: string },
		instrumentId: string
	): Promise<BackendBarsResponse> {
		const url = new URL(`${config.baseUrl}${SERIES_PATH}`);
		url.searchParams.set('ticker', symbol);
		url.searchParams.set('start', bounds.start);
		url.searchParams.set('end', bounds.end);

		let response: Response;
		try {
			response = await doFetch(url.toString());
		} catch (err) {
			throw new ChartSeriesError(
				'source_unavailable',
				`The price source could not be reached for instrument "${instrumentId}".`,
				{ cause: err, instrumentId }
			);
		}
		if (response.status === 404) {
			const rawBody = await response.text().catch(() => '');
			const asOf = asOfDateFromBody(rawBody);
			const coverage = asOf ? ` This price source's data runs through ${asOf}.` : '';
			throw new ChartSeriesError(
				'unknown_instrument',
				`This price source carries no data for instrument "${instrumentId}".${coverage}`,
				{ cause: toTransportError(response, rawBody), instrumentId }
			);
		}
		if (!response.ok) {
			const rawBody = await response.text().catch(() => '');
			throw new ChartSeriesError(
				'source_unavailable',
				`The price source rejected the request for instrument "${instrumentId}".`,
				{ cause: toTransportError(response, rawBody), instrumentId }
			);
		}
		try {
			return readBarsResponse(await response.json(), instrumentId);
		} catch (err) {
			if (err instanceof ChartSeriesError) {
				throw err;
			}
			throw new ChartSeriesError(
				'malformed_response',
				`The price source returned a body that could not be read for instrument "${instrumentId}".`,
				{ cause: err, instrumentId }
			);
		}
	}

	// The basis is declared by configuration, not inferred from the payload:
	// this route returns bare price rows and says nothing about how they were
	// adjusted, so the composition root has to state what the panel holds.
	const applied: ChartPriceAdjustment | null =
		config.sourceAdjustment === 'unreported' ? null : config.sourceAdjustment;

	function provenanceFor(basis: ChartPriceAdjustment | null): MarketDataProvenance {
		return buildSeriesProvenance({
			// The instant the source was read. The stored panel's bars are
			// date-only, so deriving an ISO instant with an offset from the last
			// bar would mean inventing one; `liveness` carries the claim about the
			// data's own currency instead.
			asOf: config.clock.now(),
			sourceId: config.sourceId,
			sourceLabel: config.sourceLabel,
			timezone: config.timezone,
			currency: config.currency,
			appliedPriceAdjustment: basis,
			...(config.liveness === 'delayed'
				? { liveness: 'delayed' as const, delaySeconds: config.delaySeconds }
				: { liveness: config.liveness })
		});
	}

	return {
		async fetchSeries(request: ChartSeriesRequest): Promise<ChartSeriesResult> {
			assertBoundedWindow(request.window, request.instrumentId);
			requireTimeframe(request.timeframe, request.instrumentId);
			const symbol = requireSymbol(request.instrumentId);
			const bounds = dateBounds(request.window, maxWindowDays, request.instrumentId);
			const response = await getBars(symbol, bounds, request.instrumentId);
			const bars = barsWithinWindow(response.bars.map(toOhlcvBar), request.window);

			return {
				instrumentId: request.instrumentId,
				timeframe: request.timeframe,
				window: request.window,
				session: request.session,
				requestedPriceAdjustment: request.priceAdjustment,
				appliedPriceAdjustment: applied,
				bars,
				provenance: provenanceFor(applied),
				warnings: seriesWarnings(request, applied, sourceSession)
			};
		}
	};
}
