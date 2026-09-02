// ChartSeriesPort over the existing backend price API.
//
// The backend has one bar-bearing route, POST /api/research/instance-windows,
// which returns PriceBar rows for the instances of a set. Rather than importing
// or changing src/lib/workspace/apiEngine.ts, this duplicates the technique its
// showTickerCharts already uses: synthesize an instance set to get bars for a
// ticker. One synthetic instance per calendar day in the requested window, with
// a bar offset of [0, 0], makes the response exactly the bars inside the window
// -- no bar-count estimate, no anchor that has to land on a trading day, and no
// way for the request to reach past its own bounds.
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
	type ChartSeriesWindow,
	type ChartSourceAdjustment,
	type ChartTimeframe,
	type OhlcvBar
} from '../domain/seriesPort';

const SERIES_PATH = '/api/research/instance-windows';
const SYNTHETIC_SETUP_ID = 'chart_series';

// A transport guard, not the epic's agent-facing per-call bar cap: the request
// body carries one entry per calendar day, so a decade-wide window is refused
// before it is serialized rather than after.
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

interface BackendInstanceWindowRow {
	ticker: string;
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

// UTC-based so the same window always produces the same anchor list, whatever
// the machine's local zone is.
function calendarDaysInWindow(window: ChartSeriesWindow, maxDays: number, instrumentId: string) {
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
	const days: string[] = [];
	for (let day = firstDay; day <= lastDay; day += MS_PER_DAY) {
		days.push(toIsoDate(day));
	}
	return days;
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

// The backend returns one window per anchor, so a bar that is both an anchor's
// own day and inside another window would otherwise appear twice.
function dedupeByTime(bars: OhlcvBar[]): OhlcvBar[] {
	const byTime = new Map<string, OhlcvBar>();
	for (const bar of bars) {
		byTime.set(bar.time, bar);
	}
	return [...byTime.values()];
}

function readWindowRows(payload: unknown, instrumentId: string): BackendInstanceWindowRow[] {
	if (!Array.isArray(payload)) {
		throw new ChartSeriesError(
			'malformed_response',
			'The price source returned a payload that is not a list of instance windows.',
			{ instrumentId }
		);
	}
	return payload as BackendInstanceWindowRow[];
}

async function toTransportError(response: Response): Promise<Error> {
	const detail = await response.text().catch(() => '');
	const suffix = detail ? `: ${detail}` : '';
	return new Error(`price source returned ${response.status} ${response.statusText}${suffix}`);
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

	async function postWindows(
		symbol: string,
		days: string[],
		instrumentId: string
	): Promise<BackendInstanceWindowRow[]> {
		const body = {
			instance_set: {
				id: `${SYNTHETIC_SETUP_ID}_${symbol}_${days[0]}_${days[days.length - 1]}`,
				setup_id: SYNTHETIC_SETUP_ID,
				instances: days.map((date) => ({ ticker: symbol, date, completeness: 1 })),
				complete_count: days.length,
				partial_count: 0,
				from_date: days[0],
				to_date: days[days.length - 1]
			},
			n: days.length,
			strategy: 'recent',
			window: [0, 0]
		};
		let response: Response;
		try {
			response = await doFetch(`${config.baseUrl}${SERIES_PATH}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
		} catch (err) {
			throw new ChartSeriesError(
				'source_unavailable',
				`The price source could not be reached for instrument "${instrumentId}".`,
				{ cause: err, instrumentId }
			);
		}
		if (!response.ok) {
			throw new ChartSeriesError(
				'source_unavailable',
				`The price source rejected the request for instrument "${instrumentId}".`,
				{ cause: await toTransportError(response), instrumentId }
			);
		}
		try {
			return readWindowRows(await response.json(), instrumentId);
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
			const days = calendarDaysInWindow(request.window, maxWindowDays, request.instrumentId);
			const rows = await postWindows(symbol, days, request.instrumentId);
			const bars = barsWithinWindow(
				dedupeByTime(rows.flatMap((row) => (row.bars ?? []).map(toOhlcvBar))),
				request.window
			);

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
