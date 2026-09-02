// The bounded read, exercised through a bars port with real behavior rather
// than a per-assertion stub. Most of what matters here is what the read
// refuses: the cap, the chart's own range, and the absence of any way to page.
import { describe, expect, it } from 'vitest';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import { emptyWorkspace, type WorkspaceDocument } from '../../domain/workspace';
import {
	createChartState,
	writeChartState,
	type ChartState,
	type ChartTimeframe
} from '../domain/chartState';
import type { InstrumentRef } from '../domain/instrument';
import type { ChartSeriesPort, OhlcvBar } from '../domain/seriesPort';
import type { StudyInstance } from '../domain/studies';
import {
	createInMemoryChartSeries,
	type InMemoryChartSeriesFixture
} from '../infra/inMemoryChartSeries';
import {
	CHART_DATA_BAR_CAP,
	readChartData,
	resolveChartRange,
	toWireChartData,
	toWireChartDataRefusal,
	type ChartDataDeps,
	type ChartDataRequest,
	type ChartDataResult
} from './chartData';

const CLOCK: Clock = { now: () => '2026-09-02T20:00:00.000Z' };
const PANEL_ID = 'panel_1';
const WORKSPACE_ID = 'workspace_1';

const NVDA: InstrumentRef = {
	instrumentId: 'inst:XNAS:NVDA',
	symbol: 'NVDA',
	exchange: 'XNAS',
	assetType: 'equity'
};

// Consecutive UTC days from 2026-01-02, closes counting up from 100 so any
// slice is identifiable by its values alone.
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

function fixture(
	bars: OhlcvBar[],
	overrides: Partial<InMemoryChartSeriesFixture> = {}
): InMemoryChartSeriesFixture {
	return {
		instrumentId: NVDA.instrumentId,
		timeframe: '1d',
		bars,
		sourceAdjustment: 'adjusted',
		currency: 'USD',
		timezone: 'America/New_York',
		liveness: 'end_of_day',
		...overrides
	} as InMemoryChartSeriesFixture;
}

function sma(length: number, enabled = true): StudyInstance {
	return {
		id: 'study_1',
		catalogItemId: 'study.sma',
		params: { length },
		pane: 'price_overlay',
		order: 0,
		enabled
	};
}

function chartState(overrides: {
	timeframe?: ChartTimeframe;
	studies?: StudyInstance[];
	start?: string;
	end?: string;
	instrument?: InstrumentRef | null;
}): ChartState {
	const state = createChartState(PANEL_ID);
	state.config.instrument = overrides.instrument === undefined ? NVDA : overrides.instrument;
	state.config.timeframe = overrides.timeframe ?? '1d';
	state.config.range = {
		kind: 'explicit',
		start: overrides.start ?? '2026-01-01T00:00:00.000Z',
		end: overrides.end ?? '2028-01-01T00:00:00.000Z'
	};
	state.studies = overrides.studies ?? [];
	return state;
}

interface Harness {
	deps: ChartDataDeps;
	writes: WorkspaceDocument[];
	document(): WorkspaceDocument;
}

function harness(state: ChartState, series: ChartSeriesPort): Harness {
	let current = writeChartState(emptyWorkspace(WORKSPACE_ID, 'Research', CLOCK.now()), state);
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
	return { deps: { repository, series, clock: CLOCK }, writes, document: () => current };
}

function setup(
	barCount: number,
	options: {
		studies?: StudyInstance[];
		fixtureOverrides?: Partial<InMemoryChartSeriesFixture>;
	} = {}
): Harness {
	const port = createInMemoryChartSeries({
		clock: CLOCK,
		series: [fixture(dailyBars(barCount), options.fixtureOverrides)]
	});
	return harness(chartState({ studies: options.studies }), port);
}

