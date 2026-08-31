import {
	ExpressionError,
	type DefineSetupInput,
	type DefineStudyInput,
	type FindInstancesInput,
	type FocusInstanceInput,
	type MeasureInput,
	type ResearchEngine,
	type SampleInstancesInput,
	type ShowGridInput,
	type ShowTickerChartsInput,
	type SplitInstancesInput,
	type ToolResult,
	type ToolSpec,
	type WorkspaceState
} from './types';

function ok(payload: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string, extra?: Record<string, unknown>): ToolResult {
	return {
		content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 2) }],
		isError: true
	};
}

// ExpressionError carries the function catalog back to the agent so a bad
// formula becomes a one-turn self-correction instead of a retry loop.
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
	try {
		return ok(await fn());
	} catch (e) {
		if (e instanceof ExpressionError) {
			return fail(e.message, { availableFunctions: e.catalog });
		}
		return fail(e instanceof Error ? e.message : String(e));
	}
}

const always = () => true;
const hasInstanceSets = (ws: WorkspaceState) => ws.instanceSets.length > 0;
const hasPanels = (ws: WorkspaceState) => ws.panels.length > 0;

const STRATEGY_SCHEMA = {
	type: 'string',
	enum: ['random', 'recent', 'best', 'worst'],
	description: 'How to pick instances. "best"/"worst" rank by forward return over horizonDays.'
};

