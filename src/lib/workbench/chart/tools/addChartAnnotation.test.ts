import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import type { WorkspaceDocument } from '../../domain/workspace';
import { createChangeHistory, undoChange } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import type { ChartPriceAdjustment, ChartRange } from '../domain/chartState';
import { createChartState, readChartState, writeChartState } from '../domain/chartState';
import { buildAddChartAnnotationTool } from './addChartAnnotation';
import type { AddChartAnnotationDeps } from './addChartAnnotation';

const NOW = '2026-09-02T00:00:00.000Z';
const PANEL_ID = 'panel_chart_1';
const WORKSPACE_ID = 'workspace_1';
const IN_RANGE_A = '2026-07-01T00:00:00.000Z';
const IN_RANGE_B = '2026-08-01T00:00:00.000Z';

const clock: Clock = { now: () => NOW };

interface AnnotationPayload {
	annotation_id: string;
	kind: string;
	anchors: unknown;
	price_adjustment: ChartPriceAdjustment;
	stale: boolean;
	label?: string;
}

interface SuccessPayload {
	change_id: string;
	new_revision: number;
	affected_ids: string[];
	warnings: string[];
	undo_token: string | null;
	price_adjustment: ChartPriceAdjustment;
	annotation: AnnotationPayload | null;
	annotations: AnnotationPayload[];
	stale_annotation_ids: string[];
}

interface FailurePayload {
	error: string;
	message: string;
	issues?: string[];
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

// Validation failures come back as EPIC-1006's wire error: a code in `error`,
// the sentence in `message`, and the individual complaints in `issues`.
function issuesOf(result: { content: { type: 'text'; text: string }[] }): string {
	const body = jsonOf(result) as FailurePayload;
	return [body.message, ...(body.issues ?? [])].join(' ');
}

describe('add_chart_annotation', () => {
	let deps: AddChartAnnotationDeps;
	let tool: ToolSpec;

	function seedWorkspace(priceAdjustment?: ChartPriceAdjustment): void {
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
		deps.repository.put(
			writeChartState(base, {
				...state,
				config: { ...state.config, ...(priceAdjustment ? { priceAdjustment } : {}) }
			})
		);
		deps.repository.setActiveId(WORKSPACE_ID);
	}

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const ids = createIdSequencer();
		const idempotency = createIdempotencyCache();
		deps = {
			repository,
			revisions: createRevisionService({ repository, clock, ids, idempotency }),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			clock,
			ids
		};
		tool = buildAddChartAnnotationTool(deps);
		seedWorkspace();
	});

	async function add(input: Record<string, unknown>) {
		return tool.execute({ panel_id: PANEL_ID, ...input });
	}

	function currentDoc(): WorkspaceDocument {
		const doc = deps.repository.get(WORKSPACE_ID);
		if (!doc) throw new Error('workspace vanished');
		return doc;
	}

	function reconfigure(patch: {
		priceAdjustment?: ChartPriceAdjustment;
		range?: ChartRange;
	}): void {
		const doc = currentDoc();
		const state = readChartState(doc, PANEL_ID);
		deps.repository.put(writeChartState(doc, { ...state, config: { ...state.config, ...patch } }));
	}

	it('is named add_chart_annotation and is always available', () => {
		expect(tool.name).toBe('add_chart_annotation');
		expect(tool.available()).toBe(true);
	});

	it('registers the chart.add_annotation operation it commits through', () => {
		expect(deps.registry.kinds()).toEqual(['chart.add_annotation']);
	});

	it('adds a trendline and returns a stable annotation id', async () => {
		const result = await add({
			kind: 'trendline',
			anchors: { from: { time: IN_RANGE_A, price: 10 }, to: { time: IN_RANGE_B, price: 20 } }
		});
		expect(result.isError).toBeUndefined();
		const body = jsonOf(result) as SuccessPayload;
		expect(body.annotation?.annotation_id).toBe('annotation_1');
		expect(body.affected_ids).toContain('annotation_1');
		expect(readChartState(currentDoc(), PANEL_ID).annotations).toHaveLength(1);
	});

	it('adds every one of the five kinds', async () => {
		await add({
			kind: 'trendline',
			anchors: { from: { time: IN_RANGE_A, price: 10 }, to: { time: IN_RANGE_B, price: 20 } }
		});
		await add({ kind: 'price_level', anchors: { price: 42 } });
		await add({ kind: 'date_range', anchors: { start: IN_RANGE_A, end: IN_RANGE_B } });
		await add({ kind: 'setup_window', anchors: { start: IN_RANGE_A, end: IN_RANGE_B } });
		const last = await add({
			kind: 'label',
			anchors: { at: { time: IN_RANGE_A, price: 11 }, text: 'gap' }
		});
		const body = jsonOf(last) as SuccessPayload;
		expect(body.annotations.map((a) => a.kind)).toEqual([
			'trendline',
			'price_level',
			'date_range',
			'setup_window',
			'label'
		]);
	});

	it('gives several annotations of the same kind distinct ids', async () => {
		const first = jsonOf(await add({ kind: 'price_level', anchors: { price: 100 } }));
		const second = jsonOf(await add({ kind: 'price_level', anchors: { price: 110 } }));
		const firstId = (first as SuccessPayload).annotation?.annotation_id;
		const secondId = (second as SuccessPayload).annotation?.annotation_id;
		expect(firstId).toBe('annotation_1');
		expect(secondId).toBe('annotation_2');
	});

	it('rejects anchors that do not fit the kind, naming what was expected', async () => {
		const result = await add({ kind: 'trendline', anchors: { price: 100 } });
		expect(result.isError).toBe(true);
		expect(issuesOf(result)).toContain('two {time, price} points as `from` and `to`');
	});