async function read(h: Harness, request: Partial<ChartDataRequest> = {}): Promise<ChartDataResult> {
	const outcome = await readChartData(h.deps, { panelId: PANEL_ID, ...request });
	if (!outcome.ok) {
		throw new Error(`expected a successful read, got refusal ${outcome.refusal.reason}`);
	}
	return outcome.data;
}

async function refusal(h: Harness, request: Partial<ChartDataRequest> = {}) {
	const outcome = await readChartData(h.deps, { panelId: PANEL_ID, ...request });
	if (outcome.ok) {
		throw new Error(`expected a refusal, got ${outcome.data.barCount} bars`);
	}
	return outcome.refusal;
}

describe('bars and study outputs', () => {
	it('test_returns_ohlcv_and_enabled_study_outputs_aligned_bar_for_bar', async () => {
		const data = await read(setup(30, { studies: [sma(5)] }));
		expect(data.barCount, 'every bar in the chart range should be returned').toBe(30);
		expect(data.bars[0]?.close, 'closes count up from 100').toBe(100);
		const study = data.studies[0];
		const series = study?.outputs.sma;
		expect(series?.length, 'a study output must have one entry per bar').toBe(30);
		// The bars at indexes 0..4 close 100..104, so their mean is 102.
		expect(series?.[4], 'the study value must line up with its own bar').toBe(102);
		expect(study?.studyId, 'the study keeps the ID the chart knows it by').toBe('study_1');
	});

	it('test_disabled_studies_are_not_reported', async () => {
		const data = await read(setup(30, { studies: [sma(5, false)] }));
		expect(data.studies.length, 'a toggled-off study is not on the chart').toBe(0);
	});

	it('test_an_uncomputable_study_costs_a_warning_not_the_prices', async () => {
		const broken: StudyInstance = { ...sma(5), catalogItemId: 'study.not_a_thing' };
		const data = await read(setup(10, { studies: [broken] }));
		expect(data.barCount, 'the bars still come back').toBe(10);
		expect(data.studies[0]?.outputs, 'the study reports nothing rather than guessing').toEqual({});
		expect(data.studies[0]?.warnings.length, 'the reason must be stated').toBeGreaterThan(0);
	});
});

describe('window forms', () => {
	it('test_no_window_uses_the_charts_visible_range_and_says_so', async () => {
		const data = await read(setup(30));
		expect(data.window.form, 'an unnamed window is the visible range').toBe('visible_range');
		expect(data.window.isChartVisibleRange, 'the result must say which range it used').toBe(true);
		expect(data.window.note, 'the result says so in words too').toContain('visible range');
		expect(data.window.start, 'the window echoes the chart range').toBe(data.chartRange.start);
	});

	it('test_explicit_start_and_end_returns_only_that_span', async () => {
		const data = await read(setup(30), {
			window: { form: 'explicit', start: '2026-01-05', end: '2026-01-09' }
		});
		expect(data.barCount, '2026-01-05 through 2026-01-09 is five days').toBe(5);
		expect(data.bars[0]?.time, 'the first bar is the start bound').toBe('2026-01-05');
		expect(data.window.form, 'the form is reported back').toBe('explicit');
	});

	it('test_last_n_bars_returns_the_most_recent_n', async () => {
		const data = await read(setup(30), { window: { form: 'last_n_bars', lastNBars: 5 } });
		expect(data.barCount, 'exactly five bars were asked for').toBe(5);
		expect(data.bars[0]?.close, 'bar 25 of 30 closes at 125').toBe(125);
		expect(data.bars[4]?.close, 'the last bar closes at 129').toBe(129);
	});

	it('test_anchored_window_returns_bars_either_side_of_the_anchor', async () => {
		const data = await read(setup(30), {
			// The bar closing at 110 is 2026-01-12, ten days after the first.
			window: { form: 'anchored', anchorTime: '2026-01-12', barsBefore: 2, barsAfter: 3 }
		});
		expect(data.barCount, 'two before, the anchor, and three after').toBe(6);
		expect(data.bars[0]?.close, 'two bars before the anchor closes at 108').toBe(108);
		expect(data.bars[5]?.close, 'three bars after the anchor closes at 113').toBe(113);
	});

	it('test_a_count_window_that_runs_out_of_chart_warns_rather_than_pretending', async () => {
		const data = await read(setup(10), { window: { form: 'last_n_bars', lastNBars: 40 } });
		expect(data.barCount, 'only ten bars exist in the chart range').toBe(10);
		expect(
			data.warnings.some((w) => w.includes('widen the chart range')),
			`expected a shortfall warning, got ${JSON.stringify(data.warnings)}`
		).toBe(true);
	});

	it('test_a_malformed_window_is_refused_naming_the_field', async () => {
		const bad = await refusal(setup(10), { window: { form: 'last_n_bars', lastNBars: 0 } });
		expect(bad.reason, 'a zero-bar window is a caller mistake').toBe('invalid_window');
		expect(bad.message, 'the offending field is named').toContain('last_n_bars');
	});
});

