import { beforeEach, describe, expect, it } from 'vitest';
import { createChangeHistory, undoChange } from '../../application/changeHistory';
import type { ChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import {
	applyOperations,
	createOperationRegistry,
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
import {
	createChartConfigureViewOperation,
	defaultChartViewConfig,
	registerChartConfigureViewOperation,
	validateChartViewConfig,
	CHART_CONFIGURE_VIEW_KIND
} from './chartView';

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
		panels: [panel(CHART_PANEL_ID, 'chart'), panel('panel_watchlist_1', 'watchlist')]
	};
}

const clock: Clock = { now: () => '2026-06-01T00:00:00.000Z' };
const ids = createIdSequencer();
const configureView = createChartConfigureViewOperation();

function configOf(doc: WorkspaceDocument) {
	return readChartState(doc, CHART_PANEL_ID).config;
}

describe('chart.configure_view registration', () => {
	it('registers under a namespaced kind the shared operation registry accepts', () => {
		const registry = createOperationRegistry();
		registerChartConfigureViewOperation(registry);
		expect(registry.kinds()).toEqual([CHART_CONFIGURE_VIEW_KIND]);
	});

	it('states in its schema that the adjustment policy affects every downstream price', () => {
		const schema = JSON.stringify(configureView.inputSchema);
		expect(schema).toContain('restates every downstream price');
		expect(schema).toContain('study values');
	});

	it('directs the caller to bind_panel_source for what the chart shows', () => {
		expect(JSON.stringify(configureView.inputSchema)).toContain('bind_panel_source');
	});
});

describe('chart.configure_view validation', () => {
	const doc = workspaceWithChart();

	it('rejects an unknown panel id, naming the chart panels that do exist', () => {
		const issues = configureView.validate({ panelId: 'panel_nope', scale: 'linear' }, doc);
		expect(issues[0]).toContain('is not a panel in this workspace');
		expect(issues[0]).toContain(CHART_PANEL_ID);
	});

	it('rejects a panel that is not a chart panel', () => {
		const issues = configureView.validate({ panelId: 'panel_watchlist_1', scale: 'linear' }, doc);
		expect(issues[0]).toContain('is a watchlist panel, not a chart panel');
	});

	it('rejects an unsupported candle type, naming the field and the permitted values', () => {
		const issues = configureView.validate(
			{ panelId: CHART_PANEL_ID, candleType: 'renko' as never },
			doc
		);
		expect(issues).toEqual([
			'candle_type: "renko" is not permitted. Permitted: candlestick, ohlc_bar, line, area, ' +
				'heikin_ashi, hollow_candle.'
		]);
	});

	it('rejects an unsupported adjustment policy, naming the permitted values', () => {
		const issues = configureView.validate(
			{ panelId: CHART_PANEL_ID, priceAdjustment: 'dividend_only' as never },
			doc
		);
		expect(issues[0]).toContain('adjusted, split_adjusted, unadjusted');
	});

	it('rejects a source property, directing the caller to the source tool', () => {
		const issues = configureView.validate(
			{ panelId: CHART_PANEL_ID, timeframe: '1d' } as never,
			doc
		);
		expect(issues[0]).toContain('is a chart source property, not a view property');
		expect(issues[0]).toContain('bind_panel_source');
	});
});

describe('chart.configure_view apply', () => {
	it('applies only the properties named, leaving every other one untouched', () => {
		const before = configureView.apply(
			{ panelId: CHART_PANEL_ID, scale: 'logarithmic', session: 'extended' },
			workspaceWithChart(),
			ids
		).document;

		const after = configureView.apply(
			{ panelId: CHART_PANEL_ID, candleType: 'line' },
			before,
			ids
		).document;

		const config = configOf(after);
		expect(config.candleType).toBe('line');
		expect(config.scale).toBe('logarithmic');
		expect(config.session).toBe('extended');
	});

	it('records which adjustment policy is in effect afterwards', () => {
		for (const policy of ['adjusted', 'split_adjusted', 'unadjusted'] as const) {
			const draft = configureView.apply(
				{ panelId: CHART_PANEL_ID, priceAdjustment: policy },
				workspaceWithChart(),
				ids
			);
			expect(configOf(draft.document).priceAdjustment).toBe(policy);
		}
	});

	it('invalidates cached bars and study output when the session changes', () => {
		const draft = configureView.apply(
			{ panelId: CHART_PANEL_ID, session: 'extended' },
			workspaceWithChart(),
			ids
		);
		expect(draft.warnings?.join(' ')).toContain('Cached bars and study output');
		expect(draft.diffSummary).toContain('session');
	});

	it('invalidates cached bars and study output when the adjustment policy changes', () => {
		const draft = configureView.apply(
			{ panelId: CHART_PANEL_ID, priceAdjustment: 'unadjusted' },
			workspaceWithChart(),
			ids
		);
		expect(draft.warnings?.join(' ')).toContain('price_adjustment');
	});

	it('does not claim invalidation for a purely cosmetic change', () => {
		const draft = configureView.apply(
			{ panelId: CHART_PANEL_ID, candleType: 'line', scale: 'logarithmic' },
			workspaceWithChart(),
			ids
		);
		expect(draft.warnings ?? []).toEqual([]);
	});

	it('carries a non-null inverse, which is what makes the change undoable', () => {
		const doc = workspaceWithChart();
		const draft = configureView.apply({ panelId: CHART_PANEL_ID, scale: 'logarithmic' }, doc, ids);
		expect(draft.inverse?.document).toEqual(doc);
	});

	it('throws rather than writing a half-applied config when apply is reached with bad input', () => {
		expect(() =>
			configureView.apply(
				{ panelId: CHART_PANEL_ID, scale: 'nope' as never },
				workspaceWithChart(),
				ids
			)
		).toThrow(OperationValidationError);
	});

	it('never throws while describing input that failed validation', () => {
		expect(() =>
			configureView.describe(
				{ panelId: 'panel_nope', scale: 'nope' as never },
				workspaceWithChart()
			)
		).not.toThrow();
	});
});