	it("rejects an out-of-range anchor, naming the chart's current range", async () => {
		const result = await add({
			kind: 'date_range',
			anchors: { start: '2020-01-01T00:00:00.000Z', end: '2020-02-01T00:00:00.000Z' }
		});
		expect(result.isError).toBe(true);
		expect(issuesOf(result)).toContain('relative "6mo"');
		expect(readChartState(currentDoc(), PANEL_ID).annotations).toEqual([]);
	});

	it('rejects an end that precedes its start', async () => {
		const result = await add({
			kind: 'setup_window',
			anchors: { start: IN_RANGE_B, end: IN_RANGE_A }
		});
		expect(result.isError).toBe(true);
		expect(issuesOf(result)).toContain('must be after');
	});

	it('rejects a non-finite price', async () => {
		const result = await add({ kind: 'price_level', anchors: { price: Number.NaN } });
		expect(result.isError).toBe(true);
		expect(issuesOf(result)).toContain('is not a finite price');
	});

	it('returns an optional label verbatim in the payload and in later reads', async () => {
		const note = 'resistance — retested twice';
		await add({ kind: 'price_level', anchors: { price: 100 }, label: note });
		const later = jsonOf(
			await add({ kind: 'price_level', anchors: { price: 110 } })
		) as SuccessPayload;
		expect(later.annotations[0]!.label).toBe(note);
	});

	it('honours expected_revision and rejects a stale one', async () => {
		const ok = await add({
			kind: 'price_level',
			anchors: { price: 100 },
			expected_revision: currentDoc().revision
		});
		expect(ok.isError).toBeUndefined();
		const conflict = await add({
			kind: 'price_level',
			anchors: { price: 110 },
			expected_revision: 1
		});
		expect(conflict.isError).toBe(true);
		expect((jsonOf(conflict) as FailurePayload).error).toBe('revision_conflict');
	});

	it('replays an idempotency key instead of adding a second annotation', async () => {
		const input = { kind: 'price_level', anchors: { price: 100 }, idempotency_key: 'key-1' };
		const first = jsonOf(await add(input)) as SuccessPayload;
		const replay = jsonOf(await add(input)) as SuccessPayload;
		expect(replay.change_id).toBe(first.change_id);
		expect(readChartState(currentDoc(), PANEL_ID).annotations).toHaveLength(1);
	});

	it('returns an undo token that removes the annotation', async () => {
		const body = jsonOf(
			await add({ kind: 'price_level', anchors: { price: 100 } })
		) as SuccessPayload;
		expect(body.undo_token).not.toBeNull();
		undoChange(body.undo_token!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock: deps.clock,
			context: { actor: 'agent' }
		});
		expect(readChartState(currentDoc(), PANEL_ID).annotations).toEqual([]);
	});

	it('flags a price level stale after the chart switches adjustment policy', async () => {
		seedWorkspace('unadjusted');
		const drawn = jsonOf(
			await add({ kind: 'price_level', anchors: { price: 100 } })
		) as SuccessPayload;
		expect(drawn.annotation?.price_adjustment).toBe('unadjusted');
		expect(drawn.annotation?.stale).toBe(false);

		reconfigure({ priceAdjustment: 'adjusted' });

		const after = jsonOf(
			await add({ kind: 'price_level', anchors: { price: 120 } })
		) as SuccessPayload;
		expect(after.price_adjustment).toBe('adjusted');
		expect(after.stale_annotation_ids).toEqual(['annotation_1']);
		expect(after.annotations[0]!.stale).toBe(true);
		// The stored price is untouched, not re-plotted onto the new basis.
		expect(after.annotations[0]!.anchors).toEqual({ kind: 'price_level', price: 100 });
		expect(after.warnings.join(' ')).toContain('annotation_1');
	});

	it('keeps anchors attached to the same times and prices across range changes', async () => {
		const drawn = jsonOf(
			await add({
				kind: 'trendline',
				anchors: { from: { time: IN_RANGE_A, price: 10 }, to: { time: IN_RANGE_B, price: 20 } }
			})
		) as SuccessPayload;

		reconfigure({ range: { kind: 'explicit', start: '2019-01-01', end: '2019-06-01' } });
		// Off-screen is not gone: the stored anchors are data coordinates, so
		// nothing about them depends on what the chart currently shows.
		const away = readChartState(currentDoc(), PANEL_ID).annotations;
		expect(away).toHaveLength(1);
		expect(away[0]!.anchors).toEqual(drawn.annotation?.anchors);

		reconfigure({ range: { kind: 'relative', token: '6mo' } });

		const back = jsonOf(
			await add({ kind: 'price_level', anchors: { price: 15 } })
		) as SuccessPayload;
		expect(back.annotations[0]!.anchors).toEqual(drawn.annotation?.anchors);
	});

	it('fails clearly when the panel is not a chart', async () => {
		const doc = currentDoc();
		deps.repository.put({ ...doc, panels: [{ ...doc.panels[0]!, kind: 'results_table' }] });
		const result = await add({ kind: 'price_level', anchors: { price: 100 } });
		expect(result.isError).toBe(true);
		expect(issuesOf(result)).toContain('not a chart');
	});

	it('fails when there is no active workspace', async () => {
		const bare = createLocalWorkspaceRepository(memoryStorage());
		const bareTool = buildAddChartAnnotationTool({ ...deps, repository: bare });
		const result = await bareTool.execute({ panel_id: PANEL_ID, kind: 'price_level', anchors: {} });
		expect(result.isError).toBe(true);
		const body = jsonOf(result) as FailurePayload;
		expect(body.error).toBe('not_found');
		expect(body.message).toContain('No active workspace');
	});
});