describe('the per-call cap', () => {
	it('test_the_cap_is_five_hundred_and_is_stated_in_every_result', async () => {
		expect(CHART_DATA_BAR_CAP, 'the working assumption in the spec is 500 bars').toBe(500);
		const data = await read(setup(30));
		expect(data.barCap, 'every result states the cap').toBe(CHART_DATA_BAR_CAP);
	});

	it('test_a_window_over_the_cap_is_refused_never_truncated', async () => {
		const bad = await refusal(setup(600));
		expect(bad.reason, 'over the cap is a refusal').toBe('window_over_bar_cap');
		expect(bad.barCap, 'the refusal states the cap').toBe(500);
		expect(bad.barsInWindow, 'the refusal states what the window actually holds').toBe(600);
		expect(bad.message, 'the refusal says it did not truncate').toContain('truncated');
	});

	it('test_the_refusal_offers_narrowing_and_an_aggregation_that_fits', async () => {
		const bad = await refusal(setup(600));
		expect(bad.remedies.length, 'at least two concrete remedies').toBeGreaterThanOrEqual(2);
		expect(
			bad.remedies.some((r) => r.includes('Narrow the window')),
			`expected a narrowing remedy, got ${JSON.stringify(bad.remedies)}`
		).toBe(true);
		expect(
			bad.remedies.some((r) => r.includes('aggregate_to')),
			`expected an aggregation remedy, got ${JSON.stringify(bad.remedies)}`
		).toBe(true);
		const weekly = bad.fitsWithAggregation?.find((o) => o.timeframe === '1wk');
		expect(weekly?.barCount, '600 daily bars roll up to 87 weeks').toBe(87);
		expect(
			bad.fitsWithAggregation?.every((o) => o.barCount <= CHART_DATA_BAR_CAP),
			'an offered aggregation must actually fit'
		).toBe(true);
	});

	it('test_a_count_window_cannot_be_used_to_exceed_the_cap', async () => {
		const bad = await refusal(setup(600), { window: { form: 'last_n_bars', lastNBars: 600 } });
		expect(bad.reason, 'asking by count does not lift the cap').toBe('window_over_bar_cap');
	});
});

