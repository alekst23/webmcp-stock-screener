// The seeded catalog inventory. Data only -- the query surface lives in
// registry.ts, so a real data source can later contribute or override
// availability records without touching how the catalog is searched.
//
// Availability here answers "can an agent actually use this today?", and the
// `reason` says which kind of no it is: no data source, no engine support, or
// no consuming tool yet. That distinction is the whole point of the field --
// an agent that cannot tell "unsupported" from "not wired up" retries forever.
//
// Breadth of kinds matters more than depth within a kind: this covers all
// eight kinds and all eight condition families, the studies the tool spec
// names by example, and the price/volume fields the existing engine really
// supports.

import type { CatalogItem, DataAvailability } from './types';

// Daily EODHD bars are the only market data this project actually has
// (backend/infra/eodhd_client.py requests period "d").
const DAILY = ['interval.1d'] as const;

export const NO_REFERENCE_DATA =
	'No reference-data source is wired into this surface. Sectors, industries, ' +
	'index membership, exchanges, countries and market caps have no source here ' +
	'and sourcing them is an open project decision.';

export const NO_FUNDAMENTALS =
	'No fundamentals source is configured. The EODHD plan in use covers daily ' +
	'OHLCV only; fundamentals and the earnings calendar sit on a tier this ' +
	'project does not subscribe to.';

export const NO_INTRADAY =
	'The price pipeline fetches daily bars only, so no intraday or sub-daily ' +
	'interval can be served.';

export const NO_RESAMPLING =
	'The price pipeline fetches daily bars only and does not resample them to ' + 'longer intervals.';

const ENGINE_FUNCTIONS =
	'The calculation engine implements sma, ema, atr, highest, lowest and ' +
	'days_since (backend/infra/expression.py); this item needs a computation ' +
	'outside that set.';

const NO_BAR_OFFSET =
	'The expression engine has no bar-offset operator, so a previous-bar ' +
	'reference cannot be expressed yet.';

const NO_PATTERN_ENGINE =
	'No pattern-detection engine is implemented. The pattern is declared so an ' +
	'agent can see it is a recognised concept, not so it can be evaluated.';

const NO_TEMPLATE_CONSUMER =
	'Templates are declared for discovery only. No tool applies one yet -- the ' +
	'screener and chart surfaces that would consume them are not built.';

function available(intervalIds: readonly string[] = DAILY): DataAvailability {
	return { status: 'available', requiresReferenceData: false, intervalIds };
}

// Operators and other pure logic have no data dependency at all, so they are
// available over every interval rather than none.
function logicOnly(): DataAvailability {
	return { status: 'available', requiresReferenceData: false, intervalIds: [] };
}

function unavailable(reason: string, requiresReferenceData = false): DataAvailability {
	return { status: 'unavailable', reason, requiresReferenceData, intervalIds: [] };
}

const INTERVALS: CatalogItem[] = [
	{
		id: 'interval.1m',
		kind: 'interval',
		label: '1 minute',
		description: 'One-minute bars.',
		aliases: ['1m', 'minute', 'one minute'],
		tags: ['intraday'],
		barSeconds: 60,
		sessionAware: true,
		availability: unavailable(NO_INTRADAY)
	},
	{
		id: 'interval.5m',
		kind: 'interval',
		label: '5 minutes',
		description: 'Five-minute bars.',
		aliases: ['5m', 'five minute'],
		tags: ['intraday'],
		barSeconds: 300,
		sessionAware: true,
		availability: unavailable(NO_INTRADAY)
	},
	{
		id: 'interval.1h',
		kind: 'interval',
		label: '1 hour',
		description: 'Hourly bars.',
		aliases: ['1h', '60m', 'hourly'],
		tags: ['intraday'],
		barSeconds: 3600,
		sessionAware: true,
		availability: unavailable(NO_INTRADAY)
	},
	{
		id: 'interval.1d',
		kind: 'interval',
		label: '1 day',
		description: 'Daily bars, one per trading session. The only interval with real data today.',
		aliases: ['1d', 'daily', 'day', 'eod'],
		tags: ['daily', 'default'],
		barSeconds: 86_400,
		sessionAware: true,
		availability: available()
	},
	{
		id: 'interval.1w',
		kind: 'interval',
		label: '1 week',
		description: 'Weekly bars.',
		aliases: ['1w', 'weekly', 'week'],
		tags: ['multi-day'],
		barSeconds: 604_800,
		sessionAware: false,
		availability: unavailable(NO_RESAMPLING)
	}
];