export function buildTools(engine: ResearchEngine): ToolSpec[] {
	return [
		{
			name: 'defineStudy',
			description:
				'Define a named derived series over daily OHLCV data, e.g. relative volume or gap ' +
				'percentage. Returns a studyId usable in setup conditions, measure metrics, and grid ' +
				'overlays. Expressions combine series (open, high, low, close, volume) with functions ' +
				'like sma, ema, atr, highest, lowest, days_since. On a parse error the result lists ' +
				'every available function — use it to correct the expression.',
			inputSchema: {
				type: 'object',
				properties: {
					name: {
						type: 'string',
						description: 'Short snake_case name shown to the user, e.g. "rel_volume_20"'
					},
					expression: {
						type: 'string',
						description: 'Formula over price/volume series, e.g. "volume / sma(volume, 20)"'
					}
				},
				required: ['name', 'expression']
			},
			available: always,
			execute: (input) => run(() => engine.defineStudy(input as DefineStudyInput))
		},
		{
			name: 'defineSetup',
			description:
				'Define a temporal pattern as a sequence of condition steps. Each step is a boolean ' +
				'expression over series and studies; "within" gives the trading-day window after the ' +
				'previous step in which it must occur, and "sustained" requires it to hold on every day ' +
				'of that window. Example: earnings gap up, then 3-5 days of range contraction, then a ' +
				'breakout. Returns a setupId for findInstances.',
			inputSchema: {
				type: 'object',
				properties: {
					name: { type: 'string', description: 'Optional label shown to the user' },
					steps: {
						type: 'array',
						minItems: 1,
						items: {
							type: 'object',
							properties: {
								condition: {
									type: 'string',
									description: 'Boolean expression, e.g. "gap_pct > 4 AND days_since_earnings == 0"'
								},
								within: {
									type: 'array',
									items: { type: 'integer' },
									minItems: 2,
									maxItems: 2,
									description:
										'[min, max] trading days after the previous step. Omit for the first step.'
								},
								sustained: {
									type: 'boolean',
									description: 'Condition must hold on every day of the window, not just once'
								}
							},
							required: ['condition']
						}
					}
				},
				required: ['steps']
			},
			available: always,
			execute: (input) => run(() => engine.defineSetup(input as DefineSetupInput))
		},
		{
			name: 'findInstances',
			description:
				'Search the loaded universe for every (ticker, date) event matching a setup. Returns an ' +
				'instanceSetId plus count and date range. Instance sets are the input to ' +
				'sampleInstances, measure, splitInstances, and showGrid — those tools become available ' +
				'once the first set exists.',
			inputSchema: {
				type: 'object',
				properties: {
					setupId: { type: 'string' },
					from: { type: 'string', description: 'ISO date lower bound, e.g. "2015-01-01"' },
					to: { type: 'string', description: 'ISO date upper bound' },
					universe: {
						type: 'object',
						properties: {
							minMarketCap: { type: 'number', description: 'USD, e.g. 2e9 for mid-cap and up' },
							sectors: { type: 'array', items: { type: 'string' } }
						}
					}
				},
				required: ['setupId']
			},
			available: always,
			execute: (input) => run(() => engine.findInstances(input as FindInstancesInput))
		},
		{
			name: 'sampleInstances',
			description:
				'Return concrete (ticker, date) events from an instance set for inspection or ' +
				'discussion. Use showGrid instead when the goal is to put charts in front of the user.',
			inputSchema: {
				type: 'object',
				properties: {
					instanceSetId: { type: 'string' },
					n: { type: 'integer', default: 12 },
					strategy: STRATEGY_SCHEMA,
					horizonDays: { type: 'integer', description: 'Ranking horizon for best/worst' }
				},
				required: ['instanceSetId']
			},
			available: hasInstanceSets,
			execute: (input) => run(() => engine.sampleInstances(input as SampleInstancesInput))
		},
		{
			name: 'measure',
			description:
				'Measure a metric across every instance in a set and compare it to the universe base ' +
				'rate over the same period. Default metric is forward return from t=0 over horizonDays. ' +
				'Any study or expression works as a metric — use this to test whether something the ' +
				'user noticed visually (e.g. "volume dries up before the move") actually holds, and ' +
				'whether it beats the base rate.',
			inputSchema: {
				type: 'object',
				properties: {
					instanceSetId: { type: 'string' },
					metric: {
						type: 'string',
						description: 'Expression evaluated per instance; defaults to forward return'
					},
					horizonDays: { type: 'integer', description: 'Trading days after t=0' },
					compareToBaseRate: { type: 'boolean', default: true }
				},
				required: ['instanceSetId', 'horizonDays']
			},
			available: hasInstanceSets,
			execute: (input) => run(() => engine.measure(input as MeasureInput))
		},
		{
			name: 'splitInstances',
			description:
				'Split an instance set into labeled child sets. mode="outcome" splits winners from ' +
				'losers by forward return over horizonDays (optional threshold, default 0) — put the ' +
				'losers in a grid to see why the setup fails. mode="condition" splits by a boolean ' +
				"expression evaluated at each instance's t=0.",
			inputSchema: {
				type: 'object',
				properties: {
					instanceSetId: { type: 'string' },
					mode: { type: 'string', enum: ['outcome', 'condition'] },
					expression: { type: 'string', description: 'Required when mode="condition"' },
					horizonDays: { type: 'integer', description: 'Required when mode="outcome"' },
					threshold: { type: 'number', description: 'Win/loss boundary for mode="outcome"' }
				},
				required: ['instanceSetId', 'mode']
			},
			available: hasInstanceSets,
			execute: (input) => run(() => engine.splitInstances(input as SplitInstancesInput))
		},
		{
			name: 'showGrid',
			description:
				'Render a small-multiples grid panel the user can see: one mini-chart per instance, all ' +
				'aligned at t=0 (the event date), optionally normalized and overlaid with studies. This ' +
				'is the primary way to put evidence in front of the user — prefer it over describing ' +
				'instances in text. Returns a panelId.',
			inputSchema: {
				type: 'object',
				properties: {
					instanceSetId: { type: 'string' },
					n: { type: 'integer', default: 12 },
					strategy: STRATEGY_SCHEMA,
					window: {
						type: 'array',
						items: { type: 'integer' },
						minItems: 2,
						maxItems: 2,
						description: 'Trading days around t=0 to display, e.g. [-20, 20]'
					},
					overlayStudyIds: { type: 'array', items: { type: 'string' } },
					normalize: { type: 'boolean', description: 'Index each chart to 100 at t=0' }
				},
				required: ['instanceSetId']
			},
			available: hasInstanceSets,
			execute: (input) => run(() => engine.showGrid(input as ShowGridInput))
		},
		{
			name: 'showTickerCharts',
			description:
				'Render explicit ticker charts on the main page without first defining a setup. Use this ' +
				'when the user asks to see a named ticker such as MOCK02, with a date anchor and display ' +
				'window. For a roughly monthly chart, use window [-20, 0]. Returns a panelId.',
			inputSchema: {
				type: 'object',
				properties: {
					tickers: {
						type: 'array',
						items: { type: 'string' },
						minItems: 1,
						description: 'Ticker symbols to chart, e.g. ["MOCK02", "MOCK03"]'
					},
					date: {
						type: 'string',
						description: 'ISO anchor/end date for the chart window, e.g. "2025-12-31"'
					},
					window: {
						type: 'array',
						items: { type: 'integer' },
						minItems: 2,
						maxItems: 2,
						description: 'Trading days around the anchor date. Use [-20, 0] for monthly.'
					},
					title: { type: 'string' }
				},
				required: ['tickers', 'date']
			},
			available: always,
			execute: (input) => run(() => engine.showTickerCharts(input as ShowTickerChartsInput))
		},
		{
			name: 'clearPanels',
			description:
				'Clear every open chart/grid panel and reset current focus on the main page while keeping ' +
				'studies and result-set history available in the workspace.',
			inputSchema: { type: 'object', properties: {} },
			available: always,
			execute: () => run(() => engine.clearPanels())
		},
		{
			name: 'focusInstance',
			description:
				"Zoom the user's view to a single (ticker, date) instance for close inspection, e.g. " +
				'one the user asked about or an outlier worth discussing.',
			inputSchema: {
				type: 'object',
				properties: {
					ticker: { type: 'string' },
					date: { type: 'string', description: 'ISO date of the instance anchor' },
					panelId: { type: 'string', description: 'Panel to focus; defaults to the active panel' }
				},
				required: ['ticker', 'date']
			},
			available: hasPanels,
			execute: (input) => run(() => engine.focusInstance(input as FocusInstanceInput))
		},
		{
			name: 'getWorkspace',
			description:
				'Read the shared session state: defined studies and setups, instance sets, open panels, ' +
				'and — most importantly — what the user is currently focused on, including instances ' +
				'they selected by hand. Call this before acting on requests like "these ones" or "what ' +
				'do the charts I picked have in common".',
			inputSchema: { type: 'object', properties: {} },
			available: always,
			execute: () => run(() => engine.getWorkspace())
		}
	];
}