describe('aggregation', () => {
	it('test_aggregated_bars_are_labelled_and_never_passed_off_as_raw', async () => {
		const data = await read(setup(600), { aggregateTo: '1wk' });
		expect(data.aggregation?.to, 'the aggregation applied is named').toBe('1wk');
		expect(data.aggregation?.from, 'so is the timeframe it came from').toBe('1d');
		expect(data.aggregation?.method, 'and how it was produced').toBe('ohlcv_rollup');
		expect(data.timeframe, 'the returned bars are weekly').toBe('1wk');
		expect(data.sourceTimeframe, "the chart's own timeframe is still reported").toBe('1d');
		expect(toWireChartData(data).aggregated, 'the wire says so outright').toBe(true);
	});

	it('test_raw_bars_are_not_labelled_as_aggregated', async () => {
		const data = await read(setup(30));
		expect(data.aggregation, 'nothing was rolled up').toBeNull();
		expect(toWireChartData(data).aggregated, 'raw bars must not claim to be aggregated').toBe(
			false
		);
	});

	it('test_rolled_up_bars_fold_open_high_low_close_and_volume', async () => {
		// 2026-01-02 is a Friday, so the first weekly bucket holds one bar and the
		// second holds 2026-01-05 (Monday) through 2026-01-11.
		const data = await read(setup(30), { aggregateTo: '1wk' });
		const week = data.bars[1];
		expect(week?.time, 'a weekly bar opens at its first daily bar').toBe('2026-01-05');
		expect(week?.open, "the week's open is Monday's open").toBe(102);
		expect(week?.close, "the week's close is Sunday's close").toBe(109);
		expect(week?.high, 'the high is the highest of the week').toBe(111);
		expect(week?.low, 'the low is the lowest of the week').toBe(100);
		expect(week?.volume, 'volume sums across the week').toBe(
			1003 + 1004 + 1005 + 1006 + 1007 + 1008 + 1009
		);
	});

	it('test_aggregation_reports_how_many_source_bars_it_folded', async () => {
		const data = await read(setup(600), { aggregateTo: '1wk' });
		expect(data.aggregation?.sourceBarCount, 'every daily bar is accounted for').toBe(600);
	});

	it('test_a_finer_or_equal_aggregation_is_refused', async () => {
		const bad = await refusal(setup(30), { aggregateTo: '1h' });
		expect(bad.reason, 'bars can only be rolled up, never split').toBe('invalid_aggregation');
		expect(bad.message, 'the message says which way rollup goes').toContain('coarser');
		expect(bad.remedies.length, 'the caller is told what to do instead').toBeGreaterThanOrEqual(2);
	});

	it('test_studies_are_computed_over_the_aggregated_bars_they_are_aligned_to', async () => {
		const data = await read(setup(30, { studies: [sma(3)] }), { aggregateTo: '1wk' });
		expect(
			data.studies[0]?.outputs.sma?.length,
			'a study value must exist for every returned bar'
		).toBe(data.barCount);
	});
});