describe('validateChartViewConfig', () => {
	it('accepts a complete wire-shaped configuration', () => {
		expect(validateChartViewConfig(defaultChartViewConfig())).toEqual([]);
	});

	it('accepts a partial configuration, because the defaults fill the rest', () => {
		expect(validateChartViewConfig({ scale: 'logarithmic' })).toEqual([]);
	});

	it('applies the same value rules the operation applies', () => {
		expect(validateChartViewConfig({ candle_type: 'renko' })[0]).toContain(
			'candle_type: "renko" is not permitted'
		);
	});

	it('rejects a panel id, which belongs to the tool call rather than to the config', () => {
		expect(validateChartViewConfig({ panel_id: CHART_PANEL_ID })[0]).toContain(
			'is not a chart view property'
		);
	});
});

describe('defaultChartViewConfig', () => {
	it('states every default rather than leaving any implied', () => {
		expect(defaultChartViewConfig()).toEqual({
			candle_type: 'candlestick',
			scale: 'linear',
			session: 'regular',
			price_adjustment: 'adjusted'
		});
	});
});

describe('chart.configure_view through the mutation stack', () => {
	let registry: OperationRegistry;
	let repository: ReturnType<typeof createLocalWorkspaceRepository>;
	let revisionService: RevisionService;
	let history: ChangeHistory;
	let sequencer: ReturnType<typeof createIdSequencer>;

	beforeEach(() => {
		registry = createOperationRegistry();
		registerChartConfigureViewOperation(registry);
		repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(workspaceWithChart());
		sequencer = createIdSequencer();
		revisionService = createRevisionService({
			repository,
			clock,
			ids: sequencer,
			idempotency: createIdempotencyCache()
		});
		history = createChangeHistory();
	});

	function configure(
		input: unknown,
		context: { expectedRevision?: number; idempotencyKey?: string }
	) {
		return applyOperations(
			[{ kind: CHART_CONFIGURE_VIEW_KIND, input }],
			{ ...context, actor: 'agent' },
			{
				registry,
				workspaceId: 'workspace_1',
				history,
				revisionService,
				clock,
				ids: sequencer
			}
		);
	}

	it('returns the mutation envelope every other panel tool returns', () => {
		const envelope = configure(
			{ panel_id: CHART_PANEL_ID, price_adjustment: 'unadjusted' },
			{ expectedRevision: 1 }
		);
		expect(envelope.changeId).toMatch(/^change_/);
		expect(envelope.newRevision).toBe(2);
		expect(envelope.affectedIds).toEqual([CHART_PANEL_ID]);
		expect(envelope.diffSummary).toContain('price_adjustment -> unadjusted');
		expect(envelope.undoToken).not.toBeNull();
	});

	it('rejects a stale expected_revision without mutating anything', () => {
		const before = repository.get('workspace_1');
		expect(() =>
			configure({ panel_id: CHART_PANEL_ID, scale: 'logarithmic' }, { expectedRevision: 99 })
		).toThrow(RevisionConflictError);
		expect(repository.get('workspace_1')).toEqual(before);
	});

	it('replays an already-seen idempotency key without applying the change twice', () => {
		const input = { panel_id: CHART_PANEL_ID, candle_type: 'line' };
		const first = configure(input, { expectedRevision: 1, idempotencyKey: 'key_1' });
		const replay = configure(input, { expectedRevision: 1, idempotencyKey: 'key_1' });
		expect(replay).toEqual(first);
		expect(repository.get('workspace_1')?.revision).toBe(2);
	});

	it('restores the previous view exactly when the undo token is applied', () => {
		configure({ panel_id: CHART_PANEL_ID, scale: 'logarithmic' }, { expectedRevision: 1 });
		const beforeSecond = configOf(repository.get('workspace_1')!);

		const envelope = configure(
			{ panel_id: CHART_PANEL_ID, scale: 'linear', price_adjustment: 'unadjusted' },
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
			configure({ panel_id: CHART_PANEL_ID, session: 'overnight' }, { expectedRevision: 1 })
		).toThrow(OperationValidationError);
		expect(repository.get('workspace_1')).toEqual(before);
	});
});
