import { beforeEach, describe, expect, it } from 'vitest';
import { builtinCatalogRegistry, type CatalogRegistry } from '../../../catalog/registry';
import type { StudyItem } from '../../../catalog/types';
import {
	createChangeHistory,
	undoChange,
	type ChangeHistory
} from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import {
	applyOperations,
	createOperationRegistry,
	previewOperations,
	type OperationRegistry
} from '../../application/operationRegistry';
import { createRevisionService, type RevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { OperationValidationError } from '../../domain/errors';
import { createIdSequencer, type IdSequencer } from '../../domain/ids';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import { emptyWorkspace, type WorkspaceDocument } from '../../domain/workspace';
import {
	createChartState,
	readChartState,
	writeChartState,
	type ChartState
} from '../domain/chartState';
import type { StudyInstance } from '../domain/studies';
import {
	applyEditChartStudies,
	applyStudyOperations,
	CHART_EDIT_STUDIES_KIND,
	createEditChartStudiesOperation,
	derivePane,
	estimateVisibleBars,
	fromWireEditChartStudiesInput,
	registerChartStudyOperations,
	resolveStudyItem,
	validateEditChartStudies,
	validateStoredStudy,
	type StudyOperation
} from './chartStudies';

const WORKSPACE_ID = 'workspace_1';
const PANEL_ID = 'panel_1';

function chartPanelDoc(state?: ChartState): WorkspaceDocument {
	const base: WorkspaceDocument = {
		...emptyWorkspace(WORKSPACE_ID, 'Test', '2026-01-01T00:00:00.000Z'),
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
	return state ? writeChartState(base, state) : base;
}

// A chart wide enough that no study in the catalog out-warms it, so warm-up
// warnings only appear in the tests that ask for them.
function wideChart(): ChartState {
	const state = createChartState(PANEL_ID);
	state.config.range = { kind: 'relative', token: '5y' };
	return state;
}

function edit(
	state: ChartState,
	operations: StudyOperation[],
	ids: IdSequencer = createIdSequencer()
) {
	return applyStudyOperations(state, operations, ids);
}

function expectOk(result: ReturnType<typeof applyStudyOperations>) {
	if (!result.ok) {
		throw new Error(`expected the batch to apply, got: ${result.issues.join(' | ')}`);
	}
	return result.outcome;
}

function expectFailed(result: ReturnType<typeof applyStudyOperations>) {
	if (result.ok) {
		throw new Error('expected the batch to be rejected, but it applied');
	}
	return result.issues;
}

describe('derivePane', () => {
	function pane(id: string) {
		return derivePane(builtinCatalogRegistry.resolveStudy(id) as StudyItem);
	}

	it('overlays price-unit trend studies the catalog tags as overlays', () => {
		expect(pane('study.sma')).toBe('price_overlay');
		expect(pane('study.ema')).toBe('price_overlay');
		expect(pane('study.bollinger_bands')).toBe('price_overlay');
		expect(pane('study.vwap')).toBe('price_overlay');
	});

	it('gives a sub-pane to studies the catalog does not tag as overlays', () => {
		// ATR is in price units but is not an overlay; MACD and RSI are neither.
		expect(pane('study.atr')).toBe('sub_pane');
		expect(pane('study.macd')).toBe('sub_pane');
		expect(pane('study.rsi')).toBe('sub_pane');
	});

	it('refuses the price axis to a bounded oscillator even when tagged an overlay', () => {
		const item = {
			...(builtinCatalogRegistry.resolveStudy('study.sma') as StudyItem),
			outputs: [
				{ name: 'x', valueType: 'number' as const, unit: 'currency', range: { min: 0, max: 100 } }
			]
		};
		expect(derivePane(item)).toBe('sub_pane');
	});

	it('refuses the price axis to an overlay-tagged study with a non-price output', () => {
		const item = {
			...(builtinCatalogRegistry.resolveStudy('study.sma') as StudyItem),
			outputs: [{ name: 'x', valueType: 'number' as const }]
		};
		expect(derivePane(item)).toBe('sub_pane');
	});

	it('refuses the price axis to a study that declares no outputs at all', () => {
		const item = {
			...(builtinCatalogRegistry.resolveStudy('study.sma') as StudyItem),
			outputs: []
		};
		expect(derivePane(item)).toBe('sub_pane');
	});
});

describe('estimateVisibleBars', () => {
	it('divides an explicit window by the timeframe bar length', () => {
		const state = createChartState(PANEL_ID);
		state.config.range = {
			kind: 'explicit',
			start: '2026-01-01T00:00:00.000Z',
			end: '2026-01-31T00:00:00.000Z'
		};
		expect(estimateVisibleBars(state.config)).toBe(30);
	});

	it('has no estimate for an unbounded range, so no warning can be derived from it', () => {
		const state = createChartState(PANEL_ID);
		state.config.range = { kind: 'relative', token: 'max' };
		expect(estimateVisibleBars(state.config)).toBeNull();
	});

	it('counts more bars at a finer timeframe over the same span', () => {
		const daily = createChartState(PANEL_ID);
		daily.config.range = { kind: 'relative', token: '1mo' };
		const hourly = createChartState(PANEL_ID);
		hourly.config.range = { kind: 'relative', token: '1mo' };
		hourly.config.timeframe = '1h';
		const dailyBars = estimateVisibleBars(daily.config) as number;
		const hourlyBars = estimateVisibleBars(hourly.config) as number;
		expect(hourlyBars).toBe(dailyBars * 24);
	});
});

describe('applyStudyOperations - adding', () => {
	it('applies the catalog defaults when parameters are omitted and reports them', () => {
		const outcome = expectOk(edit(wideChart(), [{ op: 'add', catalogItemId: 'study.macd' }]));
		const study = outcome.studies[0] as StudyInstance;
		expect(study.params).toEqual({ fast: 12, slow: 26, signal: 9 });
		expect(outcome.resolvedParams[study.id]).toEqual({ fast: 12, slow: 26, signal: 9 });
	});

	it('accepts explicit parameters and resolves the rest from the catalog', () => {
		const outcome = expectOk(
			edit(wideChart(), [{ op: 'add', catalogItemId: 'study.rsi', params: { length: 7 } }])
		);
		expect((outcome.studies[0] as StudyInstance).params).toEqual({ length: 7 });
	});

	it('mints a distinct instance id for each copy of the same catalog item', () => {
		const outcome = expectOk(
			edit(wideChart(), [
				{ op: 'add', catalogItemId: 'study.sma', params: { length: 50 } },
				{ op: 'add', catalogItemId: 'study.sma', params: { length: 200 } }
			])
		);
		const [first, second] = outcome.studies as StudyInstance[];
		expect(first?.id).not.toBe(second?.id);
		expect(outcome.studies).toHaveLength(2);
		expect(outcome.affectedIds).toEqual([first?.id, second?.id]);
	});

	it('places a study on the pane derived from the catalog, not on one the caller names', () => {
		const outcome = expectOk(
			edit(wideChart(), [
				{ op: 'add', catalogItemId: 'study.sma' },
				{ op: 'add', catalogItemId: 'study.rsi' }
			])
		);
		expect((outcome.studies[0] as StudyInstance).pane).toBe('price_overlay');
		expect((outcome.studies[1] as StudyInstance).pane).toBe('sub_pane');
	});
});

describe('applyStudyOperations - editing existing instances', () => {
	function chartWithTwo(): { state: ChartState; ids: IdSequencer } {
		const ids = createIdSequencer();
		const state = wideChart();
		const outcome = expectOk(
			edit(
				state,
				[
					{ op: 'add', catalogItemId: 'study.sma', params: { length: 50 } },
					{ op: 'add', catalogItemId: 'study.rsi', params: { length: 14 } }
				],
				ids
			)
		);
		return { state: { ...state, studies: outcome.studies }, ids };
	}

	it('keeps the instance id when parameters are updated', () => {
		const { state, ids } = chartWithTwo();
		const target = state.studies[0] as StudyInstance;
		const outcome = expectOk(
			edit(state, [{ op: 'update', studyId: target.id, params: { length: 200 } }], ids)
		);
		const updated = outcome.studies.find((s) => s.id === target.id) as StudyInstance;
		expect(updated.params.length).toBe(200);
		expect(updated.id).toBe(target.id);
	});

	it('keeps every instance id and the toggled study parameters across reorder and toggle', () => {
		const { state, ids } = chartWithTwo();
		const [sma, rsi] = state.studies as StudyInstance[];
		const outcome = expectOk(
			edit(
				state,
				[
					{ op: 'reorder', orderedIds: [rsi!.id, sma!.id] },
					{ op: 'toggle', studyId: rsi!.id },
					{ op: 'toggle', studyId: rsi!.id }
				],
				ids
			)
		);
		const after = outcome.studies.find((s) => s.id === rsi!.id) as StudyInstance;
		expect(outcome.studies.map((s) => s.id).sort()).toEqual([sma!.id, rsi!.id].sort());
		expect(after.enabled).toBe(true);
		expect(after.params).toEqual(rsi!.params);
	});

	it('preserves parameters while a study is toggled off', () => {
		const { state, ids } = chartWithTwo();
		const rsi = state.studies[1] as StudyInstance;
		const outcome = expectOk(edit(state, [{ op: 'toggle', studyId: rsi.id, enabled: false }], ids));
		const off = outcome.studies.find((s) => s.id === rsi.id) as StudyInstance;
		expect(off.enabled).toBe(false);
		expect(off.params).toEqual(rsi.params);
	});

	it('leaves the remaining ids and their relative order untouched by a removal', () => {
		const ids = createIdSequencer();
		const state = wideChart();
		const seeded = expectOk(
			edit(
				state,
				[
					{ op: 'add', catalogItemId: 'study.sma', params: { length: 10 } },
					{ op: 'add', catalogItemId: 'study.ema', params: { length: 20 } },
					{ op: 'add', catalogItemId: 'study.bollinger_bands' }
				],
				ids
			)
		);
		const [first, second, third] = seeded.studies as StudyInstance[];
		const outcome = expectOk(
			edit({ ...state, studies: seeded.studies }, [{ op: 'remove', studyId: second!.id }], ids)
		);
		expect(outcome.studies.map((s) => s.id)).toEqual([first!.id, third!.id]);
		expect(outcome.studies.map((s) => s.order)).toEqual([0, 1]);
	});
});

describe('applyStudyOperations - rejections', () => {
	it('names the unknown item, suggests the closest catalog ids and points at catalog search', () => {
		const issues = expectFailed(edit(wideChart(), [{ op: 'add', catalogItemId: 'study.rsii' }]));
		expect(issues[0]).toContain('study.rsii');
		expect(issues[0]).toContain('study.rsi');
		expect(issues[0]).toContain('search_catalog');
	});

	it('names the parameter, the supplied value and the permitted range', () => {
		const issues = expectFailed(
			edit(wideChart(), [{ op: 'add', catalogItemId: 'study.rsi', params: { length: 9_999 } }])
		);
		expect(issues[0]).toContain('length');
		expect(issues[0]).toContain('9999');
		expect(issues[0]).toContain('from 2 to 200');
	});

	it('rejects a study the catalog does not offer at the chart timeframe', () => {
		const state = wideChart();
		state.config.timeframe = '1h';
		const issues = expectFailed(edit(state, [{ op: 'add', catalogItemId: 'study.sma' }]));
		expect(issues[0]).toContain('1h');
		expect(issues[0]).toContain('interval.1d');
		expect(issues[0]).toContain('search_catalog');
	});

	it('rejects an update whose merged parameters break a cross-parameter constraint', () => {
		const ids = createIdSequencer();
		const state = wideChart();
		const seeded = expectOk(edit(state, [{ op: 'add', catalogItemId: 'study.macd' }], ids));
		const macd = seeded.studies[0] as StudyInstance;
		const issues = expectFailed(
			edit({ ...state, studies: seeded.studies }, [
				{ op: 'update', studyId: macd.id, params: { slow: 5 } }
			])
		);
		expect(issues[0]).toContain('slow');
	});

	it('names the index and shape of the failing operation and applies none of the batch', () => {
		const state = wideChart();
		const result = edit(state, [
			{ op: 'add', catalogItemId: 'study.sma' },
			{ op: 'add', catalogItemId: 'study.not_a_thing' },
			{ op: 'add', catalogItemId: 'study.ema' }
		]);
		const issues = expectFailed(result);
		expect(issues[0]).toContain('operations[1]');
		expect(issues[0]).toContain('add study.not_a_thing');
		expect(state.studies).toEqual([]);
	});

	it('reports an unknown instance id by the id the caller supplied', () => {
		const issues = expectFailed(edit(wideChart(), [{ op: 'remove', studyId: 'study_404' }]));
		expect(issues[0]).toContain('study_404');
	});
});

describe('applyStudyOperations - warm-up warnings', () => {
	function narrowChart(): ChartState {
		const state = createChartState(PANEL_ID);
		state.config.range = {
			kind: 'explicit',
			start: '2026-01-01T00:00:00.000Z',
			end: '2026-01-31T00:00:00.000Z'
		};
		return state;
	}

	it('adds the study but warns that it plots nothing in the current range', () => {
		const outcome = expectOk(
			edit(narrowChart(), [{ op: 'add', catalogItemId: 'study.sma', params: { length: 200 } }])
		);
		expect(outcome.studies).toHaveLength(1);
		expect(outcome.warnings).toHaveLength(1);
		expect(outcome.warnings[0]).toContain('no plotted values in the current range');
	});

	it('stays silent when the study warms up inside the visible range', () => {
		const outcome = expectOk(
			edit(narrowChart(), [{ op: 'add', catalogItemId: 'study.sma', params: { length: 10 } }])
		);
		expect(outcome.warnings).toEqual([]);
	});

	it('warns when an update lengthens a study past the visible range', () => {
		const ids = createIdSequencer();
		const state = narrowChart();
		const seeded = expectOk(
			edit(state, [{ op: 'add', catalogItemId: 'study.sma', params: { length: 10 } }], ids)
		);
		const sma = seeded.studies[0] as StudyInstance;
		const outcome = expectOk(
			edit({ ...state, studies: seeded.studies }, [
				{ op: 'update', studyId: sma.id, params: { length: 400 } }
			])
		);
		expect(outcome.warnings[0]).toContain('no plotted values in the current range');
	});

	it('says nothing about warm-up when the range gives no honest bar estimate', () => {
		const state = createChartState(PANEL_ID);
		state.config.range = { kind: 'relative', token: 'max' };
		const outcome = expectOk(
			edit(state, [{ op: 'add', catalogItemId: 'study.sma', params: { length: 500 } }])
		);
		expect(outcome.warnings).toEqual([]);
	});
});

describe('resolveStudyItem', () => {
	it('rejects a catalog study the chart engine cannot plot', () => {
		const phantom = {
			...(builtinCatalogRegistry.resolveStudy('study.sma') as StudyItem),
			id: 'study.ichimoku',
			label: 'Ichimoku cloud'
		};
		const registry: CatalogRegistry = {
			...builtinCatalogRegistry,
			resolveStudy: (id) => (id === 'study.ichimoku' ? phantom : undefined)
		};
		const result = resolveStudyItem('study.ichimoku', '1d', registry);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues[0]).toContain('cannot plot');
			expect(result.issues[0]).toContain('search_catalog');
		}
	});
});