const PRICE_FIELDS: CatalogItem[] = (
	[
		['open', 'Open', 'Session opening price.', ['opening price', 'o']],
		['high', 'High', 'Session high price.', ['session high', 'h']],
		['low', 'Low', 'Session low price.', ['session low', 'l']],
		['close', 'Close', 'Session closing price.', ['closing price', 'c', 'last']]
	] as const
).map(([slug, label, description, aliases]) => ({
	id: `field.price.${slug}`,
	kind: 'field' as const,
	label,
	description,
	aliases: [...aliases],
	tags: ['price', 'ohlcv'],
	valueType: 'number' as const,
	unit: 'currency',
	range: { min: 0 },
	nullable: false,
	availability: available()
}));

const OTHER_MARKET_FIELDS: CatalogItem[] = [
	{
		id: 'field.volume',
		kind: 'field',
		label: 'Volume',
		description: 'Shares traded during the session.',
		aliases: ['vol', 'shares traded'],
		tags: ['volume', 'ohlcv'],
		valueType: 'number',
		unit: 'shares',
		range: { min: 0 },
		nullable: false,
		availability: available()
	},
	{
		id: 'field.symbol',
		kind: 'field',
		label: 'Symbol',
		description: 'Display ticker. Identity only -- never use it as an instrument identifier.',
		aliases: ['ticker', 'symbol'],
		tags: ['identity'],
		valueType: 'string',
		nullable: false,
		availability: available()
	},
	{
		id: 'field.date',
		kind: 'field',
		label: 'Bar date',
		description: 'The trading date a bar belongs to.',
		aliases: ['date', 'session date', 'bar date'],
		tags: ['identity', 'time'],
		valueType: 'date',
		nullable: false,
		availability: available()
	}
];

