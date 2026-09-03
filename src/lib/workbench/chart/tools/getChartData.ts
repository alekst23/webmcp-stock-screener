// The `get_chart_data` tool: the wire face of the bounded read.
//
// This file does parsing and result shaping only. Every decision about what a
// read is allowed to return lives in the application module, so the tool cannot
// quietly widen a bound by being lenient about input.
//
// Exported as a factory rather than registered here: the composition root is
// T-1011-9's, and a module that registers itself on import cannot be built
// twice in a test.
import { fail, ok } from '../../../webmcp/toolResult';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import type { ResourceId } from '../../domain/ids';
import { isChartTimeframe, type ChartTimeframe } from '../domain/chartState';
import {
	CHART_DATA_BAR_CAP,
	readChartData,
	toWireChartData,
	toWireChartDataRefusal,
	type ChartDataDeps,
	type ChartDataRequest,
	type ChartDataWindowRequest
} from '../application/chartData';

export const GET_CHART_DATA_TOOL_NAME = 'get_chart_data';

export type GetChartDataDeps = ChartDataDeps;

interface ParsedRequest {
	ok: true;
	request: ChartDataRequest;
}

interface ParseFailure {
	ok: false;
	error: string;
	message: string;
	remedies: string[];
}

function invalid(message: string, remedies: string[], error = 'invalid_window'): ParseFailure {
	return { ok: false, error, message, remedies };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerOr(value: unknown, fallback: number): number {
	return value === undefined ? fallback : (value as number);
}

// Exactly one form per call. Naming fields from two of them is ambiguous in a
// way no default can resolve -- "the last 50 bars, but also from March" has no
// single meaning -- so it is refused rather than silently ranked.
function parseWindow(value: unknown): ChartDataWindowRequest | ParseFailure {
	if (value === undefined || value === null) {
		return { form: 'visible_range' };
	}
	if (!isRecord(value)) {
		return invalid('window: expected an object naming exactly one window form.', [
			'Use {start, end}, {last_n_bars}, or {anchor_time, bars_before, bars_after}.',
			"Omit window entirely to read the chart's visible range."
		]);
	}
	const forms = [
		value.start !== undefined || value.end !== undefined ? 'explicit' : null,
		value.last_n_bars !== undefined ? 'last_n_bars' : null,
		value.anchor_time !== undefined ||
		value.bars_before !== undefined ||
		value.bars_after !== undefined
			? 'anchored'
			: null
	].filter((form): form is string => form !== null);
	if (forms.length > 1) {
		return invalid(`window: name exactly one form, not ${forms.join(' and ')}.`, [
			'Send one of {start, end}, {last_n_bars}, or {anchor_time, bars_before, bars_after}.',
			'Make two separately bounded calls if you want two slices.'
		]);
	}
	if (forms.length === 0) {
		return { form: 'visible_range' };
	}
	if (forms[0] === 'explicit') {
		if (typeof value.start !== 'string' || typeof value.end !== 'string') {
			return invalid('window: an explicit window needs both start and end as ISO timestamps.', [
				'Supply both window.start and window.end.',
				'Use last_n_bars instead if you only know how many bars you want.'
			]);
		}
		return { form: 'explicit', start: value.start, end: value.end };
	}
	if (forms[0] === 'last_n_bars') {
		return { form: 'last_n_bars', lastNBars: value.last_n_bars as number };
	}
	if (typeof value.anchor_time !== 'string') {
		return invalid('window: an anchored window needs anchor_time as an ISO timestamp.', [
			'Supply window.anchor_time.',
			'Use {start, end} if you want to name the bounds directly.'
		]);
	}
	return {
		form: 'anchored',
		anchorTime: value.anchor_time,
		barsBefore: integerOr(value.bars_before, 0),
		barsAfter: integerOr(value.bars_after, 0)
	};
}

function parseAggregateTo(value: unknown): ChartTimeframe | ParseFailure | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (!isChartTimeframe(value)) {
		return invalid(
			`aggregate_to: "${String(value)}" is not a supported timeframe.`,
			['Use one of 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1wk, 1mo.', 'Omit aggregate_to for raw bars.'],
			'invalid_aggregation'
		);
	}
	return value;
}

function isParseFailure(value: unknown): value is ParseFailure {
	return isRecord(value) && value.ok === false;
}

