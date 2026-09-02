// The wire face of the bounded read. These tests care about what an agent can
// actually ask for and what it gets told: the schema is as much a part of the
// boundedness guarantee as the handler, because a field that does not exist
// cannot be used to page.
import { describe, expect, it } from 'vitest';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import { emptyWorkspace, type WorkspaceDocument } from '../../domain/workspace';
import { createChartState, writeChartState, type ChartState } from '../domain/chartState';
import type { InstrumentRef } from '../domain/instrument';
import type { OhlcvBar } from '../domain/seriesPort';
import type { StudyInstance } from '../domain/studies';
import {
	createInMemoryChartSeries,
	type InMemoryChartSeriesFixture
} from '../infra/inMemoryChartSeries';
import { CHART_DATA_BAR_CAP } from '../application/chartData';
import { buildGetChartDataTool, GET_CHART_DATA_TOOL_NAME } from './getChartData';

const CLOCK: Clock = { now: () => '2026-09-02T20:00:00.000Z' };
const PANEL_ID = 'panel_1';

const NVDA: InstrumentRef = {
	instrumentId: 'inst:XNAS:NVDA',
	symbol: 'NVDA',
	exchange: 'XNAS',
	assetType: 'equity'
};

function dailyBars(count: number): OhlcvBar[] {
	const bars: OhlcvBar[] = [];
	for (let i = 0; i < count; i += 1) {
		const at = new Date(Date.UTC(2026, 0, 2));
		at.setUTCDate(at.getUTCDate() + i);
		const close = 100 + i;
		bars.push({
			time: at.toISOString().slice(0, 10),
			open: close - 1,
			high: close + 2,
			low: close - 3,
			close,
			volume: 1_000 + i
		});
	}
	return bars;
}

const RSI: StudyInstance = {
	id: 'study_1',
	catalogItemId: 'study.rsi',
	params: { length: 14 },
	pane: 'sub_pane',
	order: 0,
	enabled: true
};

function chartState(): ChartState {
	const state = createChartState(PANEL_ID);
	state.config.instrument = NVDA;
	state.config.range = {
		kind: 'explicit',
		start: '2026-01-01T00:00:00.000Z',
		end: '2028-01-01T00:00:00.000Z'
	};
	state.studies = [RSI];
	return state;
}

interface Harness {
	tool: ToolSpec;
	writes: WorkspaceDocument[];
	document(): WorkspaceDocument;
}

function harness(barCount = 30): Harness {
	let current = writeChartState(
		emptyWorkspace('workspace_1', 'Research', CLOCK.now()),
		chartState()
	);
	const writes: WorkspaceDocument[] = [];
	const repository: WorkspaceRepository = {
		list: () => [],
		get: (id) => (id === current.id ? current : null),
		put: (doc) => {
			writes.push(doc);
			current = doc;
		},
		getActiveId: () => current.id,
		setActiveId: () => undefined,
		listRevisions: () => [],
		getRevision: () => null,
		putRevision: () => undefined
	};
	const series = createInMemoryChartSeries({
		clock: CLOCK,
		series: [
			{
				instrumentId: NVDA.instrumentId,
				timeframe: '1d',
				bars: dailyBars(barCount),
				sourceAdjustment: 'adjusted',
				currency: 'USD',
				timezone: 'America/New_York',
				liveness: 'end_of_day'
			} as InMemoryChartSeriesFixture
		]
	});
	return {
		tool: buildGetChartDataTool({ repository, series, clock: CLOCK }),
		writes,
		document: () => current
	};
}