// Present in the registry, marked unavailable with a reason -- not omitted.
// Omitting them would leave an agent unable to tell "the app has no concept of
// sector" from "sector exists but has no data here".
const REFERENCE_FIELDS: CatalogItem[] = [
	{
		id: 'field.sector',
		kind: 'field',
		label: 'Sector',
		description: 'GICS-style sector classification.',
		aliases: ['sector', 'gics sector'],
		tags: ['classification', 'reference-data'],
		valueType: 'enum',
		nullable: true,
		availability: unavailable(NO_REFERENCE_DATA, true)
	},
	{
		id: 'field.industry',
		kind: 'field',
		label: 'Industry',
		description: 'Industry classification within a sector.',
		aliases: ['industry', 'sub-industry'],
		tags: ['classification', 'reference-data'],
		valueType: 'enum',
		nullable: true,
		availability: unavailable(NO_REFERENCE_DATA, true)
	},
	{
		id: 'field.country',
		kind: 'field',
		label: 'Country',
		description: 'ISO 3166-1 alpha-2 country of listing.',
		aliases: ['country', 'domicile'],
		tags: ['classification', 'reference-data'],
		valueType: 'string',
		nullable: true,
		availability: unavailable(NO_REFERENCE_DATA, true)
	},
	{
		id: 'field.exchange',
		kind: 'field',
		label: 'Exchange',
		description: 'Listing venue, identified by MIC.',
		aliases: ['exchange', 'venue', 'mic'],
		tags: ['classification', 'reference-data'],
		valueType: 'string',
		nullable: true,
		availability: unavailable(NO_REFERENCE_DATA, true)
	},
	{
		id: 'field.index_membership',
		kind: 'field',
		label: 'Index membership',
		description: 'Indexes the instrument is a constituent of.',
		aliases: ['index', 'index membership', 'constituent'],
		tags: ['classification', 'reference-data'],
		valueType: 'enum',
		nullable: true,
		availability: unavailable(NO_REFERENCE_DATA, true)
	},
	{
		id: 'field.market_cap',
		kind: 'field',
		label: 'Market capitalisation',
		description: 'Shares outstanding times price.',
		aliases: ['market cap', 'mcap', 'capitalisation', 'capitalization'],
		tags: ['size', 'reference-data'],
		valueType: 'number',
		unit: 'currency',
		range: { min: 0 },
		nullable: true,
		availability: unavailable(NO_REFERENCE_DATA, true)
	},
	{
		id: 'field.fundamentals.pe_ratio',
		kind: 'field',
		label: 'P/E ratio',
		description: 'Price divided by trailing twelve-month earnings per share.',
		aliases: ['pe', 'p/e', 'price to earnings', 'earnings multiple'],
		tags: ['fundamentals', 'reference-data'],
		valueType: 'number',
		nullable: true,
		reportingBasis: 'trailing_twelve_months',
		availability: unavailable(NO_FUNDAMENTALS, true)
	},
	{
		id: 'field.fundamentals.revenue',
		kind: 'field',
		label: 'Revenue',
		description: 'Reported revenue for the fiscal period.',
		aliases: ['revenue', 'sales', 'top line'],
		tags: ['fundamentals', 'reference-data'],
		valueType: 'number',
		unit: 'currency',
		nullable: true,
		reportingBasis: 'fiscal_quarter',
		availability: unavailable(NO_FUNDAMENTALS, true)
	},
	{
		id: 'field.earnings.next_report_date',
		kind: 'field',
		label: 'Next earnings date',
		description: 'Date of the next scheduled earnings report.',
		aliases: ['next earnings', 'earnings date', 'report date'],
		tags: ['earnings', 'calendar', 'reference-data'],
		valueType: 'date',
		nullable: true,
		availability: unavailable(NO_FUNDAMENTALS, true)
	},
	{
		id: 'field.earnings.days_since_report',
		kind: 'field',
		label: 'Days since earnings',
		description: 'Trading days since the most recent earnings report.',
		aliases: ['days since earnings', 'post earnings drift window'],
		tags: ['earnings', 'calendar', 'reference-data'],
		valueType: 'number',
		unit: 'days',
		range: { min: 0 },
		nullable: true,
		availability: unavailable(NO_FUNDAMENTALS, true)
	}
];