function parseInput(raw: unknown): ParsedRequest | ParseFailure {
	const input = (raw ?? {}) as Record<string, unknown>;
	// Accepting a revision guard on a read would let an agent believe it had a
	// concurrency guarantee this call cannot give it: nothing here writes, so
	// there is no revision to guard against.
	if (input.expected_revision !== undefined) {
		return invalid(
			`${GET_CHART_DATA_TOOL_NAME} is a read and takes no expected_revision: it changes no ` +
				'state, so there is no revision for it to guard.',
			['Drop expected_revision and call again.', 'Guard the chart mutation instead.'],
			'read_only_tool'
		);
	}
	if (typeof input.panel_id !== 'string' || input.panel_id.length === 0) {
		return invalid(
			'panel_id: expected the stable ID of a chart panel.',
			['Name the chart panel to read.', 'Read the canvas state to list the panels.'],
			'invalid_request'
		);
	}
	const window = parseWindow(input.window);
	if (isParseFailure(window)) {
		return window;
	}
	const aggregateTo = parseAggregateTo(input.aggregate_to);
	if (isParseFailure(aggregateTo)) {
		return aggregateTo;
	}
	return {
		ok: true,
		request: {
			panelId: input.panel_id as ResourceId,
			workspaceId:
				typeof input.workspace_id === 'string' ? (input.workspace_id as ResourceId) : undefined,
			window,
			aggregateTo
		}
	};
}

function getChartData(deps: GetChartDataDeps) {
	return async (raw: unknown): Promise<ToolResult> => {
		const parsed = parseInput(raw);
		if (isParseFailure(parsed)) {
			// `fail` puts its first argument under `error`, which the reason code
			// then overwrites, so the sentence has to be carried explicitly.
			return fail(parsed.message, {
				error: parsed.error,
				message: parsed.message,
				remedies: parsed.remedies
			});
		}
		const outcome = await readChartData(deps, parsed.request);
		return outcome.ok
			? ok(toWireChartData(outcome.data))
			: fail(outcome.refusal.message, toWireChartDataRefusal(outcome.refusal));
	};
}

// The cap is interpolated, never retyped, so the description can never drift
// from the limit the handler enforces.
const DESCRIPTION =
	'Reads a bounded slice of a chart panel: OHLCV bars plus every enabled study, index-aligned ' +
	'so a study value and its bar line up (warm-up bars are null, never substituted). Name the ' +
	'window as {start, end}, {last_n_bars}, or {anchor_time, bars_before, bars_after}; omit it ' +
	"for the chart's visible range. At most " +
	`${CHART_DATA_BAR_CAP} bars per call — a wider window is refused, never truncated, and the ` +
	'refusal names the remedies. There is no pagination: no cursor, no next page, no offset. ' +
	'Each call must be bounded by you. Reads cannot reach outside the range the chart is ' +
	'configured to show — change the chart first. Carries full market-data provenance and the ' +
	'price-adjustment basis the bars were actually computed under.';

export function buildGetChartDataTool(deps: GetChartDataDeps): ToolSpec {
	return {
		name: GET_CHART_DATA_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: {
			type: 'object',
			properties: {
				panel_id: { type: 'string', description: 'The chart panel to read.' },
				workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
				window: {
					type: 'object',
					description:
						"Exactly one form. Omit for the chart's visible range. There is deliberately no " +
						'offset or cursor here: narrow the window instead of paging.',
					properties: {
						start: { type: 'string', description: 'ISO timestamp, inclusive.' },
						end: { type: 'string', description: 'ISO timestamp, inclusive.' },
						last_n_bars: {
							type: 'integer',
							minimum: 1,
							description: "The most recent N bars inside the chart's range."
						},
						anchor_time: { type: 'string', description: 'ISO timestamp of the bar to centre on.' },
						bars_before: { type: 'integer', minimum: 0 },
						bars_after: { type: 'integer', minimum: 0 }
					}
				},
				aggregate_to: {
					type: 'string',
					enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1wk', '1mo'],
					description:
						'Roll the bars up to a strictly coarser timeframe so a wide window fits the cap. ' +
						'The result is labelled as aggregated.'
				}
			},
			required: ['panel_id']
		},
		available: () => true,
		execute: getChartData(deps)
	};
}
