import { describe, expect, it } from 'vitest';
import { createIdSequencer } from '../../domain/ids';
import { makeProvenance, toWireProvenance } from '../../domain/provenance';
import type { MarketDataProvenance } from '../../domain/provenance';
import { emptyWorkspace, normalizeWorkspace } from '../../domain/workspace';
import { createAnnotation } from './annotations';
import type { ChartAnnotation } from './annotations';
import type { CaptureInput, CapturedChartSetup, SetupWindow } from './capturedSetup';
import {
	CAPTURED_SETUP_EXTENSION_KEY,
	CaptureSetupError,
	buildCapturedSetup,
	capturedSetupIdSeed,
	normalizeCapturedSetup,
	readCapturedSetup,
	readCapturedSetups,
	toWireCapturedSetup,
	validateSetupWindow,
	writeCapturedSetup
} from './capturedSetup';
import type { ChartState } from './chartState';
import {
	applyChartConfigPatch,
	createChartState,
	removeChartState,
	writeChartState
} from './chartState';
import type { ComparisonRef, InstrumentRef } from './instrument';
import { DEFAULT_NORMALIZATION } from './instrument';
import type { StudyInstance } from './studies';

const apple: InstrumentRef = {
	instrumentId: 'inst:XNAS:AAPL',
	symbol: 'AAPL',
	exchange: 'XNAS',
	assetType: 'equity'
};

const spy: ComparisonRef = {
	instrument: { instrumentId: 'inst:ARCX:SPY', symbol: 'SPY', exchange: 'ARCX', assetType: 'etf' },
	normalization: { mode: 'percent_change', anchor: 'window_start' }
};

const provenance: MarketDataProvenance = makeProvenance({
	asOf: '2026-09-01T20:00:00.000Z',
	sourceId: 'src.prices.eodhd',
	sourceLabel: 'EODHD',
	liveness: 'end_of_day',
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'adjusted'
});

const window: SetupWindow = {
	start: '2026-03-02T00:00:00.000Z',
	end: '2026-09-01T00:00:00.000Z',
	timeframe: '1d',
	session: 'regular',
	barCount: 128,
	anchorTime: '2026-08-14T00:00:00.000Z'
};

// A function, not a shared const: one test deliberately mutates the chart state
// it captured from, and a shared array would leak that into its neighbours.
function studies(): StudyInstance[] {
	return [
		{
			id: 'study_1',
			catalogItemId: 'study.sma',
			params: { period: 50 },
			pane: 'price_overlay',
			order: 0,
			enabled: true
		},
		{
			id: 'study_2',
			catalogItemId: 'study.rsi',
			params: { period: 14 },
			pane: 'sub_pane',
			order: 0,
			enabled: false
		}
	];
}

function trendline(): ChartAnnotation {
	const result = createAnnotation({
		id: 'annotation_1',
		kind: 'trendline',
		anchors: {
			kind: 'trendline',
			from: { time: '2026-04-01T00:00:00.000Z', price: 180 },
			to: { time: '2026-08-14T00:00:00.000Z', price: 231 }
		},
		priceAdjustment: 'adjusted',
		label: 'breakout'
	});
	if (!result.ok) {
		throw new Error(`fixture annotation failed: ${result.issues.join('; ')}`);
	}
	return result.annotation;
}

function chartState(): ChartState {
	const base = createChartState('panel_1');
	const result = applyChartConfigPatch(base.config, {
		instrument: apple,
		timeframe: '1d',
		range: { kind: 'explicit', start: window.start, end: window.end },
		candleType: 'candlestick',
		scale: 'logarithmic',
		session: 'regular',
		comparisons: [spy],
		priceAdjustment: 'split_adjusted'
	});
	if (!result.ok) {
		throw new Error(`fixture config failed: ${result.issues.join('; ')}`);
	}
	return { config: result.config, studies: studies(), annotations: [trendline()] };
}

function captureInput(overrides: Partial<CaptureInput> = {}): CaptureInput {
	return {
		setupId: 'setup_1',
		capturedAt: '2026-09-01T20:05:00.000Z',
		workspaceRevision: 7,
		sourcePanelId: 'panel_1',
		state: chartState(),
		window,
		provenance,
		...overrides
	};
}