// Spans all eight condition families tool-spec.md's `edit_filter_tree` names,
// so EPIC-1009 can build every condition type against declared entries rather
// than a hard-coded string list.
const OPERATORS: CatalogItem[] = [
	{
		id: 'op.greater_than',
		kind: 'operator',
		label: 'is greater than',
		description: 'Field value is strictly above a constant.',
		aliases: ['above', 'over', 'more than', 'gt', '>'],
		tags: ['comparison'],
		arity: 2,
		operandTypes: ['number', 'date'],
		resultType: 'boolean',
		conditionFamily: 'scalar',
		availability: logicOnly()
	},
	{
		id: 'op.less_than',
		kind: 'operator',
		label: 'is less than',
		description: 'Field value is strictly below a constant.',
		aliases: ['below', 'under', 'lt', '<'],
		tags: ['comparison'],
		arity: 2,
		operandTypes: ['number', 'date'],
		resultType: 'boolean',
		conditionFamily: 'scalar',
		availability: logicOnly()
	},
	{
		id: 'op.equals',
		kind: 'operator',
		label: 'equals',
		description: 'Field value equals a constant. Works on enums and strings as well as numbers.',
		aliases: ['is', 'equal to', 'eq', '=='],
		tags: ['comparison'],
		arity: 2,
		operandTypes: ['number', 'string', 'boolean', 'date', 'enum'],
		resultType: 'boolean',
		conditionFamily: 'scalar',
		availability: logicOnly()
	},
	{
		id: 'op.between',
		kind: 'operator',
		label: 'is between',
		description: 'Field value falls within an inclusive lower and upper bound.',
		aliases: ['in range', 'within range', 'from to'],
		tags: ['comparison', 'range'],
		arity: 3,
		operandTypes: ['number', 'date'],
		resultType: 'boolean',
		conditionFamily: 'range',
		availability: logicOnly()
	},
	{
		id: 'op.crosses_above',
		kind: 'operator',
		label: 'crosses above',
		description:
			'Series rises through another series or level between the previous bar and this one.',
		aliases: ['crosses over', 'breaks above', 'golden cross'],
		tags: ['series', 'crossover'],
		arity: 2,
		operandTypes: ['number'],
		resultType: 'boolean',
		conditionFamily: 'series_comparison',
		availability: logicOnly()
	},
	{
		id: 'op.crosses_below',
		kind: 'operator',
		label: 'crosses below',
		description:
			'Series falls through another series or level between the previous bar and this one.',
		aliases: ['crosses under', 'breaks below', 'death cross'],
		tags: ['series', 'crossover'],
		arity: 2,
		operandTypes: ['number'],
		resultType: 'boolean',
		conditionFamily: 'series_comparison',
		availability: logicOnly()
	},
	{
		id: 'op.sustained_for',
		kind: 'operator',
		label: 'has held for',
		description: 'Inner condition has been true on every bar of the trailing window.',
		aliases: ['sustained', 'held for', 'true for', 'consecutively'],
		tags: ['time'],
		arity: 2,
		operandTypes: ['boolean'],
		resultType: 'boolean',
		conditionFamily: 'temporal',
		availability: logicOnly()
	},
	{
		id: 'op.occurred_within',
		kind: 'operator',
		label: 'occurred within',
		description: 'Inner condition was true at least once in the trailing window of bars.',
		aliases: ['within', 'in the last', 'recently'],
		tags: ['time'],
		arity: 2,
		operandTypes: ['boolean'],
		resultType: 'boolean',
		conditionFamily: 'temporal',
		availability: logicOnly()
	},
	{
		id: 'op.days_since_event',
		kind: 'operator',
		label: 'days since event',
		description: 'Trading days since a named event last occurred, compared against a bound.',
		aliases: ['since earnings', 'days since', 'bars since'],
		tags: ['time', 'events'],
		arity: 3,
		operandTypes: ['number', 'date'],
		resultType: 'boolean',
		conditionFamily: 'event_relative',
		availability: logicOnly()
	},
	{
		id: 'op.matches_pattern',
		kind: 'operator',
		label: 'matches pattern',
		description: 'Bar sequence matches a named pattern from the pattern catalog.',
		aliases: ['forms', 'is a', 'pattern is'],
		tags: ['pattern'],
		arity: 2,
		operandTypes: ['enum'],
		resultType: 'boolean',
		conditionFamily: 'pattern',
		availability: logicOnly()
	},
	{
		id: 'op.percentile_rank_above',
		kind: 'operator',
		label: 'ranks above percentile',
		description:
			'Field value ranks above a percentile of the current universe, not an absolute level.',
		aliases: ['top percent', 'percentile', 'ranks above', 'relative to universe'],
		tags: ['ranking', 'relative'],
		arity: 2,
		operandTypes: ['number'],
		resultType: 'boolean',
		conditionFamily: 'relative',
		availability: logicOnly()
	},
	{
		id: 'op.study_output_above',
		kind: 'operator',
		label: 'study output is above',
		description: 'A named output of a configured study is above a level, e.g. RSI above 70.',
		aliases: ['indicator above', 'study above', 'rsi above'],
		tags: ['studies'],
		arity: 3,
		operandTypes: ['number'],
		resultType: 'boolean',
		conditionFamily: 'study_output',
		availability: logicOnly()
	}
];

const LENGTH_PARAM = {
	name: 'length',
	valueType: 'number' as const,
	unit: 'bars',
	defaultValue: 20,
	range: { min: 1, max: 500 },
	required: false
};

