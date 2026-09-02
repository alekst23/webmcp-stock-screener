// A ChartSeriesPort backed by fixed bars. Two jobs: it is the implementation
// the port's own contract tests run against -- a fake with real behavior, not a
// stub that returns whatever the assertion wants -- and it is what the
// composition root wires in until a real feed exists, so the chart panel has
// something honest to render rather than an unimplemented port.
//
// Every fixture states its own liveness and adjustment basis. Nothing here
// defaults those, because a fixture that quietly claims 'adjusted' would teach
// callers to trust a basis no source ever reported.
import type { Clock } from '../../domain/ports';
import type { ReportingPeriod } from '../../domain/provenance';
import {
	assertBoundedWindow,
	barsWithinWindow,
	buildSeriesProvenance,
	ChartSeriesError,
	seriesWarnings,
	type ChartPriceAdjustment,
	type ChartSeriesLiveness,
	type ChartSeriesPort,
	type ChartSeriesRequest,
	type ChartSeriesResult,
	type ChartSession,
	type ChartSourceAdjustment,
	type ChartTimeframe,
	type OhlcvBar
} from '../domain/seriesPort';

interface InMemoryFixtureCore {
	instrumentId: string;
	timeframe: ChartTimeframe;
	// Any order; the port sorts and window-filters them.
	bars: OhlcvBar[];
	sourceAdjustment: ChartSourceAdjustment;
	session?: ChartSession;
	sourceId?: string;
	sourceLabel?: string;
	timezone?: string;
	currency?: string;
	reportingPeriod?: ReportingPeriod;
	// When set, every request for this fixture fails with this value as the
	// wrapped cause -- how the source-failure path is exercised without a
	// network.
	failure?: unknown;
}

export type InMemoryChartSeriesFixture = InMemoryFixtureCore & ChartSeriesLiveness;

export interface InMemoryChartSeriesConfig {
	clock: Clock;
	series: InMemoryChartSeriesFixture[];
	sourceId?: string;
	sourceLabel?: string;
	timezone?: string;
}

const DEFAULT_SOURCE_ID = 'src.chart.in_memory';
const DEFAULT_SOURCE_LABEL = 'In-memory chart series';
const DEFAULT_TIMEZONE = 'America/New_York';

export function createInMemoryChartSeries(config: InMemoryChartSeriesConfig): ChartSeriesPort {
	function resolveFixture(request: ChartSeriesRequest): InMemoryChartSeriesFixture {
		const forInstrument = config.series.filter(
			(entry) => entry.instrumentId === request.instrumentId
		);
		if (forInstrument.length === 0) {
			throw new ChartSeriesError(
				'unknown_instrument',
				`No series is loaded for instrument "${request.instrumentId}".`,
				{ instrumentId: request.instrumentId }
			);
		}
		const fixture = forInstrument.find((entry) => entry.timeframe === request.timeframe);
		if (!fixture) {
			const available = forInstrument.map((entry) => entry.timeframe).join(', ');
			throw new ChartSeriesError(
				'unsupported_timeframe',
				`Instrument "${request.instrumentId}" is loaded at ${available}, not "${request.timeframe}".`,
				{ instrumentId: request.instrumentId }
			);
		}
		return fixture;
	}

	return {
		async fetchSeries(request: ChartSeriesRequest): Promise<ChartSeriesResult> {
			assertBoundedWindow(request.window, request.instrumentId);
			const fixture = resolveFixture(request);
			if (fixture.failure !== undefined) {
				throw new ChartSeriesError(
					'source_unavailable',
					`The series source failed for instrument "${request.instrumentId}".`,
					{ cause: fixture.failure, instrumentId: request.instrumentId }
				);
			}

			const applied: ChartPriceAdjustment | null =
				fixture.sourceAdjustment === 'unreported' ? null : fixture.sourceAdjustment;
			const session = fixture.session ?? 'regular';

			return {
				instrumentId: request.instrumentId,
				timeframe: request.timeframe,
				window: request.window,
				session: request.session,
				requestedPriceAdjustment: request.priceAdjustment,
				appliedPriceAdjustment: applied,
				bars: barsWithinWindow(fixture.bars, request.window),
				provenance: buildSeriesProvenance({
					asOf: config.clock.now(),
					sourceId: fixture.sourceId ?? config.sourceId ?? DEFAULT_SOURCE_ID,
					sourceLabel: fixture.sourceLabel ?? config.sourceLabel ?? DEFAULT_SOURCE_LABEL,
					timezone: fixture.timezone ?? config.timezone ?? DEFAULT_TIMEZONE,
					currency: fixture.currency,
					appliedPriceAdjustment: applied,
					reportingPeriod: fixture.reportingPeriod,
					...(fixture.liveness === 'delayed'
						? { liveness: 'delayed' as const, delaySeconds: fixture.delaySeconds }
						: { liveness: fixture.liveness })
				}),
				warnings: seriesWarnings(request, applied, session)
			};
		}
	};
}