describe('no pagination, deliberately', () => {
	// The whole tool exists to stop an agent reassembling an unbounded series by
	// looping, so the response must offer nothing to loop on. These are exact key
	// names rather than substrings: a value may explain that pagination is absent,
	// but no key may imply it is available.
	const FORBIDDEN = [
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

	function keysOf(value: unknown, found: string[] = []): string[] {
		if (Array.isArray(value)) {
			value.forEach((entry) => keysOf(entry, found));
			return found;
		}
		if (typeof value === 'object' && value !== null) {
			for (const [key, child] of Object.entries(value)) {
				found.push(key);
				keysOf(child, found);
			}
		}
		return found;
	}

	it('test_a_successful_read_carries_no_continuation_affordance', async () => {
		const wire = toWireChartData(await read(setup(30, { studies: [sma(5)] })));
		const offending = keysOf(wire).filter((key) => FORBIDDEN.includes(key));
		expect(offending, `the response must offer nothing to loop on, found ${offending}`).toEqual([]);
	});

	it('test_an_over_cap_refusal_carries_no_continuation_affordance_either', async () => {
		const wire = toWireChartDataRefusal(await refusal(setup(600)));
		const offending = keysOf(wire).filter((key) => FORBIDDEN.includes(key));
		expect(offending, `a refusal must not hand back a cursor, found ${offending}`).toEqual([]);
	});

	it('test_the_result_explains_why_there_is_no_next_page', async () => {
		const wire = toWireChartData(await read(setup(30)));
		expect(
			String(wire.boundedness),
			'an agent looking for paging should find the reason'
		).toContain('no continuation');
	});
});

describe("the chart's range is the outer bound", () => {
	it('test_a_window_starting_before_the_chart_range_is_refused', async () => {
		const port = createInMemoryChartSeries({ clock: CLOCK, series: [fixture(dailyBars(30))] });
		const h = harness(chartState({ start: '2026-01-05T00:00:00.000Z' }), port);
		const bad = await refusal(h, {
			window: { form: 'explicit', start: '2021-01-01', end: '2026-01-10' }
		});
		expect(bad.reason, 'a read may not reach past the chart').toBe('window_outside_chart_range');
		expect(bad.message, 'the caller is directed at the chart configuration').toContain(
			'change the chart configuration'
		);
		expect(bad.chartRange?.start, "the chart's actual range is named").toBe(
			'2026-01-05T00:00:00.000Z'
		);
	});

	it('test_a_window_ending_after_the_chart_range_is_refused', async () => {
		const port = createInMemoryChartSeries({ clock: CLOCK, series: [fixture(dailyBars(30))] });
		const h = harness(chartState({ end: '2026-01-10T00:00:00.000Z' }), port);
		const bad = await refusal(h, {
			window: { form: 'explicit', start: '2026-01-05', end: '2026-06-01' }
		});
		expect(bad.reason, 'the far bound is checked too').toBe('window_outside_chart_range');
	});

	it('test_an_anchor_outside_the_chart_range_is_refused', async () => {
		const port = createInMemoryChartSeries({ clock: CLOCK, series: [fixture(dailyBars(30))] });
		const h = harness(chartState({ end: '2026-01-10T00:00:00.000Z' }), port);
		const bad = await refusal(h, {
			window: { form: 'anchored', anchorTime: '2027-01-01', barsBefore: 1, barsAfter: 1 }
		});
		expect(bad.reason, 'an anchor names a time, so it is bounded too').toBe(
			'window_outside_chart_range'
		);
	});

	it('test_a_relative_chart_range_resolves_against_the_clock', () => {
		const range = resolveChartRange({ kind: 'relative', token: '6mo' }, CLOCK.now());
		expect(range.end, 'a relative range ends now').toBe('2026-09-02T20:00:00.000Z');
		expect(range.start, 'six months back from 2026-09-02').toBe('2026-03-02T20:00:00.000Z');
	});
});

describe('provenance and price adjustment', () => {
	it('test_every_read_carries_the_full_provenance_block', async () => {
		const wire = toWireChartData(await read(setup(30))).provenance as Record<string, unknown>;
		for (const field of [
			'as_of',
			'source_id',
			'source_label',
			'liveness',
			'timezone',
			'currency',
			'price_adjustment',
			'engine_version'
		]) {
			expect(wire[field], `provenance is missing ${field}`).toBeDefined();
		}
	});

	it('test_the_reported_adjustment_is_the_one_the_bars_were_computed_under', async () => {
		const h = setup(30, { fixtureOverrides: { sourceAdjustment: 'unadjusted' } });
		const data = await read(h);
		expect(data.priceAdjustment.chartPolicy, 'the chart asked for the default basis').toBe(
			'adjusted'
		);
		expect(data.priceAdjustment.applied, 'but the source supplied unadjusted prices').toBe(
			'unadjusted'
		);
		expect(data.provenance.priceAdjustment, 'provenance agrees with what was applied').toBe(
			'unadjusted'
		);
		expect(
			data.warnings.some((w) => w.includes('unadjusted')),
			`the mismatch must be relayed, got ${JSON.stringify(data.warnings)}`
		).toBe(true);
	});

	it('test_an_unstated_adjustment_basis_stays_null_and_is_never_defaulted', async () => {
		const h = setup(30, { fixtureOverrides: { sourceAdjustment: 'unreported' } });
		const data = await read(h);
		expect(
			data.priceAdjustment.applied,
			'a guessed basis is worse than a stated absence'
		).toBeNull();
		expect(
			toWireChartData(data).price_adjustment,
			'the null must survive to the wire rather than becoming the requested policy'
		).toEqual({ chart_policy: 'adjusted', applied: null });
		expect(
			data.warnings.some((w) => w.includes('does not state')),
			`the unknown basis must be relayed, got ${JSON.stringify(data.warnings)}`
		).toBe(true);
	});
});

describe('warm-up bars', () => {
	it('test_warmup_bars_report_an_explicit_absent_value', async () => {
		const data = await read(setup(10, { studies: [sma(5)] }));
		const series = data.studies[0]?.outputs.sma ?? [];
		expect(series.slice(0, 4), 'the first four bars have no five-bar mean yet').toEqual([
			null,
			null,
			null,
			null
		]);
		expect(series[4], 'the fifth bar is the first with a value').toBe(102);
		expect(data.studies[0]?.warmupBars, 'the warm-up length is stated').toBe(4);
	});
});

describe('the read is a read', () => {
	it('test_reading_writes_nothing_and_leaves_the_revision_alone', async () => {
		const h = setup(30, { studies: [sma(5)] });
		const before = h.document().revision;
		await read(h);
		await read(h, { window: { form: 'last_n_bars', lastNBars: 5 } });
		expect(h.writes.length, 'a read must never write the workspace').toBe(0);
		expect(h.document().revision, 'the revision is untouched').toBe(before);
	});
});

describe('an empty window', () => {
	it('test_a_window_with_no_bars_is_an_empty_series_not_an_error', async () => {
		const h = setup(30);
		const data = await read(h, {
			// A Saturday and Sunday inside the chart range that hold no bars at all
			// once the fixture is filtered -- the market-holiday case.
			window: { form: 'explicit', start: '2027-06-05', end: '2027-06-06' }
		});
		expect(data.barCount, 'an empty window is empty, not an error').toBe(0);
		expect(data.bars, 'no bars are invented').toEqual([]);
		expect(data.provenance.sourceId, 'provenance is still valid').toBeTruthy();
		expect(data.provenance.engineVersion, 'including the engine version').toBeTruthy();
	});

	it('test_studies_over_an_empty_window_report_empty_series', async () => {
		const h = setup(30, { studies: [sma(5)] });
		const data = await read(h, {
			window: { form: 'explicit', start: '2027-06-05', end: '2027-06-06' }
		});
		expect(data.studies[0]?.outputs.sma, 'an empty window yields an empty series').toEqual([]);
	});
});

describe('refusals before any fetch', () => {
	it('test_a_panel_with_no_chart_is_refused', async () => {
		const h = setup(30);
		const outcome = await readChartData(h.deps, { panelId: 'panel_99' });
		expect(outcome.ok, 'an unknown panel has no bars').toBe(false);
		if (!outcome.ok) {
			expect(outcome.refusal.reason, 'the panel is named as the problem').toBe(
				'chart_panel_not_found'
			);
		}
	});

	it('test_a_chart_with_no_instrument_is_refused', async () => {
		const port = createInMemoryChartSeries({ clock: CLOCK, series: [fixture(dailyBars(30))] });
		const h = harness(chartState({ instrument: null }), port);
		const bad = await refusal(h);
		expect(bad.reason, 'an unconfigured chart has nothing to read').toBe('chart_not_configured');
		expect(bad.remedies.length, 'the caller is told to bind an instrument').toBeGreaterThanOrEqual(
			2
		);
	});

	it('test_a_source_failure_surfaces_as_a_refusal_with_its_reason', async () => {
		const port = createInMemoryChartSeries({
			clock: CLOCK,
			series: [fixture(dailyBars(30), { failure: new Error('feed down') })]
		});
		const h = harness(chartState({}), port);
		const bad = await refusal(h);
		expect(bad.reason, 'a source failure is not a caller mistake').toBe('series_unavailable');
	});
});
