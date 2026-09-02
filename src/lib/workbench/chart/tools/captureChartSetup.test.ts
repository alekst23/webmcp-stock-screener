// The capture tool end to end, over a real repository, revision service and
// operation registry. What this file is mostly about is the promise the record
// makes to the epic that consumes it: it is complete, it is frozen, and it
// survives the workspace being written out and read back.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace, normalizeWorkspace } from '../../domain/workspace';
import type { WorkspaceDocument } from '../../domain/workspace';
import { createChangeHistory, undoChange } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { readCapturedSetup, readCapturedSetups } from '../domain/capturedSetup';
import {
	createChartState,
	readChartState,
	removeChartState,
	writeChartState,
	type ChartRange
} from '../domain/chartState';
import type { InstrumentRef } from '../domain/instrument';
import type { ChartSeriesPort, OhlcvBar } from '../domain/seriesPort';
import type { StudyInstance } from '../domain/studies';
import {
	createInMemoryChartSeries,
	type InMemoryChartSeriesFixture
} from '../infra/inMemoryChartSeries';
import { buildCaptureChartSetupTool } from './captureChartSetup';
import type { CaptureChartSetupDeps } from './captureChartSetup';

const NOW = '2026-09-02T20:00:00.000Z';
const PANEL_ID = 'panel_chart_1';
const WORKSPACE_ID = 'workspace_1';

const clock: Clock = { now: () => NOW };

const NVDA: InstrumentRef = {
	instrumentId: 'inst:XNAS:NVDA',
	symbol: 'NVDA',
	exchange: 'XNAS',
	assetType: 'equity'
};

const AMD: InstrumentRef = {
	instrumentId: 'inst:XNAS:AMD',
	symbol: 'AMD',
	exchange: 'XNAS',
	assetType: 'equity'
};

const SMA: StudyInstance = {
	id: 'study_1',
	catalogItemId: 'study.sma',
	params: { length: 20 },
	pane: 'price_overlay',
	order: 0,
	enabled: true
};

interface SuccessPayload {
	change_id: string;
	new_revision: number;
	affected_ids: string[];
	warnings: string[];
	undo_token: string | null;
	setup_id: string;
	source_panel_id: string;
	setup: Record<string, unknown>;
}