describe('buildCapturedSetup', () => {
	it('records everything needed to interpret the setup without the live chart', () => {
		const setup = buildCapturedSetup(
			captureInput({ name: 'AAPL breakout', notes: 'watch volume' })
		);
		expect(setup).toEqual({
			setupId: 'setup_1',
			capturedAt: '2026-09-01T20:05:00.000Z',
			workspaceRevision: 7,
			sourcePanelId: 'panel_1',
			name: 'AAPL breakout',
			notes: 'watch volume',
			instrument: apple,
			window,
			candleType: 'candlestick',
			scale: 'logarithmic',
			priceAdjustment: 'split_adjusted',
			normalization: DEFAULT_NORMALIZATION,
			studies: [
				{
					studyId: 'study_1',
					catalogItemId: 'study.sma',
					params: { period: 50 },
					pane: 'price_overlay',
					order: 0,
					enabled: true
				},
				{
					studyId: 'study_2',
					catalogItemId: 'study.rsi',
					params: { period: 14 },
					pane: 'sub_pane',
					order: 0,
					enabled: false
				}
			],
			comparisons: [spy],
			annotations: [
				{
					annotationId: 'annotation_1',
					kind: 'trendline',
					anchors: trendline().anchors,
					priceAdjustment: 'adjusted',
					label: 'breakout'
				}
			],
			provenance
		});
	});

	it('records the chart’s own three-valued adjustment policy, not provenance’s narrower one', () => {
		const setup = buildCapturedSetup(captureInput());
		expect(setup.priceAdjustment).toBe('split_adjusted');
		expect(setup.provenance.priceAdjustment).toBe('adjusted');
	});

	it('records the normalization explicitly when the caller omits it', () => {
		expect(buildCapturedSetup(captureInput()).normalization).toEqual(DEFAULT_NORMALIZATION);
	});

	it('keeps the caller’s normalization when one is supplied', () => {
		const setup = buildCapturedSetup(
			captureInput({ normalization: { mode: 'z_score', anchor: 'anchor_bar' } })
		);
		expect(setup.normalization).toEqual({ mode: 'z_score', anchor: 'anchor_bar' });
	});

	it('omits name and notes entirely when they are not supplied', () => {
		const setup = buildCapturedSetup(captureInput());
		expect('name' in setup).toBe(false);
		expect('notes' in setup).toBe(false);
	});

	it('preserves study order and each instance’s stable ID', () => {
		const setup = buildCapturedSetup(captureInput());
		expect(setup.studies.map((s) => s.studyId)).toEqual(['study_1', 'study_2']);
		expect(setup.studies.map((s) => s.order)).toEqual([0, 0]);
	});

	it('gives each capture from the same chart its own record', () => {
		const first = buildCapturedSetup(captureInput());
		const second = buildCapturedSetup(captureInput({ setupId: 'setup_2', name: 'second look' }));
		expect(second.setupId).not.toBe(first.setupId);
		expect('name' in first).toBe(false);
	});
});