const STUDIES: CatalogItem[] = [
	{
		id: 'study.sma',
		kind: 'study',
		label: 'Simple moving average',
		description: 'Unweighted mean of the source series over a trailing window.',
		aliases: ['sma', 'moving average', 'ma', 'simple ma'],
		tags: ['trend', 'overlay'],
		parameters: [LENGTH_PARAM],
		outputs: [{ name: 'sma', valueType: 'number', unit: 'currency' }],
		defaultIntervalId: 'interval.1d',
		availability: available()
	},
	{
		id: 'study.ema',
		kind: 'study',
		label: 'Exponential moving average',
		description: 'Exponentially weighted mean of the source series, including the current bar.',
		aliases: ['ema', 'exponential moving average', 'exponential ma'],
		tags: ['trend', 'overlay'],
		parameters: [LENGTH_PARAM],
		outputs: [{ name: 'ema', valueType: 'number', unit: 'currency' }],
		defaultIntervalId: 'interval.1d',
		availability: available()
	},
	{
		id: 'study.atr',
		kind: 'study',
		label: 'Average true range',
		description: 'Mean true range over a trailing window; a volatility measure in price units.',
		aliases: ['atr', 'average true range', 'volatility'],
		tags: ['volatility'],
		parameters: [{ ...LENGTH_PARAM, defaultValue: 14 }],
		outputs: [{ name: 'atr', valueType: 'number', unit: 'currency', range: { min: 0 } }],
		defaultIntervalId: 'interval.1d',
		availability: available()
	},
	{
		id: 'study.rsi',
		kind: 'study',
		label: 'Relative strength index',
		description: 'Momentum oscillator bounded 0-100; conventionally overbought above 70.',
		aliases: ['rsi', 'relative strength', 'oscillator'],
		tags: ['momentum', 'oscillator'],
		parameters: [{ ...LENGTH_PARAM, defaultValue: 14, range: { min: 2, max: 200 } }],
		outputs: [{ name: 'rsi', valueType: 'number', range: { min: 0, max: 100 } }],
		defaultIntervalId: 'interval.1d',
		availability: unavailable(ENGINE_FUNCTIONS)
	},
	{
		id: 'study.macd',
		kind: 'study',
		label: 'MACD',
		description: 'Difference of two exponential moving averages, with a signal line and histogram.',
		aliases: ['macd', 'moving average convergence divergence'],
		tags: ['momentum', 'trend'],
		parameters: [
			{
				name: 'fast',
				valueType: 'number',
				unit: 'bars',
				defaultValue: 12,
				range: { min: 1 },
				required: false
			},
			{
				name: 'slow',
				valueType: 'number',
				unit: 'bars',
				defaultValue: 26,
				range: { min: 2 },
				required: false
			},
			{
				name: 'signal',
				valueType: 'number',
				unit: 'bars',
				defaultValue: 9,
				range: { min: 1 },
				required: false
			}
		],
		outputs: [
			{ name: 'macd', valueType: 'number' },
			{ name: 'signal', valueType: 'number' },
			{ name: 'histogram', valueType: 'number' }
		],
		defaultIntervalId: 'interval.1d',
		availability: unavailable(ENGINE_FUNCTIONS)
	},
	{
		id: 'study.bollinger_bands',
		kind: 'study',
		label: 'Bollinger Bands',
		description: 'Moving average with bands a number of standard deviations above and below it.',
		aliases: ['bollinger', 'bands', 'bbands', 'volatility bands'],
		tags: ['volatility', 'overlay'],
		parameters: [
			{ ...LENGTH_PARAM, defaultValue: 20 },
			{
				name: 'stdDev',
				valueType: 'number',
				defaultValue: 2,
				range: { min: 0.1, max: 10 },
				required: false
			}
		],
		outputs: [
			{ name: 'upper', valueType: 'number', unit: 'currency' },
			{ name: 'middle', valueType: 'number', unit: 'currency' },
			{ name: 'lower', valueType: 'number', unit: 'currency' }
		],
		defaultIntervalId: 'interval.1d',
		availability: unavailable(ENGINE_FUNCTIONS)
	},
	{
		id: 'study.vwap',
		kind: 'study',
		label: 'Volume-weighted average price',
		description: 'Cumulative price weighted by volume across the session.',
		aliases: ['vwap', 'volume weighted average price'],
		tags: ['volume', 'intraday', 'overlay'],
		parameters: [
			{
				name: 'anchor',
				valueType: 'enum',
				defaultValue: 'session',
				enumValues: ['session', 'week', 'month'],
				required: false
			}
		],
		outputs: [{ name: 'vwap', valueType: 'number', unit: 'currency' }],
		defaultIntervalId: 'interval.1d',
		availability: unavailable(NO_INTRADAY)
	}
];

