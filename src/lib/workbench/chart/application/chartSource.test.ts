import { beforeEach, describe, expect, it } from 'vitest';
import { createChangeHistory, undoChange } from '../../application/changeHistory';
import type { ChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import {
	applyOperations,
	createOperationRegistry,
	previewOperations,
	type OperationRegistry
} from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import type { RevisionService } from '../../application/revisionService';
import { OperationValidationError, RevisionConflictError } from '../../domain/errors';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import type { PanelRecord, WorkspaceDocument } from '../../domain/workspace';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { readChartState } from '../domain/chartState';
import type { InstrumentRef } from '../domain/instrument';
import {
	createChartBindSourceOperation,
	describeChartDataInvalidation,
	registerChartBindSourceOperation,
	resolveChartRange,
	validateChartSourceReference,
	CHART_BIND_SOURCE_KIND,
	type ChartSourceDeps,
	type InstrumentAvailability,
	type InstrumentDataWindow
} from './chartSource';

const AAPL: InstrumentRef = {
	instrumentId: 'inst:XNAS:AAPL',
	symbol: 'AAPL',
	exchange: 'XNAS',
	assetType: 'equity'
};

const MSFT: InstrumentRef = {
	instrumentId: 'inst:XNAS:MSFT',
	symbol: 'MSFT',
	exchange: 'XNAS',
	assetType: 'equity'
};

const NEWCO: InstrumentRef = {
	instrumentId: 'inst:XNAS:NEWCO',
	symbol: 'NEWCO',
	exchange: 'XNAS',
	assetType: 'equity'
};

const CHART_PANEL_ID = 'panel_chart_1';

function panel(id: string, kind: PanelRecord['kind']): PanelRecord {
	return {
		id,
		kind,
		title: id,
		collapsed: false,
		visible: true,
		boundResourceId: null,
		config: {}
	};
}

function workspaceWithChart(): WorkspaceDocument {
	const doc = emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z');
	return {
		...doc,
		panels: [panel(CHART_PANEL_ID, 'chart'), panel('panel_table_1', 'results_table')]
	};
}

function availability(
	windows: Record<string, InstrumentDataWindow | null>
): InstrumentAvailability {
	return {
		isKnownInstrument: (id) => Object.prototype.hasOwnProperty.call(windows, id),
		dataWindow: (id) => windows[id] ?? null
	};
}

const clock: Clock = { now: () => '2026-06-01T00:00:00.000Z' };

function bindSource(deps: ChartSourceDeps = {}) {
	return createChartBindSourceOperation(deps);
}

function configOf(doc: WorkspaceDocument) {
	return readChartState(doc, CHART_PANEL_ID).config;
}

describe('chart.bind_source registration', () => {
	it('registers under a namespaced kind the shared operation registry accepts', () => {
		const registry = createOperationRegistry();
		registerChartBindSourceOperation(registry);
		expect(registry.kinds()).toEqual([CHART_BIND_SOURCE_KIND]);
		expect(registry.get(CHART_BIND_SOURCE_KIND)?.kind).toBe('chart.bind_source');
	});

	it('states in its schema that the instrument is an ID and never a ticker', () => {
		const schema = JSON.stringify(bindSource().inputSchema);
		expect(schema).toContain('instrument ID');
		expect(schema).toContain('never by ticker');
	});
});

describe('chart.bind_source validation', () => {
	const doc = workspaceWithChart();

	it('rejects a bare ticker string, directing the caller to resolve it first', () => {
		const issues = bindSource().validate(
			{ panelId: CHART_PANEL_ID, instrument: 'AAPL' } as never,
			doc
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain('is a ticker, not an instrument ID');
		expect(issues[0]).toContain('Resolve it through instrument search first');
	});

	it('rejects an instrument reference whose id is a ticker rather than an instrument ID', () => {
		const issues = bindSource().validate(
			{ panelId: CHART_PANEL_ID, instrument: { ...AAPL, instrumentId: 'AAPL' } },
			doc
		);
		expect(issues.join(' ')).toContain('instrument.instrumentId');
		expect(issues.join(' ')).toContain('bare ticker is never accepted');
	});

	it('rejects an unknown panel id, naming the chart panels that do exist', () => {
		const issues = bindSource().validate({ panelId: 'panel_nope', instrument: AAPL }, doc);
		expect(issues).toEqual([
			`panel_id: "panel_nope" is not a panel in this workspace. Chart panels here: ${CHART_PANEL_ID}.`
		]);
	});

	it('rejects a panel that is not a chart panel', () => {
		const issues = bindSource().validate({ panelId: 'panel_table_1', instrument: AAPL }, doc);
		expect(issues[0]).toContain('is a results_table panel, not a chart panel');
	});

	it('rejects an unsupported timeframe, naming the field and the permitted values', () => {
		const issues = bindSource().validate(
			{ panelId: CHART_PANEL_ID, timeframe: '7h' as never },
			doc
		);
		expect(issues[0]).toContain('timeframe: "7h" is not a supported timeframe');
		expect(issues[0]).toContain('1m, 5m, 15m, 30m, 1h, 4h, 1d, 1wk, 1mo');
	});

	it('rejects an inverted explicit range, naming the offending field', () => {
		const issues = bindSource().validate(
			{
				panelId: CHART_PANEL_ID,
				range: { kind: 'explicit', start: '2026-03-01', end: '2026-01-01' }
			},
			doc
		);
		expect(issues).toEqual(['range.end: must be after range.start.']);
	});

	it('rejects a view property, directing the caller to the view tool', () => {
		const issues = bindSource().validate(
			{ panelId: CHART_PANEL_ID, scale: 'logarithmic' } as never,
			doc
		);
		expect(issues[0]).toContain('is a chart view property, not a source property');
		expect(issues[0]).toContain('configure_panel_view');
	});

	it('rejects an unknown instrument when an availability oracle can say so', () => {
		const deps = { availability: availability({ [AAPL.instrumentId]: null }), clock };
		const issues = bindSource(deps).validate({ panelId: CHART_PANEL_ID, instrument: NEWCO }, doc);
		expect(issues[0]).toContain(`"${NEWCO.instrumentId}" is not a known instrument`);
	});

	it('accepts an unverifiable instrument when no availability oracle is wired up', () => {
		expect(bindSource().validate({ panelId: CHART_PANEL_ID, instrument: NEWCO }, doc)).toEqual([]);
	});

	it('rejects an explicit range with no available data for that instrument', () => {
		const deps = {
			availability: availability({
				[NEWCO.instrumentId]: { start: '2026-05-01', end: '2026-06-01' }
			}),
			clock
		};
		const issues = bindSource(deps).validate(
			{
				panelId: CHART_PANEL_ID,
				instrument: NEWCO,
				range: { kind: 'explicit', start: '2020-01-01', end: '2020-06-01' }
			},
			doc
		);
		expect(issues[0]).toContain('no data is available');
		expect(issues[0]).toContain('has data from 2026-05-01 to 2026-06-01');
	});

	it('accepts a range that overlaps the data the instrument does have', () => {
		const deps = {
			availability: availability({
				[NEWCO.instrumentId]: { start: '2026-05-01', end: '2026-06-01' }
			}),
			clock
		};
		const issues = bindSource(deps).validate(
			{
				panelId: CHART_PANEL_ID,
				instrument: NEWCO,
				range: { kind: 'explicit', start: '2026-05-15', end: '2026-07-01' }
			},
			doc
		);
		expect(issues).toEqual([]);
	});

	it('resolves a relative range before checking it against available data', () => {
		const deps = {
			availability: availability({
				[NEWCO.instrumentId]: { start: '2019-01-01', end: '2019-06-01' }
			}),
			clock
		};
		const issues = bindSource(deps).validate(
			{ panelId: CHART_PANEL_ID, instrument: NEWCO, range: { kind: 'relative', token: '6mo' } },
			doc
		);
		expect(issues[0]).toContain('no data is available');
	});
});

describe('chart.bind_source apply', () => {
	const ids = createIdSequencer();

	it('applies only the properties named, leaving every other one untouched', () => {
		const before = bindSource().apply(
			{
				panelId: CHART_PANEL_ID,
				instrument: AAPL,
				timeframe: '1h',
				range: { kind: 'relative', token: '1y' }
			},
			workspaceWithChart(),
			ids
		).document;

		const after = bindSource().apply(
			{ panelId: CHART_PANEL_ID, timeframe: '1d' },
			before,
			ids
		).document;

		const config = configOf(after);
		expect(config.timeframe).toBe('1d');
		expect(config.instrument).toEqual(AAPL);
		expect(config.range).toEqual({ kind: 'relative', token: '1y' });
		expect(config.candleType).toBe(configOf(before).candleType);
	});

	it('reports what changed, not what was asked for', () => {
		const doc = bindSource().apply(
			{ panelId: CHART_PANEL_ID, timeframe: '1h' },
			workspaceWithChart(),
			ids
		).document;
		const draft = bindSource().apply({ panelId: CHART_PANEL_ID, timeframe: '1h' }, doc, ids);
		expect(draft.diffSummary).toContain('nothing changed');
	});

	it('adds a comparison and reports the default normalization it applied', () => {
		const draft = bindSource().apply(
			{ panelId: CHART_PANEL_ID, instrument: AAPL, addComparisons: [{ instrument: MSFT }] },
			workspaceWithChart(),
			ids
		);
		const config = configOf(draft.document);
		expect(config.comparisons).toEqual([
			{ instrument: MSFT, normalization: { mode: 'none', anchor: 'window_start' } }
		]);
		expect(draft.warnings?.join(' ')).toContain('added without a normalization');
		expect(draft.warnings?.join(' ')).toContain('"none"');
	});

	it('keeps an explicit normalization and says nothing about defaults', () => {
		const draft = bindSource().apply(
			{
				panelId: CHART_PANEL_ID,
				addComparisons: [
					{ instrument: MSFT, normalization: { mode: 'percent_change', anchor: 'window_start' } }
				]
			},
			workspaceWithChart(),
			ids
		);
		expect(configOf(draft.document).comparisons[0]?.normalization.mode).toBe('percent_change');
		expect(draft.warnings ?? []).toEqual([]);
	});

	it('removes a comparison by instrument id, keeping the others', () => {
		const withBoth = bindSource().apply(
			{
				panelId: CHART_PANEL_ID,
				addComparisons: [{ instrument: MSFT }, { instrument: NEWCO }]
			},
			workspaceWithChart(),
			ids
		).document;

		const draft = bindSource().apply(
			{ panelId: CHART_PANEL_ID, removeComparisons: [MSFT.instrumentId] },
			withBoth,
			ids
		);
		expect(configOf(draft.document).comparisons.map((c) => c.instrument.instrumentId)).toEqual([
			NEWCO.instrumentId
		]);
	});

	it('rejects removing a comparison the chart does not have', () => {
		const issues = bindSource().validate(
			{ panelId: CHART_PANEL_ID, removeComparisons: [MSFT.instrumentId] },
			workspaceWithChart()
		);
		expect(issues[0]).toContain('is not a comparison on this chart');
	});

	it('warns that cached bars and study output are invalidated when the series changes', () => {
		const draft = bindSource().apply(
			{ panelId: CHART_PANEL_ID, instrument: AAPL, timeframe: '1h' },
			workspaceWithChart(),
			ids
		);
		const warning = draft.warnings?.join(' ') ?? '';
		expect(warning).toContain('Cached bars and study output');
		expect(warning).toContain('timeframe');
		expect(warning).toContain('instrument');
	});

	it('does not claim invalidation when only the comparison list changed', () => {
		const draft = bindSource().apply(
			{ panelId: CHART_PANEL_ID, addComparisons: [{ instrument: MSFT }] },
			workspaceWithChart(),
			ids
		);
		expect(draft.warnings?.join(' ')).not.toContain('Cached bars');
	});

	it('carries a non-null inverse, which is what makes the change undoable', () => {
		const doc = workspaceWithChart();
		const draft = bindSource().apply({ panelId: CHART_PANEL_ID, instrument: AAPL }, doc, ids);
		expect(draft.inverse?.document).toEqual(doc);
	});

	it('throws rather than writing a half-applied config when apply is reached with bad input', () => {
		expect(() =>
			bindSource().apply(
				{ panelId: CHART_PANEL_ID, timeframe: 'nope' as never },
				workspaceWithChart(),
				ids
			)
		).toThrow(OperationValidationError);
	});
});

describe('chart.bind_source describe', () => {
	it('names the changed fields in wire casing', () => {
		const description = bindSource().describe(
			{ panelId: CHART_PANEL_ID, instrument: AAPL },
			workspaceWithChart()
		);
		expect(description).toContain(`Bound chart ${CHART_PANEL_ID}`);
		expect(description).toContain(AAPL.instrumentId);
	});

	it('never throws for input that failed validation', () => {
		expect(() =>
			bindSource().describe(
				{ panelId: 'panel_nope', instrument: 'AAPL' } as never,
				workspaceWithChart()
			)
		).not.toThrow();
	});
});

describe('validateChartSourceReference', () => {
	it('requires an instrument, because a source that names nothing is not a binding', () => {
		const issues = validateChartSourceReference({ timeframe: '1d' });
		expect(issues[0]).toContain('a chart source must name an instrument by ID');
	});

	it('accepts a whole binding in wire casing', () => {
		const issues = validateChartSourceReference({
			instrument: {
				instrument_id: AAPL.instrumentId,
				symbol: 'AAPL',
				exchange: 'XNAS',
				asset_type: 'equity'
			},
			timeframe: '1d',
			range: { kind: 'relative', token: '6mo' },
			comparisons: [
				{
					instrument: {
						instrument_id: MSFT.instrumentId,
						symbol: 'MSFT',
						exchange: 'XNAS',
						asset_type: 'equity'
					}
				}
			]
		});
		expect(issues).toEqual([]);
	});

	it('applies the same instrument rule the operation applies', () => {
		const issues = validateChartSourceReference({ instrument: 'AAPL' });
		expect(issues[0]).toContain('is a ticker, not an instrument ID');
	});

	it('applies the same availability rule the operation applies', () => {
		const issues = validateChartSourceReference(
			{ instrument: AAPL },
			{ availability: availability({}), clock }
		);
		expect(issues[0]).toContain('is not a known instrument');
	});
});

describe('resolveChartRange', () => {
	it('passes an explicit range through unchanged', () => {
		const window = resolveChartRange(
			{ kind: 'explicit', start: '2026-01-01', end: '2026-02-01' },
			clock.now()
		);
		expect(window).toEqual({ start: '2026-01-01', end: '2026-02-01' });
	});

	it('ends a relative range at now and starts it a token-sized span earlier', () => {
		const window = resolveChartRange({ kind: 'relative', token: '5d' }, clock.now());
		expect(window.end).toBe('2026-06-01T00:00:00.000Z');
		expect(window.start).toBe('2026-05-27T00:00:00.000Z');
	});

	it('starts a year-to-date range on the first of the year', () => {
		const window = resolveChartRange({ kind: 'relative', token: 'ytd' }, clock.now());
		expect(window.start).toBe('2026-01-01T00:00:00.000Z');
	});

	it('starts a max range early enough to cover any instrument history', () => {
		const window = resolveChartRange({ kind: 'relative', token: 'max' }, clock.now());
		expect(Date.parse(window.start)).toBeLessThanOrEqual(Date.parse('1970-01-01T00:00:00.000Z'));
	});
});

describe('describeChartDataInvalidation', () => {
	it('is silent when nothing that defines the series changed', () => {
		expect(
			describeChartDataInvalidation(CHART_PANEL_ID, [{ field: 'scale', from: 'a', to: 'b' }])
		).toBeNull();
	});

	it('names the fields in wire casing when the series is no longer the same series', () => {
		const message = describeChartDataInvalidation(CHART_PANEL_ID, [
			{ field: 'priceAdjustment', from: 'adjusted', to: 'unadjusted' }
		]);
		expect(message).toContain('price_adjustment');
	});
});

describe('chart.bind_source through the mutation stack', () => {
	let registry: OperationRegistry;
	let repository: ReturnType<typeof createLocalWorkspaceRepository>;
	let revisionService: RevisionService;
	let history: ChangeHistory;
	let ids: ReturnType<typeof createIdSequencer>;

	beforeEach(() => {
		registry = createOperationRegistry();
		registerChartBindSourceOperation(registry);
		repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(workspaceWithChart());
		ids = createIdSequencer();
		revisionService = createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		});
		history = createChangeHistory();
	});

	function deps() {
		return { registry, workspaceId: 'workspace_1', history, revisionService, clock, ids };
	}

	function bind(input: unknown, context: { expectedRevision?: number; idempotencyKey?: string }) {
		return applyOperations(
			[{ kind: CHART_BIND_SOURCE_KIND, input }],
			{ ...context, actor: 'agent' },
			deps()
		);
	}

	it('returns the mutation envelope every other panel tool returns', () => {
		const envelope = bind(
			{ panel_id: CHART_PANEL_ID, instrument: AAPL, timeframe: '1d' },
			{ expectedRevision: 1 }
		);
		expect(envelope.changeId).toMatch(/^change_/);
		expect(envelope.newRevision).toBe(2);
		expect(envelope.affectedIds).toEqual([CHART_PANEL_ID]);
		expect(envelope.diffSummary).toContain(AAPL.instrumentId);
		expect(envelope.undoToken).not.toBeNull();
		// The collection apply path merges drafts and keeps only the summary, so
		// that is where a notice has to survive.
		expect(envelope.diffSummary).toContain('Cached bars and study output');
	});

	it('accepts the wire shape the schema advertises', () => {
		bind(
			{
				panel_id: CHART_PANEL_ID,
				instrument: {
					instrument_id: AAPL.instrumentId,
					symbol: 'AAPL',
					exchange: 'XNAS',
					asset_type: 'equity'
				},
				add_comparisons: [{ instrument: { ...MSFT } }]
			},
			{ expectedRevision: 1 }
		);
		const config = configOf(repository.get('workspace_1')!);
		expect(config.instrument).toEqual(AAPL);
		expect(config.comparisons).toHaveLength(1);
	});

	it('rejects a stale expected_revision without mutating anything', () => {
		const before = repository.get('workspace_1');
		expect(() =>
			bind({ panel_id: CHART_PANEL_ID, instrument: AAPL }, { expectedRevision: 99 })
		).toThrow(RevisionConflictError);
		expect(repository.get('workspace_1')).toEqual(before);
	});

	it('replays an already-seen idempotency key without applying the change twice', () => {
		const input = { panel_id: CHART_PANEL_ID, addComparisons: [{ instrument: MSFT }] };
		const first = bind(input, { expectedRevision: 1, idempotencyKey: 'key_1' });
		const replay = bind(input, { expectedRevision: 1, idempotencyKey: 'key_1' });
		expect(replay).toEqual(first);
		expect(configOf(repository.get('workspace_1')!).comparisons).toHaveLength(1);
		expect(repository.get('workspace_1')?.revision).toBe(2);
	});

	it('restores the previous configuration exactly when the undo token is applied', () => {
		bind({ panel_id: CHART_PANEL_ID, instrument: AAPL, timeframe: '1h' }, { expectedRevision: 1 });
		const beforeSecond = configOf(repository.get('workspace_1')!);

		const envelope = bind(
			{
				panel_id: CHART_PANEL_ID,
				instrument: MSFT,
				timeframe: '1d',
				range: { kind: 'relative', token: '1y' }
			},
			{ expectedRevision: 2 }
		);
		undoChange(envelope.undoToken!, {
			history,
			revisionService,
			clock,
			context: { actor: 'agent' }
		});

		expect(configOf(repository.get('workspace_1')!)).toEqual(beforeSecond);
	});

	it('leaves the chart unchanged when the configuration is invalid', () => {
		const before = repository.get('workspace_1');
		expect(() =>
			bind(
				{
					panel_id: CHART_PANEL_ID,
					range: { kind: 'explicit', start: '2026-03-01', end: '2026-01-01' }
				},
				{ expectedRevision: 1 }
			)
		).toThrow(OperationValidationError);
		expect(repository.get('workspace_1')).toEqual(before);
	});

	it('previews without touching the stored workspace', () => {
		const preview = previewOperations(
			[{ kind: CHART_BIND_SOURCE_KIND, input: { panel_id: CHART_PANEL_ID, instrument: AAPL } }],
			{ registry, document: repository.get('workspace_1')!, ids }
		);
		expect(preview.valid).toBe(true);
		expect(repository.get('workspace_1')?.revision).toBe(1);
	});
});