describe('validateStoredStudy', () => {
	function stored(overrides: Partial<StudyInstance> = {}): StudyInstance {
		return {
			id: 'study_1',
			catalogItemId: 'study.sma',
			params: { length: 20 },
			pane: 'price_overlay',
			order: 0,
			enabled: true,
			...overrides
		};
	}

	it('accepts a well-formed instance on the pane the catalog places it', () => {
		expect(validateStoredStudy(stored(), 'studies[0]', '1d')).toEqual([]);
	});

	it('rejects an instance stored on the wrong pane, naming the derived pane', () => {
		const issues = validateStoredStudy(stored({ pane: 'sub_pane' }), 'studies[0]', '1d');
		expect(issues[0]).toContain('price_overlay');
	});

	it('rejects an instance whose stored parameters are out of the catalog range', () => {
		const issues = validateStoredStudy(stored({ params: { length: 0 } }), 'studies[0]', '1d');
		expect(issues[0]).toContain('length');
	});
});

describe('fromWireEditChartStudiesInput', () => {
	it('converts the wire snake_case into the module camelCase in one place', () => {
		const input = fromWireEditChartStudiesInput({
			panel_id: PANEL_ID,
			operations: [
				{ op: 'add', catalog_item_id: 'study.sma' },
				{ op: 'reorder', ordered_ids: ['study_1'] },
				{ op: 'remove', study_id: 'study_1' }
			]
		});
		expect(input.panelId).toBe(PANEL_ID);
		expect(input.operations).toEqual([
			{ op: 'add', catalogItemId: 'study.sma' },
			{ op: 'reorder', orderedIds: ['study_1'] },
			{ op: 'remove', studyId: 'study_1' }
		]);
	});
});

