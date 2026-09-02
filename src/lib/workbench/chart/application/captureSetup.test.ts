// The async prologue and the registered operation, exercised separately from
// the tool so the two halves of a capture can be pinned down on their own: what
// the window resolves to, and what the operation writes.
import { describe, expect, it } from 'vitest';
import { createIdSequencer } from '../../domain/ids';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import { emptyWorkspace, type WorkspaceDocument } from '../../domain/workspace';
import { createOperationRegistry } from '../../application/operationRegistry';
import { CaptureSetupError, readCapturedSetups } from '../domain/capturedSetup';
import {
	createChartState,
	writeChartState,
	type ChartRange,
	type ChartState
} from '../domain/chartState';
import type { InstrumentRef } from '../domain/instrument';
import type { ChartSeriesPort, OhlcvBar } from '../domain/seriesPort';
import type { StudyInstance } from '../domain/studies';
import {
	createInMemoryChartSeries,
	type InMemoryChartSeriesFixture
} from '../infra/inMemoryChartSeries';
import {
	CHART_CAPTURE_SETUP_KIND,
	createCaptureChartSetupOperation,
	ensureCaptureChartSetupOperation,
	prepareCapture,
	type PrepareCaptureDeps,
	type PreparedCapture
} from './captureSetup';

const CLOCK: Clock = { now: () => '2026-09-02T20:00:00.000Z' };
const PANEL_ID = 'panel_chart_1';
const WORKSPACE_ID = 'workspace_1';

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

const SMA: StudyInstance = {
	id: 'study_1',
	catalogItemId: 'study.sma',
	params: { length: 20 },
	pane: 'price_overlay',
	order: 0,
	enabled: true
};

function chartState(
	overrides: { instrument?: InstrumentRef | null; range?: ChartRange } = {}
): ChartState {
	const state = createChartState(PANEL_ID);
	state.config.instrument = overrides.instrument === undefined ? NVDA : overrides.instrument;
	state.config.range = overrides.range ?? {
		kind: 'explicit',
		start: '2026-01-01T00:00:00.000Z',
		end: '2028-01-01T00:00:00.000Z'
	};
	state.studies = [SMA];
	return state;
}

function documentWith(state: ChartState): WorkspaceDocument {
	const base = {
		...emptyWorkspace(WORKSPACE_ID, 'Research', CLOCK.now()),
		panels: [
			{
				id: PANEL_ID,
				kind: 'chart' as const,
				title: 'Chart',
				collapsed: false,
				visible: true,
				boundResourceId: null,
				config: {}
			}
		]
	};
	return writeChartState(base, state);
}

function repositoryFor(doc: WorkspaceDocument | null): WorkspaceRepository {
	let current = doc;
	return {
		list: () => [],
		get: (id) => (current && id === current.id ? current : null),
		put: (next) => {
			current = next;
		},
		getActiveId: () => (current ? current.id : null),
		setActiveId: () => undefined,
		listRevisions: () => [],
		getRevision: () => null,
		putRevision: () => undefined
	};
}

function depsFor(
	state: ChartState | null,
	series: ChartSeriesPort,
	options: { document?: WorkspaceDocument | null } = {}
): PrepareCaptureDeps {
	const doc =
		options.document !== undefined ? options.document : state ? documentWith(state) : null;
	return { repository: repositoryFor(doc), series, clock: CLOCK };
}

function portWith(
	bars: OhlcvBar[],
	overrides: Partial<InMemoryChartSeriesFixture> = {}
): ChartSeriesPort {
	return createInMemoryChartSeries({ clock: CLOCK, series: [fixture(bars, overrides)] });
}

async function prepared(deps: PrepareCaptureDeps, anchorTime?: string): Promise<PreparedCapture> {
	const outcome = await prepareCapture(deps, {
		panelId: PANEL_ID,
		...(anchorTime !== undefined ? { anchorTime } : {})
	});
	if (!outcome.ok) {
		throw new Error(`expected a prepared capture, got refusal ${outcome.refusal.reason}`);
	}
	return outcome.prepared;
}

async function captureError(deps: PrepareCaptureDeps, anchorTime?: string): Promise<string[]> {
	try {
		await prepareCapture(deps, {
			panelId: PANEL_ID,
			...(anchorTime !== undefined ? { anchorTime } : {})
		});
	} catch (err) {
		if (err instanceof CaptureSetupError) {
			return err.issues;
		}
		throw err;
	}
	throw new Error('expected a CaptureSetupError');
}