const INDICATORS: CatalogItem[] = [
	{
		id: 'indicator.relative_volume',
		kind: 'indicator',
		label: 'Relative volume',
		description: 'Session volume divided by its trailing average. 1.5 means half again as busy.',
		aliases: ['relative volume', 'rvol', 'volume ratio', 'unusual volume'],
		tags: ['volume', 'ranking'],
		parameters: [LENGTH_PARAM],
		outputs: [{ name: 'relative_volume', valueType: 'number', range: { min: 0 } }],
		defaultIntervalId: 'interval.1d',
		availability: available()
	},
	{
		id: 'indicator.atr_percent',
		kind: 'indicator',
		label: 'ATR percent',
		description:
			'Average true range as a percentage of price, so volatility compares across names.',
		aliases: ['atr percent', 'atr%', 'normalised volatility'],
		tags: ['volatility', 'ranking'],
		parameters: [{ ...LENGTH_PARAM, defaultValue: 14 }],
		outputs: [{ name: 'atr_percent', valueType: 'number', unit: 'percent', range: { min: 0 } }],
		defaultIntervalId: 'interval.1d',
		availability: available()
	},
	{
		id: 'indicator.gap_percent',
		kind: 'indicator',
		label: 'Gap percent',
		description: "Today's open against the previous close, as a percentage.",
		aliases: ['gap', 'gap percent', 'gap up', 'gap down', 'overnight move'],
		tags: ['momentum', 'ranking'],
		parameters: [],
		outputs: [{ name: 'gap_percent', valueType: 'number', unit: 'percent' }],
		defaultIntervalId: 'interval.1d',
		availability: unavailable(NO_BAR_OFFSET)
	}
];

const PATTERNS: CatalogItem[] = [
	{
		id: 'pattern.bull_flag',
		kind: 'pattern',
		label: 'Bull flag',
		description: 'Sharp advance followed by a shallow, contracting pullback.',
		aliases: ['bull flag', 'flag', 'continuation'],
		tags: ['continuation', 'bullish'],
		parameters: [
			{ ...LENGTH_PARAM, name: 'poleBars', defaultValue: 5 },
			{ ...LENGTH_PARAM, name: 'flagBars', defaultValue: 5 }
		],
		outputs: [{ name: 'matched', valueType: 'boolean' }],
		defaultIntervalId: 'interval.1d',
		availability: unavailable(NO_PATTERN_ENGINE)
	},
	{
		id: 'pattern.inside_day',
		kind: 'pattern',
		label: 'Inside day',
		description: "A session whose range sits entirely inside the previous session's range.",
		aliases: ['inside day', 'inside bar', 'range contraction'],
		tags: ['contraction'],
		parameters: [],
		outputs: [{ name: 'matched', valueType: 'boolean' }],
		defaultIntervalId: 'interval.1d',
		availability: unavailable(NO_PATTERN_ENGINE)
	},
	{
		id: 'pattern.gap_up',
		kind: 'pattern',
		label: 'Gap up',
		description: 'Session opens above the previous session high.',
		aliases: ['gap up', 'breakaway gap'],
		tags: ['momentum', 'bullish'],
		parameters: [
			{
				name: 'minGapPercent',
				valueType: 'number',
				unit: 'percent',
				defaultValue: 2,
				range: { min: 0 },
				required: false
			}
		],
		outputs: [{ name: 'matched', valueType: 'boolean' }],
		defaultIntervalId: 'interval.1d',
		availability: unavailable(NO_PATTERN_ENGINE)
	}
];