describe('chart.edit_studies operation', () => {
	it('registers under a namespaced chart kind', () => {
		const registry = createOperationRegistry();
		registerChartStudyOperations(registry);
		expect(registry.kinds()).toEqual([CHART_EDIT_STUDIES_KIND]);
		expect(CHART_EDIT_STUDIES_KIND).toBe('chart.edit_studies');
	});

	it('rejects a panel that is not a chart', () => {
		const doc = emptyWorkspace(WORKSPACE_ID, 'Test', '2026-01-01T00:00:00.000Z');
		const issues = validateEditChartStudies(
			{ panelId: 'panel_9', operations: [{ op: 'add', catalogItemId: 'study.sma' }] },
			doc
		);
		expect(issues[0]).toContain('panel_9');
	});

	it('rejects a malformed operation before touching the catalog', () => {
		const issues = validateEditChartStudies(
			{ panelId: PANEL_ID, operations: [{ op: 'add' } as unknown as StudyOperation] },
			chartPanelDoc()
		);
		expect(issues).toEqual(['operations[0].catalogItemId: required for a "add" operation.']);
	});

	it('rejects an empty batch', () => {
		const issues = validateEditChartStudies({ panelId: PANEL_ID, operations: [] }, chartPanelDoc());
		expect(issues[0]).toContain('at least one study operation');
	});

	it('validates without consuming a real study id or colliding with a live one', () => {
		const ids = createIdSequencer();
		const doc = chartPanelDoc(wideChart());
		const input = {
			panelId: PANEL_ID,
			operations: [{ op: 'add' as const, catalogItemId: 'study.sma' }]
		};
		expect(validateEditChartStudies(input, doc)).toEqual([]);
		const draft = applyEditChartStudies(input, doc, ids);
		// The dry run did not advance the sequencer the apply then used.
		expect(draft.affectedIds).toEqual(['study_1']);
	});

	it('seeds the dry run above the ids already on the chart', () => {
		const ids = createIdSequencer();
		const doc = chartPanelDoc(wideChart());
		const first = applyEditChartStudies(
			{ panelId: PANEL_ID, operations: [{ op: 'add', catalogItemId: 'study.sma' }] },
			doc,
			ids
		);
		const issues = validateEditChartStudies(
			{ panelId: PANEL_ID, operations: [{ op: 'add', catalogItemId: 'study.ema' }] },
			first.document
		);
		expect(issues).toEqual([]);
	});

	it('carries the warm-up warning onto the mutation draft', () => {
		const state = createChartState(PANEL_ID);
		state.config.range = {
			kind: 'explicit',
			start: '2026-01-01T00:00:00.000Z',
			end: '2026-01-31T00:00:00.000Z'
		};
		const draft = applyEditChartStudies(
			{
				panelId: PANEL_ID,
				operations: [{ op: 'add', catalogItemId: 'study.sma', params: { length: 200 } }]
			},
			chartPanelDoc(state),
			createIdSequencer()
		);
		expect(draft.warnings?.[0]).toContain('no plotted values in the current range');
	});

	it('inverts to the pre-edit document, so undo restores the previous study set exactly', () => {
		const doc = chartPanelDoc(wideChart());
		const draft = applyEditChartStudies(
			{ panelId: PANEL_ID, operations: [{ op: 'add', catalogItemId: 'study.sma' }] },
			doc,
			createIdSequencer()
		);
		expect(draft.inverse?.document).toEqual(doc);
		expect(readChartState(draft.inverse!.document, PANEL_ID).studies).toEqual([]);
	});

	it('throws OperationValidationError rather than applying a partly valid batch', () => {
		const doc = chartPanelDoc(wideChart());
		expect(() =>
			applyEditChartStudies(
				{
					panelId: PANEL_ID,
					operations: [
						{ op: 'add', catalogItemId: 'study.sma' },
						{ op: 'add', catalogItemId: 'study.nope' }
					]
				},
				doc,
				createIdSequencer()
			)
		).toThrow(OperationValidationError);
	});

	it('previews without mutating the document it is given', () => {
		const registry = createOperationRegistry();
		registerChartStudyOperations(registry);
		const doc = chartPanelDoc(wideChart());
		const result = previewOperations(
			[
				{
					kind: CHART_EDIT_STUDIES_KIND,
					input: { panelId: PANEL_ID, operations: [{ op: 'add', catalogItemId: 'study.rsi' }] }
				}
			],
			{ registry, document: doc, ids: createIdSequencer() }
		);
		expect(result.valid).toBe(true);
		expect(result.diffSummary).toContain('study.rsi');
		expect(readChartState(doc, PANEL_ID).studies).toEqual([]);
	});
});