interface FailurePayload {
	error: string;
	message: string;
	issues?: string[];
	remedies?: string[];
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

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

function seriesPort(bars: OhlcvBar[]): ChartSeriesPort {
	const fixture = {
		instrumentId: NVDA.instrumentId,
		timeframe: '1d',
		bars,
		sourceAdjustment: 'adjusted',
		currency: 'USD',
		timezone: 'America/New_York',
		liveness: 'end_of_day'
	} as InMemoryChartSeriesFixture;
	return createInMemoryChartSeries({ clock, series: [fixture] });
}

describe('capture_chart_setup', () => {
	let deps: CaptureChartSetupDeps;
	let tool: ToolSpec;

	function seedWorkspace(
		overrides: { instrument?: InstrumentRef | null; range?: ChartRange } = {}
	): void {
		const base: WorkspaceDocument = {
			...emptyWorkspace(WORKSPACE_ID, 'Research', NOW),
			panels: [
				{
					id: PANEL_ID,
					kind: 'chart',
					title: 'Chart',
					collapsed: false,
					visible: true,
					boundResourceId: null,
					config: {}
				}
			]
		};
		const state = createChartState(PANEL_ID);
		state.config.instrument = overrides.instrument === undefined ? NVDA : overrides.instrument;
		state.config.range = overrides.range ?? {
			kind: 'explicit',
			start: '2026-01-01T00:00:00.000Z',
			end: '2028-01-01T00:00:00.000Z'
		};
		state.config.comparisons = [
			{ instrument: AMD, normalization: { mode: 'percent_change', anchor: 'window_start' } }
		];
		state.studies = [SMA];
		deps.repository.put(writeChartState(base, state));
		deps.repository.setActiveId(WORKSPACE_ID);
	}

	function rebuild(bars: OhlcvBar[]): void {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const ids = createIdSequencer();
		const idempotency = createIdempotencyCache();
		deps = {
			repository,
			revisions: createRevisionService({ repository, clock, ids, idempotency }),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			clock,
			ids,
			series: seriesPort(bars)
		};
		tool = buildCaptureChartSetupTool(deps);
	}

	beforeEach(() => {
		rebuild(dailyBars(30));
		seedWorkspace();
	});

	async function capture(input: Record<string, unknown> = {}) {
		return tool.execute({ panel_id: PANEL_ID, ...input });
	}

	async function captureOk(input: Record<string, unknown> = {}): Promise<SuccessPayload> {
		const result = await capture(input);
		expect(result.isError, JSON.stringify(jsonOf(result))).toBeUndefined();
		return jsonOf(result) as SuccessPayload;
	}

	function currentDoc(): WorkspaceDocument {
		const doc = deps.repository.get(WORKSPACE_ID);
		if (!doc) throw new Error('workspace vanished');
		return doc;
	}

	it('is named capture_chart_setup and is always available', () => {
		expect(tool.name).toBe('capture_chart_setup');
		expect(tool.available({} as never)).toBe(true);
	});

	it('registers the chart.capture_setup operation it commits through', () => {
		expect(deps.registry.kinds()).toEqual(['chart.capture_setup']);
	});

	it('returns a stable setup id and a record of what the chart was showing', async () => {
		const body = await captureOk();
		expect(body.setup_id).toBe('setup_1');
		expect(body.affected_ids).toContain('setup_1');
		const setup = body.setup;
		expect(setup.setup_id).toBe('setup_1');
		expect(setup.instrument).toEqual({
			instrument_id: NVDA.instrumentId,
			symbol: 'NVDA',
			exchange: 'XNAS',
			asset_type: 'equity'
		});
		expect(setup.window).toEqual({
			start: '2026-01-02',
			end: '2026-01-31',
			timeframe: '1d',
			session: 'regular',
			bar_count: 30
		});
		expect(setup.candle_type).toBe('candlestick');
		expect(setup.scale).toBe('linear');
		expect(setup.price_adjustment).toBe('adjusted');
		expect(setup.normalization).toEqual({ mode: 'none', anchor: 'window_start' });
		expect(setup.studies).toEqual([
			{
				study_id: 'study_1',
				catalog_item_id: 'study.sma',
				params: { length: 20 },
				pane: 'price_overlay',
				order: 0,
				enabled: true
			}
		]);
		expect(setup.comparisons).toEqual([
			{
				instrument: {
					instrument_id: AMD.instrumentId,
					symbol: 'AMD',
					exchange: 'XNAS',
					asset_type: 'equity'
				},
				normalization: { mode: 'percent_change', anchor: 'window_start' }
			}
		]);
	});

	it('stores the normalization the caller named rather than defaulting it', async () => {
		const body = await captureOk({
			normalization: { mode: 'indexed_100', anchor: 'anchor_bar' }
		});
		expect(body.setup.normalization).toEqual({ mode: 'indexed_100', anchor: 'anchor_bar' });
	});

	it('carries the provenance of the data it was captured from', async () => {
		const provenance = (await captureOk()).setup.provenance as Record<string, unknown>;
		expect(provenance.as_of).toBeTruthy();
		expect(provenance.source_id).toBe('src.chart.in_memory');
		expect(provenance.source_label).toBeTruthy();
		expect(provenance.liveness).toBe('end_of_day');
		expect(provenance.timezone).toBe('America/New_York');
		expect(provenance.currency).toBe('USD');
		expect(provenance.price_adjustment).toBe('adjusted');
		expect(provenance.engine_version).toBeTruthy();
	});

	it('records the workspace revision, source panel and capture time', async () => {
		const before = currentDoc().revision;
		const body = await captureOk();
		expect(body.setup.workspace_revision).toBe(before);
		expect(body.setup.source_panel_id).toBe(PANEL_ID);
		expect(body.setup.captured_at).toBe(NOW);
		expect(body.new_revision).toBe(before + 1);
	});

	it('stores and returns a caller-supplied name and notes', async () => {
		const body = await captureOk({ name: 'Cup and handle', notes: 'Volume dry-up at the rim.' });
		expect(body.setup.name).toBe('Cup and handle');
		expect(body.setup.notes).toBe('Volume dry-up at the rim.');
		const stored = readCapturedSetup(currentDoc(), body.setup_id);
		expect(stored?.name).toBe('Cup and handle');
		expect(stored?.notes).toBe('Volume dry-up at the rim.');
	});

	it('is unchanged by the source panel being reconfigured and removed', async () => {
		const body = await captureOk({ name: 'Frozen' });
		const captured = JSON.stringify(readCapturedSetup(currentDoc(), body.setup_id));

		const state = readChartState(currentDoc(), PANEL_ID);
		deps.repository.put(
			writeChartState(currentDoc(), {
				...state,
				config: {
					...state.config,
					instrument: AMD,
					timeframe: '1wk',
					priceAdjustment: 'unadjusted',
					comparisons: []
				},
				studies: []
			})
		);
		const stripped = removeChartState(currentDoc(), PANEL_ID);
		deps.repository.put({ ...stripped, panels: [] });

		const after = readCapturedSetup(currentDoc(), body.setup_id);
		// Asserted explicitly so the comparison below cannot pass by both sides
		// having become null once the panel was removed.
		expect(after?.instrument.symbol).toBe('NVDA');
		expect(after?.studies).toHaveLength(1);
		expect(after?.comparisons).toHaveLength(1);
		expect(JSON.stringify(after)).toBe(captured);
	});

	it('mints a second setup id and leaves the first record untouched', async () => {
		const first = await captureOk({ name: 'First' });
		const before = JSON.stringify(readCapturedSetup(currentDoc(), first.setup_id));
		const second = await captureOk({ name: 'Second' });

		expect(second.setup_id).not.toBe(first.setup_id);
		expect(readCapturedSetups(currentDoc())).toHaveLength(2);
		expect(JSON.stringify(readCapturedSetup(currentDoc(), first.setup_id))).toBe(before);
		expect(readCapturedSetup(currentDoc(), second.setup_id)?.name).toBe('Second');
	});

	it('round-trips unchanged through workspace persistence and is retrievable by id', async () => {
		const body = await captureOk({ name: 'Persisted', notes: 'through JSON' });
		const before = readCapturedSetup(currentDoc(), body.setup_id);

		const reloaded = normalizeWorkspace(JSON.parse(JSON.stringify(currentDoc())));
		const after = readCapturedSetup(reloaded, body.setup_id);

		expect(after).toEqual(before);
		expect(after?.setupId).toBe(body.setup_id);
	});

	it('rejects a chart with no instrument and stores no partial record', async () => {
		rebuild(dailyBars(30));
		seedWorkspace({ instrument: null });
		const result = await capture();
		const failure = jsonOf(result) as FailurePayload;

		expect(result.isError).toBe(true);
		expect(failure.error).toBe('capture_setup_incomplete');
		expect(failure.issues?.join(' ')).toContain('this chart has no instrument');
		expect(readCapturedSetups(currentDoc())).toEqual([]);
		expect(currentDoc().revision).toBe(1);
	});

	it('rejects a window with no bars and stores no partial record', async () => {
		rebuild(dailyBars(30));
		seedWorkspace({ range: { kind: 'explicit', start: '2020-01-01', end: '2020-02-01' } });
		const result = await capture();
		const failure = jsonOf(result) as FailurePayload;

		expect(result.isError).toBe(true);
		expect(failure.error).toBe('capture_setup_incomplete');
		expect(failure.issues?.join(' ')).toContain('covers no bars');
		expect(readCapturedSetups(currentDoc())).toEqual([]);
		expect(currentDoc().revision).toBe(1);
	});

	it('refuses a panel that has no chart on it', async () => {
		const result = await tool.execute({ panel_id: 'panel_9' });
		const failure = jsonOf(result) as FailurePayload;
		expect(result.isError).toBe(true);
		expect(failure.error).toBe('chart_panel_not_found');
		expect(failure.remedies?.length).toBeGreaterThan(0);
	});

	it('honours expected_revision and rejects a stale one', async () => {
		const fresh = await capture({ expected_revision: currentDoc().revision });
		expect(fresh.isError).toBeUndefined();
		const conflict = await capture({ expected_revision: 1 });
		expect(conflict.isError).toBe(true);
		expect((jsonOf(conflict) as FailurePayload).error).toBe('revision_conflict');
	});

	it('replays an idempotency key instead of capturing twice', async () => {
		const first = await captureOk({ idempotency_key: 'key-1' });
		const replay = await captureOk({ idempotency_key: 'key-1' });
		expect(replay.change_id).toBe(first.change_id);
		expect(readCapturedSetups(currentDoc())).toHaveLength(1);
	});

	it('returns an undo token that discards the capture', async () => {
		const body = await captureOk();
		expect(body.undo_token).not.toBeNull();
		undoChange(body.undo_token!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock: deps.clock,
			context: { actor: 'agent' }
		});
		expect(readCapturedSetups(currentDoc())).toEqual([]);
	});

	it('reports the panel it captured alongside the envelope', async () => {
		const body = await captureOk();
		expect(body.source_panel_id).toBe(PANEL_ID);
		expect(body.affected_ids).toContain(PANEL_ID);
	});
});