describe('buildCapturedSetup refuses to produce a partial record', () => {
	it('rejects a chart with no instrument, saying what is missing', () => {
		const stateWithoutInstrument = { ...chartState(), config: createChartState('panel_1').config };
		let thrown: unknown;
		try {
			buildCapturedSetup(captureInput({ state: stateWithoutInstrument }));
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(CaptureSetupError);
		expect((thrown as CaptureSetupError).issues.join(' ')).toContain(
			'this chart has no instrument'
		);
	});

	it('rejects a window with no bars', () => {
		expect(() => buildCapturedSetup(captureInput({ window: { ...window, barCount: 0 } }))).toThrow(
			CaptureSetupError
		);
	});

	it('names every problem at once rather than one at a time', () => {
		let issues: string[] = [];
		try {
			buildCapturedSetup(
				captureInput({
					setupId: '',
					capturedAt: 'yesterday',
					state: { ...chartState(), config: createChartState('panel_1').config },
					window: { ...window, barCount: 0 }
				})
			);
		} catch (error) {
			issues = (error as CaptureSetupError).issues;
		}
		expect(issues).toHaveLength(4);
	});

	it('serializes its failure to a machine-readable wire error', () => {
		try {
			buildCapturedSetup(captureInput({ window: { ...window, barCount: 0 } }));
			throw new Error('expected the capture to be rejected');
		} catch (error) {
			expect(error).toBeInstanceOf(CaptureSetupError);
			expect((error as CaptureSetupError).toWireError().error).toBe('capture_setup_incomplete');
		}
	});
});

describe('a captured setup is self-contained', () => {
	it('is unchanged after the source panel is reconfigured', () => {
		const state = chartState();
		const setup = buildCapturedSetup(captureInput({ state }));
		const snapshot = JSON.stringify(setup);

		const reconfigured = applyChartConfigPatch(state.config, {
			instrument: {
				instrumentId: 'inst:XNAS:MSFT',
				symbol: 'MSFT',
				exchange: 'XNAS',
				assetType: 'equity'
			},
			priceAdjustment: 'unadjusted',
			comparisons: []
		});
		state.studies.push({ ...studies()[0]!, id: 'study_9' });
		state.annotations.length = 0;
		Object.assign(state.config, reconfigured.ok ? reconfigured.config : {});

		expect(JSON.stringify(setup)).toBe(snapshot);
		expect(setup.instrument.symbol).toBe('AAPL');
		expect(setup.studies).toHaveLength(2);
		expect(setup.annotations).toHaveLength(1);
	});

	it('is still readable after the source panel is removed from the workspace', () => {
		const state = chartState();
		const setup = buildCapturedSetup(captureInput({ state }));
		const withPanel = writeCapturedSetup(
			writeChartState(emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'), state),
			setup
		);
		const withoutPanel = removeChartState(withPanel, 'panel_1');
		expect(readCapturedSetup(withoutPanel, 'setup_1')).toEqual(setup);
	});

	it('shares no structure with the chart state it came from', () => {
		const state = chartState();
		const setup = buildCapturedSetup(captureInput({ state }));
		expect(setup.instrument).not.toBe(state.config.instrument);
		expect(setup.comparisons[0]).not.toBe(state.config.comparisons[0]);
		expect(setup.studies[0]?.params).not.toBe(state.studies[0]?.params);
	});
});

describe('toWireCapturedSetup', () => {
	const setup = buildCapturedSetup(captureInput({ name: 'AAPL breakout', notes: 'watch volume' }));
	const wire = toWireCapturedSetup(setup);

	it('emits the snake_case field names the technical design names', () => {
		expect(Object.keys(wire).sort()).toEqual([
			'annotations',
			'candle_type',
			'captured_at',
			'comparisons',
			'instrument',
			'name',
			'normalization',
			'notes',
			'price_adjustment',
			'provenance',
			'scale',
			'setup_id',
			'source_panel_id',
			'studies',
			'window',
			'workspace_revision'
		]);
	});

	it('emits snake_case inside the nested window, instrument, study and annotation records', () => {
		expect(Object.keys(wire.window as object).sort()).toEqual([
			'anchor_time',
			'bar_count',
			'end',
			'session',
			'start',
			'timeframe'
		]);
		expect(Object.keys(wire.instrument as object).sort()).toEqual([
			'asset_type',
			'exchange',
			'instrument_id',
			'symbol'
		]);
		const study = (wire.studies as Record<string, unknown>[])[0] as Record<string, unknown>;
		expect(Object.keys(study).sort()).toEqual([
			'catalog_item_id',
			'enabled',
			'order',
			'pane',
			'params',
			'study_id'
		]);
		const annotation = (wire.annotations as Record<string, unknown>[])[0] as Record<
			string,
			unknown
		>;
		expect(Object.keys(annotation).sort()).toEqual([
			'anchors',
			'annotation_id',
			'kind',
			'label',
			'price_adjustment'
		]);
	});

	it('delegates provenance to its owner rather than hand-serializing it', () => {
		expect(wire.provenance).toEqual(toWireProvenance(provenance));
	});

	it('drops the anchors’ internal kind discriminant, which the annotation kind already carries', () => {
		const annotation = (wire.annotations as Record<string, unknown>[])[0] as Record<
			string,
			unknown
		>;
		expect(Object.keys(annotation.anchors as object).sort()).toEqual(['from', 'to']);
	});

	it('omits an absent name and notes rather than emitting null', () => {
		const bare = toWireCapturedSetup(buildCapturedSetup(captureInput()));
		expect('name' in bare).toBe(false);
		expect('notes' in bare).toBe(false);
	});

	it('emits an empty annotations array rather than omitting the key', () => {
		const state = { ...chartState(), annotations: [] };
		const bare = toWireCapturedSetup(buildCapturedSetup(captureInput({ state })));
		expect(bare.annotations).toEqual([]);
	});

	it('emits a plain JSON-serializable object', () => {
		expect(() => JSON.stringify(wire)).not.toThrow();
	});
});

describe('persistence round trip', () => {
	it('retrieves a setup by ID unchanged after the workspace is persisted and reloaded', () => {
		const setup = buildCapturedSetup(captureInput({ name: 'AAPL breakout' }));
		const doc = writeCapturedSetup(
			emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'),
			setup
		);
		const reloaded = normalizeWorkspace(JSON.parse(JSON.stringify(doc)));
		expect(readCapturedSetup(reloaded, 'setup_1')).toEqual(setup);
	});

	it('accumulates repeated captures rather than overwriting the first', () => {
		let doc = emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z');
		doc = writeCapturedSetup(doc, buildCapturedSetup(captureInput()));
		doc = writeCapturedSetup(doc, buildCapturedSetup(captureInput({ setupId: 'setup_2' })));
		expect(
			readCapturedSetups(doc)
				.map((s) => s.setupId)
				.sort()
		).toEqual(['setup_1', 'setup_2']);
	});

	it('returns a new document rather than mutating the one it was given', () => {
		const before = emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z');
		writeCapturedSetup(before, buildCapturedSetup(captureInput()));
		expect(before.extensions[CAPTURED_SETUP_EXTENSION_KEY]).toBeUndefined();
	});

	it('drops a persisted record too damaged to be a complete setup, rather than half-restoring it', () => {
		expect(normalizeCapturedSetup({ setupId: 'setup_1' })).toBeNull();
		expect(normalizeCapturedSetup(null)).toBeNull();
		const noBars = { ...buildCapturedSetup(captureInput()), window: { ...window, barCount: 0 } };
		expect(normalizeCapturedSetup(noBars)).toBeNull();
	});

	it('never throws on a foreign or malformed setups extension', () => {
		const doc = {
			...emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'),
			extensions: { chart_setups: { setup_1: 'garbage', setup_2: 42 } }
		};
		expect(() => readCapturedSetups(doc)).not.toThrow();
		expect(readCapturedSetups(doc)).toEqual([]);
	});
});

describe('validateSetupWindow', () => {
	it('accepts a well-formed window', () => {
		expect(validateSetupWindow(window, 'window')).toEqual([]);
	});

	it('rejects an inverted window naming the offending bound', () => {
		const issues = validateSetupWindow(
			{ ...window, start: window.end, end: window.start },
			'window'
		);
		expect(issues).toEqual(['window.end: must not precede window.start.']);
	});

	it('says there is nothing to capture when the window covers no bars', () => {
		const issues = validateSetupWindow({ ...window, barCount: 0 }, 'window');
		expect(issues[0]).toContain('nothing to capture');
	});

	it('rejects an unsupported timeframe and session', () => {
		const issues = validateSetupWindow(
			{ ...window, timeframe: '3s', session: 'overnight' },
			'window'
		);
		expect(issues).toHaveLength(2);
	});
});

describe('capturedSetupIdSeed', () => {
	it('seeds the sequencer past the highest persisted setup ID', () => {
		const doc = writeCapturedSetup(
			emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'),
			buildCapturedSetup(captureInput({ setupId: 'setup_4' }))
		);
		expect(createIdSequencer(capturedSetupIdSeed(doc)).next('setup')).toBe('setup_5');
	});

	it('is empty for a workspace with no captures', () => {
		expect(
			capturedSetupIdSeed(emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'))
		).toEqual({});
	});
});

describe('the exported contract surface', () => {
	// EPIC-1012 consumes these by name; a rename here is a coordinated change.
	it('types every field the technical design’s CapturedChartSetup table names', () => {
		const setup: CapturedChartSetup = buildCapturedSetup(captureInput({ name: 'n', notes: 'o' }));
		const required: (keyof CapturedChartSetup)[] = [
			'setupId',
			'capturedAt',
			'workspaceRevision',
			'sourcePanelId',
			'name',
			'notes',
			'instrument',
			'window',
			'candleType',
			'scale',
			'priceAdjustment',
			'normalization',
			'studies',
			'comparisons',
			'annotations',
			'provenance'
		];
		for (const field of required) {
			expect(setup[field], `CapturedChartSetup.${String(field)} must be populated`).toBeDefined();
		}
	});
});