describe('chart.edit_studies through the shared mutation path', () => {
	let registry: OperationRegistry;
	let repository: WorkspaceRepository;
	let revisionService: RevisionService;
	let history: ChangeHistory;
	let clock: Clock;
	let ids: IdSequencer;

	beforeEach(() => {
		registry = createOperationRegistry();
		registry.register(createEditChartStudiesOperation());
		repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(chartPanelDoc(wideChart()));
		clock = { now: () => '2026-01-02T00:00:00.000Z' };
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
		return { registry, workspaceId: WORKSPACE_ID, history, revisionService, clock, ids };
	}

	function editOp(operations: StudyOperation[]) {
		return { kind: CHART_EDIT_STUDIES_KIND, input: { panelId: PANEL_ID, operations } };
	}

	it('returns an envelope listing every instance the batch touched, with an undo token', () => {
		const envelope = applyOperations(
			[
				editOp([
					{ op: 'add', catalogItemId: 'study.sma' },
					{ op: 'add', catalogItemId: 'study.rsi' }
				])
			],
			{ expectedRevision: 1, actor: 'agent' },
			deps()
		);
		expect(envelope.affectedIds).toEqual(['study_1', 'study_2']);
		expect(envelope.undoToken).not.toBeNull();
		expect(readChartState(repository.get(WORKSPACE_ID)!, PANEL_ID).studies).toHaveLength(2);
	});

	it('restores the previous study set exactly when the undo token is redeemed', () => {
		applyOperations(
			[editOp([{ op: 'add', catalogItemId: 'study.sma' }])],
			{ expectedRevision: 1, actor: 'agent' },
			deps()
		);
		const before = readChartState(repository.get(WORKSPACE_ID)!, PANEL_ID).studies;
		const envelope = applyOperations(
			[
				editOp([
					{ op: 'add', catalogItemId: 'study.rsi' },
					{ op: 'add', catalogItemId: 'study.ema' }
				])
			],
			{ expectedRevision: 2, actor: 'agent' },
			deps()
		);

		undoChange(envelope.undoToken!, {
			history,
			revisionService,
			clock,
			context: { actor: 'agent' }
		});

		expect(readChartState(repository.get(WORKSPACE_ID)!, PANEL_ID).studies).toEqual(before);
	});

	it('leaves the stored workspace untouched when any operation in the batch is invalid', () => {
		const before = repository.get(WORKSPACE_ID);
		expect(() =>
			applyOperations(
				[
					editOp([
						{ op: 'add', catalogItemId: 'study.sma' },
						{ op: 'update', studyId: 'study_404', params: { length: 5 } }
					])
				],
				{ expectedRevision: 1, actor: 'agent' },
				deps()
			)
		).toThrow(OperationValidationError);
		expect(repository.get(WORKSPACE_ID)).toEqual(before);
	});

	it('replays a repeated idempotency key without adding the studies twice', () => {
		const context = { expectedRevision: 1, actor: 'agent' as const, idempotencyKey: 'key_1' };
		const first = applyOperations(
			[editOp([{ op: 'add', catalogItemId: 'study.sma' }])],
			context,
			deps()
		);
		const second = applyOperations(
			[editOp([{ op: 'add', catalogItemId: 'study.sma' }])],
			context,
			deps()
		);
		expect(second.changeId).toBe(first.changeId);
		expect(readChartState(repository.get(WORKSPACE_ID)!, PANEL_ID).studies).toHaveLength(1);
	});
});
