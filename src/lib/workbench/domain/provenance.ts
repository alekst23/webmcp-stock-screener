// Market-data provenance contract (T-1006-3). Any market-data-bearing tool
// result can carry a provenance record stating as-of time, source,
// live/delayed status, timezone, currency, price-adjustment basis and
// fundamentals reporting period -- so an agent never quotes a delayed,
// unadjusted, foreign-currency price as though it were current. See the
// final paragraph of docs/reference/tool-spec.md's "Common contract for
// every tool".

export type ProvenanceLiveness = 'live' | 'delayed' | 'end_of_day' | 'historical';

export type PriceAdjustment = 'adjusted' | 'unadjusted' | 'not_applicable';

export type FiscalPeriod = 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface FundamentalsPeriod {
	fiscalYear: number;
	fiscalPeriod: FiscalPeriod;
	// ISO 8601 date.
	periodEnd: string;
	restated: boolean;
}

export interface MarketDataProvenance {
	// ISO 8601 instant the data describes.
	asOf: string;
	// Provider identifier, e.g. 'eodhd'.
	source: string;
	liveness: ProvenanceLiveness;
	// Set only when liveness === 'delayed'; null otherwise, never a
	// misleading duration for live/end-of-day/historical data.
	delaySeconds: number | null;
	// IANA timezone name, e.g. 'America/New_York'.
	timezone: string;
	// ISO 4217 currency code, e.g. 'USD'.
	currency: string;
	priceAdjustment: PriceAdjustment;
	// Explicitly absent (null) for results carrying no fundamentals.
	fundamentalsPeriod: FundamentalsPeriod | null;
	calcEngineVersion: string;
}

export interface WithProvenance<T> {
	data: T;
	provenance: MarketDataProvenance;
}

export function withProvenance<T>(data: T, provenance: MarketDataProvenance): WithProvenance<T> {
	return { data, provenance };
}

export function toWireProvenance(p: MarketDataProvenance): Record<string, unknown> {
	return {
		as_of: p.asOf,
		source: p.source,
		liveness: p.liveness,
		delay_seconds: p.delaySeconds,
		timezone: p.timezone,
		currency: p.currency,
		price_adjustment: p.priceAdjustment,
		fundamentals_period: p.fundamentalsPeriod
			? {
					fiscal_year: p.fundamentalsPeriod.fiscalYear,
					fiscal_period: p.fundamentalsPeriod.fiscalPeriod,
					period_end: p.fundamentalsPeriod.periodEnd,
					restated: p.fundamentalsPeriod.restated
				}
			: null,
		calc_engine_version: p.calcEngineVersion
	};
}