describe('prepareCapture', () => {
	it('resolves the window from the bars the chart actually holds', async () => {
		const result = await prepared(depsFor(chartState(), portWith(dailyBars(30))));
		expect(result.window.barCount).toBe(30);
		expect(result.window.start).toBe('2026-01-02');
		expect(result.window.end).toBe('2026-01-31');
		expect(result.window.timeframe).toBe('1d');
		expect(result.window.session).toBe('regular');
	});

	it('spans the bars rather than the epoch when the chart range is "max"', async () => {
		const state = chartState({ range: { kind: 'relative', token: 'max' } });
		const result = await prepared(depsFor(state, portWith(dailyBars(5))));
		expect(result.window.start).toBe('2026-01-02');
		expect(result.window.barCount).toBe(5);
	});

	it('carries the provenance of the data the capture was taken from', async () => {
		const result = await prepared(depsFor(chartState(), portWith(dailyBars(3))));
		expect(result.provenance.liveness).toBe('end_of_day');
		expect(result.provenance.sourceId).toBe('src.chart.in_memory');
		expect(result.provenance.engineVersion).toBeTruthy();
	});

	it('rejects a chart with no instrument, naming what is missing', async () => {
		const issues = await captureError(depsFor(chartState({ instrument: null }), portWith([])));
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain('this chart has no instrument');
	});

	it('rejects a window that holds no bars', async () => {
		const state = chartState({
			range: { kind: 'explicit', start: '2020-01-01', end: '2020-02-01' }
		});
		const issues = await captureError(depsFor(state, portWith(dailyBars(10))));
		expect(issues.join(' ')).toContain('covers no bars');
	});

	it('rejects an anchor time the captured window does not contain', async () => {
		const issues = await captureError(
			depsFor(chartState(), portWith(dailyBars(10))),
			'2027-06-01T00:00:00.000Z'
		);
		expect(issues.join(' ')).toContain('outside the captured window');
	});

	it('keeps an anchor time inside the window', async () => {
		const result = await prepared(depsFor(chartState(), portWith(dailyBars(10))), '2026-01-05');
		expect(result.window.anchorTime).toBe('2026-01-05');
	});

	it('warns rather than guesses when the source states no adjustment basis', async () => {
		const port = portWith(dailyBars(4), { sourceAdjustment: 'unreported' });
		const result = await prepared(depsFor(chartState(), port));
		expect(result.warnings.join(' ')).toContain('does not state which price-adjustment basis');
	});

	it('warns when the applied adjustment differs from the chart policy', async () => {
		const port = portWith(dailyBars(4), { sourceAdjustment: 'unadjusted' });
		const result = await prepared(depsFor(chartState(), port));
		expect(result.warnings.join(' ')).toContain('the chart\'s policy is "adjusted"');
	});

	it('refuses when there is no workspace to capture from', async () => {
		const outcome = await prepareCapture(depsFor(null, portWith([]), { document: null }), {
			panelId: PANEL_ID
		});
		expect(outcome.ok).toBe(false);
		expect(outcome.ok === false && outcome.refusal.reason).toBe('workspace_not_found');
	});

	it('refuses when the named panel has no chart on it', async () => {
		const outcome = await prepareCapture(depsFor(chartState(), portWith(dailyBars(3))), {
			panelId: 'panel_9'
		});
		expect(outcome.ok).toBe(false);
		expect(outcome.ok === false && outcome.refusal.reason).toBe('chart_panel_not_found');
	});

	it('refuses when the bars port cannot answer', async () => {
		const port = createInMemoryChartSeries({ clock: CLOCK, series: [] });
		const outcome = await prepareCapture(depsFor(chartState(), port), { panelId: PANEL_ID });
		expect(outcome.ok).toBe(false);
		expect(outcome.ok === false && outcome.refusal.reason).toBe('series_unavailable');
	});
});

describe('chart.capture_setup operation', () => {
	const operation = createCaptureChartSetupOperation({ clock: CLOCK });

	async function operationInput(state: ChartState = chartState()) {
		const deps = depsFor(state, portWith(dailyBars(12)));
		const ready = await prepared(deps);
		return {
			panelId: PANEL_ID,
			window: ready.window,
			provenance: ready.provenance
		};
	}

	it('is namespaced under the chart area', () => {
		expect(operation.kind).toBe('chart.capture_setup');
	});

	it('writes a record addressed by a minted setup id', async () => {
		const doc = documentWith(chartState());
		const draft = operation.apply(await operationInput(), doc, createIdSequencer());
		const setups = readCapturedSetups(draft.document);
		expect(setups).toHaveLength(1);
		expect(setups[0]!.setupId).toBe('setup_1');
		expect(draft.affectedIds).toEqual(['setup_1', PANEL_ID]);
	});

	it('records the revision whose state was frozen', async () => {
		const doc = documentWith(chartState());
		const draft = operation.apply(await operationInput(), doc, createIdSequencer());
		expect(readCapturedSetups(draft.document)[0]!.workspaceRevision).toBe(doc.revision);
	});

	it('inverts to the document without the capture', async () => {
		const doc = documentWith(chartState());
		const draft = operation.apply(await operationInput(), doc, createIdSequencer());
		expect(readCapturedSetups(draft.inverse!.document)).toEqual([]);
	});

	it('refuses to validate a chart with no instrument', async () => {
		const state = chartState();
		const input = await operationInput(state);
		const doc = documentWith(chartState({ instrument: null }));
		expect(operation.validate(input, doc).join(' ')).toContain('has no instrument');
	});

	it('refuses to validate a window with no bars', async () => {
		const input = await operationInput();
		const doc = documentWith(chartState());
		const issues = operation.validate({ ...input, window: { ...input.window, barCount: 0 } }, doc);
		expect(issues.join(' ')).toContain('covers no bars');
	});

	it('refuses to validate a panel that is not a chart', async () => {
		const input = await operationInput();
		const doc = documentWith(chartState());
		const issues = operation.validate({ ...input, panelId: 'panel_missing' }, doc);
		expect(issues.join(' ')).toContain('is not a panel in this workspace');
	});

	it('rejects a normalization the domain does not know', async () => {
		const input = await operationInput();
		const doc = documentWith(chartState());
		const issues = operation.validate(
			{ ...input, normalization: { mode: 'log' as never, anchor: 'window_start' } },
			doc
		);
		expect(issues.join(' ')).toContain('normalization.mode');
	});
});

describe('ensureCaptureChartSetupOperation', () => {
	it('registers the operation once and tolerates being called again', () => {
		const registry = createOperationRegistry();
		ensureCaptureChartSetupOperation(registry, { clock: CLOCK });
		ensureCaptureChartSetupOperation(registry, { clock: CLOCK });
		expect(registry.kinds()).toEqual([CHART_CAPTURE_SETUP_KIND]);
	});
});