const UNIVERSES: CatalogItem[] = [
	{
		id: 'universe.us_equities',
		kind: 'universe',
		label: 'US equities',
		description: 'All US-listed common shares.',
		aliases: ['us stocks', 'all us equities', 'us equities'],
		tags: ['country', 'reference-data'],
		membershipSource:
			'A periodic Nasdaq stock-screener CSV export, parsed backend-side for ' +
			'pattern-research universe filtering. Not exposed to this surface.',
		availability: unavailable(NO_REFERENCE_DATA, true)
	},
	{
		id: 'universe.sp500',
		kind: 'universe',
		label: 'S&P 500',
		description: 'Constituents of the S&P 500 index.',
		aliases: ['sp500', 's&p 500', 'spx', 'large cap index'],
		tags: ['index', 'reference-data'],
		membershipSource: 'Index constituent list from an index-membership provider.',
		approximateSize: 500,
		availability: unavailable(NO_REFERENCE_DATA, true)
	},
	{
		id: 'universe.nasdaq100',
		kind: 'universe',
		label: 'Nasdaq 100',
		description: 'Constituents of the Nasdaq-100 index.',
		aliases: ['nasdaq 100', 'ndx', 'qqq'],
		tags: ['index', 'reference-data'],
		membershipSource: 'Index constituent list from an index-membership provider.',
		approximateSize: 100,
		availability: unavailable(NO_REFERENCE_DATA, true)
	},
	{
		id: 'universe.watchlist',
		kind: 'universe',
		label: 'Watchlist',
		description: 'An explicit list of instruments supplied by the user.',
		aliases: ['watchlist', 'my list', 'custom list'],
		tags: ['user-defined'],
		membershipSource: 'Instrument IDs supplied by the user or agent at screen time.',
		availability: unavailable(
			'Watchlists are declared for discovery only. No tool on this surface ' +
				'accepts or stores one yet.'
		)
	}
];

const TEMPLATES: CatalogItem[] = [
	{
		id: 'template.momentum_breakout',
		kind: 'template',
		label: 'Momentum breakout screen',
		description: 'Starting filter tree for names breaking out on above-average volume.',
		aliases: ['breakout', 'momentum screen', 'breakout screen'],
		tags: ['screener', 'momentum'],
		appliesTo: 'screener',
		summary: 'Price at a trailing high, relative volume above 1.5, ATR percent above the median.',
		availability: unavailable(NO_TEMPLATE_CONSUMER)
	},
	{
		id: 'template.mean_reversion',
		kind: 'template',
		label: 'Mean reversion screen',
		description: 'Starting filter tree for stretched names likely to snap back.',
		aliases: ['mean reversion', 'oversold screen', 'pullback screen'],
		tags: ['screener', 'reversion'],
		appliesTo: 'screener',
		summary: 'RSI below 30, price below its 20-bar moving average, volume not collapsing.',
		availability: unavailable(NO_TEMPLATE_CONSUMER)
	},
	{
		id: 'template.price_volume_chart',
		kind: 'template',
		label: 'Price and volume chart',
		description: 'Default chart layout: candles with a volume pane and a 20-bar moving average.',
		aliases: ['default chart', 'price volume', 'standard chart'],
		tags: ['chart'],
		appliesTo: 'chart',
		summary: 'Daily candles, volume subpanel, SMA(20) overlay.',
		availability: unavailable(NO_TEMPLATE_CONSUMER)
	}
];

export const CATALOG_ITEMS: readonly CatalogItem[] = [
	...INTERVALS,
	...PRICE_FIELDS,
	...OTHER_MARKET_FIELDS,
	...REFERENCE_FIELDS,
	...OPERATORS,
	...STUDIES,
	...INDICATORS,
	...PATTERNS,
	...UNIVERSES,
	...TEMPLATES
];
