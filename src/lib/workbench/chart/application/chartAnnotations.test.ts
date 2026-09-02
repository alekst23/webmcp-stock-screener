import { beforeEach, describe, expect, it } from 'vitest';
import { createIdSequencer } from '../../domain/ids';
import type { IdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import type { WorkspaceDocument } from '../../domain/workspace';
import { createOperationRegistry } from '../../application/operationRegistry';
import type { ChartConfig, ChartRange } from '../domain/chartState';
import { createChartState, readChartState, writeChartState } from '../domain/chartState';
import {
	CHART_ADD_ANNOTATION_KIND,
	anchorShapeIssues,
	createAddChartAnnotationOperation,
	describeChartRange,
	ensureAddChartAnnotationOperation,
	outOfRangeIssues,
	readChartAnnotationsView,
	resolveChartRange
} from './chartAnnotations';
import type { AddChartAnnotationInput } from './chartAnnotations';

const NOW = '2026-09-02T00:00:00.000Z';
const PANEL_ID = 'panel_chart_1';

function fixedClock(iso: string): Clock {
	return { now: () => iso };
}

function workspaceWithChart(config?: Partial<ChartConfig>): WorkspaceDocument {
	const doc: WorkspaceDocument = {
		...emptyWorkspace('workspace_1', 'Research', NOW),
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
	const base = createChartState(PANEL_ID);
	return writeChartState(doc, { ...base, config: { ...base.config, ...config } });
}

// A window comfortably inside the default relative 6mo range at NOW.
const IN_RANGE_A = '2026-07-01T00:00:00.000Z';
const IN_RANGE_B = '2026-08-01T00:00:00.000Z';

describe('resolveChartRange', () => {
	it('passes an explicit range through unchanged', () => {
		const range: ChartRange = { kind: 'explicit', start: IN_RANGE_A, end: IN_RANGE_B };
		expect(resolveChartRange(range, NOW)).toEqual({ start: IN_RANGE_A, end: IN_RANGE_B });
	});

	it('resolves a relative token backwards from now', () => {
		const resolved = resolveChartRange({ kind: 'relative', token: '6mo' }, NOW);
		expect(resolved).toEqual({ start: '2026-03-02T00:00:00.000Z', end: NOW });
	});

	it('resolves ytd to the first day of the current year', () => {
		const resolved = resolveChartRange({ kind: 'relative', token: 'ytd' }, NOW);
		expect(resolved?.start).toBe('2026-01-01T00:00:00.000Z');
	});

	it('treats max as unbounded rather than as a very old start date', () => {
		expect(resolveChartRange({ kind: 'relative', token: 'max' }, NOW)).toBeNull();
	});
});

describe('describeChartRange', () => {
	it('names a relative token alongside the window it resolves to', () => {
		const described = describeChartRange({ kind: 'relative', token: '6mo' }, NOW);
		expect(described).toBe('relative "6mo" (2026-03-02T00:00:00.000Z to 2026-09-02T00:00:00.000Z)');
	});

	it('names an explicit range by its bounds', () => {
		const range: ChartRange = { kind: 'explicit', start: IN_RANGE_A, end: IN_RANGE_B };
		expect(describeChartRange(range, NOW)).toBe(`explicit ${IN_RANGE_A} to ${IN_RANGE_B}`);
	});
});

describe('anchorShapeIssues', () => {
	it('accepts anchors that fit the kind', () => {
		expect(anchorShapeIssues('price_level', { price: 100 })).toEqual([]);
		expect(
			anchorShapeIssues('trendline', {
				from: { time: IN_RANGE_A, price: 1 },
				to: { time: IN_RANGE_B, price: 2 }
			})
		).toEqual([]);
	});

	it('rejects a price sent for a date range, naming what a date range expects', () => {
		const issues = anchorShapeIssues('date_range', { price: 100 });
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain('a `start` and `end` ISO timestamp');
		expect(issues[0]).toContain('missing start, end');
		expect(issues[0]).toContain('unexpected price');
	});

	it('rejects a single point sent for a trendline, naming the two it expects', () => {
		const issues = anchorShapeIssues('trendline', { at: { time: IN_RANGE_A, price: 1 } });
		expect(issues[0]).toContain('two {time, price} points as `from` and `to`');
		expect(issues[0]).toContain('missing from, to');
	});

	it('rejects a label without its text', () => {
		const issues = anchorShapeIssues('label', { at: { time: IN_RANGE_A, price: 1 } });
		expect(issues[0]).toContain('missing text');
	});

	it('rejects anchors that are not an object at all', () => {
		expect(anchorShapeIssues('price_level', null)[0]).toContain('a single finite `price`');
	});
});

describe('outOfRangeIssues', () => {
	const annotation = {
		id: 'annotation_1',
		kind: 'date_range' as const,
		anchors: {
			kind: 'date_range' as const,
			start: '2020-01-01T00:00:00.000Z',
			end: '2020-02-01T00:00:00.000Z'
		},
		priceAdjustment: 'adjusted' as const
	};

	it('names the chart range an anchor falls outside of', () => {
		const issues = outOfRangeIssues(annotation, { kind: 'relative', token: '6mo' }, NOW);
		expect(issues.length).toBeGreaterThan(0);
		expect(issues[0]).toContain('relative "6mo"');
		expect(issues[0]).toContain('2026-03-02T00:00:00.000Z');
	});

	it('accepts anything when the range is unbounded', () => {
		expect(outOfRangeIssues(annotation, { kind: 'relative', token: 'max' }, NOW)).toEqual([]);
	});
});

describe('chart.add_annotation operation', () => {
	let doc: WorkspaceDocument;
	let ids: IdSequencer;
	const operation = createAddChartAnnotationOperation({ clock: fixedClock(NOW) });

	beforeEach(() => {
		doc = workspaceWithChart();
		ids = createIdSequencer();
	});

	function input(overrides: Partial<AddChartAnnotationInput>): AddChartAnnotationInput {
		return {
			panelId: PANEL_ID,
			kind: 'price_level',
			anchors: { price: 100 },
			...overrides
		};
	}

	function add(overrides: Partial<AddChartAnnotationInput>): WorkspaceDocument {
		const request = input(overrides);
		const issues = operation.validate(request, doc);
		expect(issues).toEqual([]);
		return operation.apply(request, doc, ids).document;
	}

	it('is namespaced so the shared registry accepts it', () => {
		const registry = createOperationRegistry();
		registry.register(operation);
		expect(registry.kinds()).toContain(CHART_ADD_ANNOTATION_KIND);
	});

	it('ensureAddChartAnnotationOperation is safe to call twice', () => {
		const registry = createOperationRegistry();
		ensureAddChartAnnotationOperation(registry, { clock: fixedClock(NOW) });
		expect(() =>
			ensureAddChartAnnotationOperation(registry, { clock: fixedClock(NOW) })
		).not.toThrow();
		expect(registry.kinds()).toEqual([CHART_ADD_ANNOTATION_KIND]);
	});

	it('adds each of the five kinds at its own anchors', () => {
		const requests: AddChartAnnotationInput[] = [
			input({
				kind: 'trendline',
				anchors: {
					from: { time: IN_RANGE_A, price: 10 },
					to: { time: IN_RANGE_B, price: 20 }
				}
			}),
			input({ kind: 'price_level', anchors: { price: 42.5 } }),
			input({ kind: 'date_range', anchors: { start: IN_RANGE_A, end: IN_RANGE_B } }),
			input({ kind: 'setup_window', anchors: { start: IN_RANGE_A, end: IN_RANGE_B } }),
			input({ kind: 'label', anchors: { at: { time: IN_RANGE_A, price: 11 }, text: 'gap' } })
		];
		let current = doc;
		for (const request of requests) {
			expect(operation.validate(request, current)).toEqual([]);
			current = operation.apply(request, current, ids).document;
		}
		const kinds = readChartState(current, PANEL_ID).annotations.map((a) => a.kind);
		expect(kinds).toEqual(['trendline', 'price_level', 'date_range', 'setup_window', 'label']);
	});

	it('mints a distinct annotation_N id for each annotation of the same kind', () => {
		let current = doc;
		for (const price of [100, 110, 120]) {
			current = operation.apply(input({ anchors: { price } }), current, ids).document;
		}
		const idsIssued = readChartState(current, PANEL_ID).annotations.map((a) => a.id);
		expect(idsIssued).toEqual(['annotation_1', 'annotation_2', 'annotation_3']);
	});

	it('reports the new annotation id and the panel in affectedIds', () => {
		const draft = operation.apply(input({}), doc, ids);
		expect(draft.affectedIds).toContain('annotation_1');
		expect(draft.affectedIds).toContain(PANEL_ID);
	});

	it('offers an inverse that removes exactly the annotation it added', () => {
		const draft = operation.apply(input({}), doc, ids);
		const reverted = draft.inverse?.document;
		expect(reverted).toBeDefined();
		expect(readChartState(reverted!, PANEL_ID).annotations).toEqual([]);
		expect(draft.inverse?.diffSummary).toContain('annotation_1');
	});

	it('rejects a panel that is not a chart', () => {
		const withTable: WorkspaceDocument = {
			...doc,
			panels: [{ ...doc.panels[0]!, kind: 'results_table' }]
		};
		expect(operation.validate(input({}), withTable)[0]).toContain('not a chart');
	});

	it('rejects an unknown panel id', () => {
		expect(operation.validate(input({ panelId: 'panel_9' }), doc)[0]).toContain(
			'is not a panel in this workspace'
		);
	});

	it('rejects anchors that do not fit the kind', () => {
		const issues = operation.validate(input({ kind: 'trendline', anchors: { price: 100 } }), doc);
		expect(issues[0]).toContain('two {time, price} points as `from` and `to`');
	});

	it('rejects an anchor outside the chart range, naming the range', () => {
		const issues = operation.validate(
			input({ kind: 'date_range', anchors: { start: '2020-01-01', end: '2020-02-01' } }),
			doc
		);
		expect(issues[0]).toContain("outside the chart's configured range");
		expect(issues[0]).toContain('relative "6mo"');
	});

	it('rejects an end that precedes its start', () => {
		const issues = operation.validate(
			input({ kind: 'setup_window', anchors: { start: IN_RANGE_B, end: IN_RANGE_A } }),
			doc
		);
		expect(issues[0]).toContain('must be after');
	});

	it('rejects a NaN price', () => {
		expect(operation.validate(input({ anchors: { price: Number.NaN } }), doc)[0]).toContain(
			'is not a finite price'
		);
	});

	it('rejects an infinite price', () => {
		expect(
			operation.validate(input({ anchors: { price: Number.POSITIVE_INFINITY } }), doc)[0]
		).toContain('is not a finite price');
	});

	it('stamps the chart price-adjustment policy in force when drawn', () => {
		const unadjusted = workspaceWithChart({ priceAdjustment: 'unadjusted' });
		const next = operation.apply(input({}), unadjusted, ids).document;
		expect(readChartState(next, PANEL_ID).annotations[0]!.priceAdjustment).toBe('unadjusted');
	});

	it('keeps an optional label verbatim', () => {
		const next = add({ label: 'resistance — retested twice' });
		expect(readChartState(next, PANEL_ID).annotations[0]!.label).toBe(
			'resistance — retested twice'
		);
	});
});

describe('readChartAnnotationsView', () => {
	const operation = createAddChartAnnotationOperation({ clock: fixedClock(NOW) });

	function drawPriceLevelOnUnadjusted(): WorkspaceDocument {
		const doc = workspaceWithChart({ priceAdjustment: 'unadjusted' });
		return operation.apply(
			{ panelId: PANEL_ID, kind: 'price_level', anchors: { price: 100 }, label: 'resistance' },
			doc,
			createIdSequencer()
		).document;
	}

	function switchPolicyToAdjusted(doc: WorkspaceDocument): WorkspaceDocument {
		const state = readChartState(doc, PANEL_ID);
		return writeChartState(doc, {
			...state,
			config: { ...state.config, priceAdjustment: 'adjusted' }
		});
	}

	it("does not flag an annotation drawn under the chart's current policy", () => {
		const view = readChartAnnotationsView(drawPriceLevelOnUnadjusted(), PANEL_ID);
		expect(view.annotations[0]!.stale).toBe(false);
		expect(view.staleIds).toEqual([]);
	});

	it('flags a price level stale once the chart switches adjustment policy', () => {
		const drawn = drawPriceLevelOnUnadjusted();
		const switched = switchPolicyToAdjusted(drawn);
		const view = readChartAnnotationsView(switched, PANEL_ID);
		expect(view.priceAdjustment).toBe('adjusted');
		expect(view.annotations[0]!.stale).toBe(true);
		expect(view.staleIds).toEqual(['annotation_1']);
	});

	it('never re-plots the stale annotation: its stored price is untouched', () => {
		const switched = switchPolicyToAdjusted(drawPriceLevelOnUnadjusted());
		const anchors = readChartAnnotationsView(switched, PANEL_ID).annotations[0]!.annotation.anchors;
		expect(anchors).toEqual({ kind: 'price_level', price: 100 });
	});

	it('does not flag a date range, whose bars mean the same under either policy', () => {
		const doc = workspaceWithChart({ priceAdjustment: 'unadjusted' });
		const drawn = operation.apply(
			{ panelId: PANEL_ID, kind: 'date_range', anchors: { start: IN_RANGE_A, end: IN_RANGE_B } },
			doc,
			createIdSequencer()
		).document;
		const view = readChartAnnotationsView(switchPolicyToAdjusted(drawn), PANEL_ID);
		expect(view.staleIds).toEqual([]);
	});

	it('warns about already-stale annotations when a new one is added', () => {
		const switched = switchPolicyToAdjusted(drawPriceLevelOnUnadjusted());
		const draft = operation.apply(
			{ panelId: PANEL_ID, kind: 'price_level', anchors: { price: 120 } },
			switched,
			createIdSequencer()
		);
		expect(draft.warnings?.[0]).toContain('annotation_1');
		expect(draft.warnings?.[0]).toContain('stale');
	});

	it('keeps anchors attached to the same times and prices across range changes', () => {
		const doc = workspaceWithChart();
		const drawn = operation.apply(
			{
				panelId: PANEL_ID,
				kind: 'trendline',
				anchors: { from: { time: IN_RANGE_A, price: 10 }, to: { time: IN_RANGE_B, price: 20 } }
			},
			doc,
			createIdSequencer()
		).document;
		const before = readChartAnnotationsView(drawn, PANEL_ID).annotations[0]!.annotation.anchors;

		const scrolledAway = withRange(drawn, {
			kind: 'explicit',
			start: '2019-01-01',
			end: '2019-06-01'
		});
		// The window it was drawn in is now off-screen entirely. A renderer that
		// re-derived anchors from the visible range, or dropped what it could not
		// see, would lose the annotation here rather than on the way back.
		const away = readChartAnnotationsView(scrolledAway, PANEL_ID).annotations;
		expect(away).toHaveLength(1);
		expect(away[0]!.annotation.anchors).toEqual(before);

		const scrolledBack = withRange(scrolledAway, { kind: 'relative', token: '6mo' });
		const after = readChartAnnotationsView(scrolledBack, PANEL_ID).annotations[0]!.annotation
			.anchors;
		expect(after).toEqual(before);
	});

	function withRange(doc: WorkspaceDocument, range: ChartRange): WorkspaceDocument {
		const state = readChartState(doc, PANEL_ID);
		return writeChartState(doc, { ...state, config: { ...state.config, range } });
	}
});