function payload(result: ToolResult): Record<string, unknown> {
	return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

async function call(h: Harness, input: Record<string, unknown>): Promise<ToolResult> {
	return h.tool.execute(input);
}

function schemaProperties(tool: ToolSpec): Record<string, unknown> {
	return (tool.inputSchema as { properties: Record<string, unknown> }).properties;
}

describe('the tool contract', () => {
	it('test_the_tool_is_named_get_chart_data_and_requires_a_panel', () => {
		const { tool } = harness();
		expect(tool.name, 'the spec names this tool get_chart_data').toBe(GET_CHART_DATA_TOOL_NAME);
		expect(tool.name, 'and that is the wire name').toBe('get_chart_data');
		expect(
			(tool.inputSchema as { required: string[] }).required,
			'a read is always about one chart panel'
		).toEqual(['panel_id']);
	});

	it('test_the_description_states_the_per_call_cap', () => {
		const { tool } = harness();
		expect(
			tool.description.includes(String(CHART_DATA_BAR_CAP)),
			`the cap must be discoverable before a call, got: ${tool.description}`
		).toBe(true);
	});

	it('test_the_description_says_there_is_no_pagination', () => {
		const { tool } = harness();
		expect(tool.description, 'an agent should not have to discover this by trying').toContain(
			'no pagination'
		);
	});

	it('test_the_schema_offers_no_paging_parameter', () => {
		const properties = schemaProperties(harness().tool);
		const windowProperties = (properties.window as { properties: Record<string, unknown> })
			.properties;
		for (const forbidden of ['cursor', 'page', 'page_token', 'offset', 'after', 'continuation']) {
			expect(properties[forbidden], `the tool must not accept ${forbidden}`).toBeUndefined();
			expect(
				windowProperties[forbidden],
				`the window must not accept ${forbidden} either`
			).toBeUndefined();
		}
	});
});

describe('window forms on the wire', () => {
	it('test_omitting_the_window_reads_the_visible_range_and_says_so', async () => {
		const h = harness();
		const body = payload(await call(h, { panel_id: PANEL_ID }));
		const window = body.window as Record<string, unknown>;
		expect(window.form, 'an unnamed window is the visible range').toBe('visible_range');
		expect(window.is_chart_visible_range, 'the result says which range it used').toBe(true);
	});

	it('test_last_n_bars_is_accepted', async () => {
		const h = harness();
		const body = payload(await call(h, { panel_id: PANEL_ID, window: { last_n_bars: 5 } }));
		expect(body.bar_count, 'five bars were asked for').toBe(5);
	});

	it('test_an_explicit_start_and_end_is_accepted', async () => {
		const h = harness();
		const body = payload(
			await call(h, { panel_id: PANEL_ID, window: { start: '2026-01-05', end: '2026-01-09' } })
		);
		expect(body.bar_count, 'five consecutive days').toBe(5);
	});

	it('test_an_anchored_window_is_accepted', async () => {
		const h = harness();
		const body = payload(
			await call(h, {
				panel_id: PANEL_ID,
				window: { anchor_time: '2026-01-12', bars_before: 2, bars_after: 3 }
			})
		);
		expect(body.bar_count, 'two before, the anchor, three after').toBe(6);
	});

	it('test_mixing_two_window_forms_is_refused_rather_than_ranked', async () => {
		const h = harness();
		const result = await call(h, {
			panel_id: PANEL_ID,
			window: { last_n_bars: 5, start: '2026-01-05', end: '2026-01-09' }
		});
		expect(result.isError, 'an ambiguous window has no correct default').toBe(true);
		expect(payload(result).message, 'the caller is told to pick one').toContain('exactly one form');
	});

	it('test_a_missing_panel_id_is_refused', async () => {
		const result = await call(harness(), {});
		expect(result.isError, 'a read is always about a named panel').toBe(true);
		expect(payload(result).error, 'the failure names the field').toBe('invalid_request');
	});
});

describe('refusals reach the wire intact', () => {
	it('test_over_the_cap_fails_with_the_cap_the_count_and_remedies', async () => {
		const h = harness(600);
		const result = await call(h, { panel_id: PANEL_ID });
		expect(result.isError, 'over the cap is a failure, not a short result').toBe(true);
		const body = payload(result);
		expect(body.error, 'the reason is machine-readable').toBe('window_over_bar_cap');
		expect(body.bar_cap, 'the cap is stated').toBe(CHART_DATA_BAR_CAP);
		expect(body.bars_in_window, 'so is what the window holds').toBe(600);
		expect((body.remedies as string[]).length, 'with at least two ways out').toBeGreaterThanOrEqual(
			2
		);
		expect(body.bars, 'no partial series may be handed back').toBeUndefined();
	});

	it('test_a_window_outside_the_chart_range_fails_pointing_at_the_configuration', async () => {
		const h = harness();
		const result = await call(h, {
			panel_id: PANEL_ID,
			window: { start: '2020-01-01', end: '2026-01-09' }
		});
		expect(result.isError, 'a read cannot reach past the chart').toBe(true);
		expect(payload(result).error, 'the reason is machine-readable').toBe(
			'window_outside_chart_range'
		);
		expect(payload(result).chart_range, "the chart's own range is handed back").toBeDefined();
	});

	it('test_an_unknown_aggregation_timeframe_is_refused', async () => {
		const result = await call(harness(), { panel_id: PANEL_ID, aggregate_to: '3d' });
		expect(result.isError, '3d is not a timeframe this chart knows').toBe(true);
		expect(payload(result).error, 'the reason is machine-readable').toBe('invalid_aggregation');
	});
});

describe('the tool is a read', () => {
	it('test_expected_revision_is_not_in_the_schema', () => {
		expect(
			schemaProperties(harness().tool).expected_revision,
			'a read has no revision to guard'
		).toBeUndefined();
	});

	it('test_supplying_expected_revision_is_refused_rather_than_ignored', async () => {
		const result = await call(harness(), { panel_id: PANEL_ID, expected_revision: 3 });
		expect(result.isError, 'silently ignoring it would imply a guarantee that is not there').toBe(
			true
		);
		expect(payload(result).error, 'the reason says the tool is a read').toBe('read_only_tool');
	});

	it('test_calling_the_tool_writes_nothing_and_moves_no_revision', async () => {
		const h = harness();
		const before = h.document().revision;
		await call(h, { panel_id: PANEL_ID });
		await call(h, { panel_id: PANEL_ID, window: { last_n_bars: 5 } });
		expect(h.writes.length, 'a read must never write the workspace').toBe(0);
		expect(h.document().revision, 'the revision is untouched').toBe(before);
	});
});

describe('what a successful payload carries', () => {
	it('test_the_payload_states_the_cap_the_bars_and_the_aligned_studies', async () => {
		const h = harness();
		const body = payload(await call(h, { panel_id: PANEL_ID }));
		expect(body.bar_cap, 'the cap is stated in the result').toBe(CHART_DATA_BAR_CAP);
		expect((body.bars as unknown[]).length, 'thirty bars are in the chart range').toBe(30);
		const study = (body.studies as Record<string, unknown>[])[0];
		expect(study?.study_id, 'the study keeps its stable ID').toBe('study_1');
		const rsi = (study?.outputs as Record<string, unknown[]>).rsi ?? [];
		expect(rsi.length, 'one study value per bar').toBe(30);
		expect(rsi[0], 'the first bar is inside the warm-up and has no value').toBeNull();
	});

	it('test_the_payload_carries_provenance_and_the_applied_adjustment', async () => {
		const body = payload(await call(harness(), { panel_id: PANEL_ID }));
		const provenance = body.provenance as Record<string, unknown>;
		expect(provenance.engine_version, 'the calculation engine version travels along').toBeDefined();
		expect(provenance.as_of, 'so does the as-of instant').toBeDefined();
		expect(body.price_adjustment, 'both the chart policy and what was applied').toEqual({
			chart_policy: 'adjusted',
			applied: 'adjusted'
		});
	});

	it('test_an_aggregated_payload_is_labelled_on_the_wire', async () => {
		const body = payload(await call(harness(600), { panel_id: PANEL_ID, aggregate_to: '1wk' }));
		expect(body.aggregated, 'aggregated bars must say so').toBe(true);
		expect(body.timeframe, 'the returned bars are weekly').toBe('1wk');
		expect(body.source_timeframe, "the chart's own timeframe is still reported").toBe('1d');
		expect((body.aggregation as Record<string, unknown>).method, 'and how they were made').toBe(
			'ohlcv_rollup'
		);
	});

	it('test_no_key_anywhere_in_the_payload_offers_a_next_page', async () => {
		const forbidden = [
			'cursor',
			'next_cursor',
			'next',
			'next_page',
			'page',
			'page_token',
			'has_more',
			'more',
			'offset',
			'continuation',
			'continuation_token',
			'token',
			'after',
			'before',
			'limit'
		];
		const keys: string[] = [];
		const walk = (value: unknown): void => {
			if (Array.isArray(value)) {
				value.forEach(walk);
				return;
			}
			if (typeof value === 'object' && value !== null) {
				for (const [key, child] of Object.entries(value)) {
					keys.push(key);
					walk(child);
				}
			}
		};
		walk(payload(await call(harness(), { panel_id: PANEL_ID })));
		const offending = keys.filter((key) => forbidden.includes(key));
		expect(offending, `nothing in the payload may be loopable, found ${offending}`).toEqual([]);
	});
});
