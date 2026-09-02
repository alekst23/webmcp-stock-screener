import { beforeEach, describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../../../catalog/registry';
import { createScreener } from '../../../screener/definition';
import { readScreener, writeScreener } from '../../../screener/state';
import { createChangeHistory, undoChange } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import type { RevisionService } from '../../application/revisionService';
import type { CapturedChartSetup } from '../../chart/domain/capturedSetup';
import { writeCapturedSetup } from '../../chart/domain/capturedSetup';
import { createIdSequencer } from '../../domain/ids';
import type { IdSequencer } from '../../domain/ids';
import { makeProvenance } from '../../domain/provenance';
import { emptyWorkspace } from '../../domain/workspace';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { readFilterDraft, readFilterDrafts } from '../domain/filterDraft';
import {
	buildDeriveFiltersFromSetupTool,
	type DeriveFiltersFromSetupDeps
} from './deriveFiltersFromSetup';
import type { ToolResult } from '../../../webmcp/types';

function fixedClock(iso: string) {
	return { now: () => iso };
}

function payload(result: ToolResult): Record<string, unknown> {
	const text = result.content[0]?.text;
	if (text === undefined) {
		throw new Error(`tool result carried no content: ${JSON.stringify(result)}`);
	}
	return JSON.parse(text) as Record<string, unknown>;
}

const provenance = makeProvenance({
	asOf: '2026-01-01T00:00:00.000Z',
	sourceId: 'src.prices.eodhd',
	sourceLabel: 'EODHD',
	liveness: 'end_of_day',
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'adjusted'
});

function capturedSetup(overrides: Partial<CapturedChartSetup> = {}): CapturedChartSetup {
	return {
		setupId: 'setup_1',
		capturedAt: '2026-01-01T00:00:00.000Z',
		workspaceRevision: 1,
		sourcePanelId: 'panel_1',
		instrument: {
			instrumentId: 'inst:XNAS:AAPL',
			symbol: 'AAPL',
			exchange: 'XNAS',
			assetType: 'equity'
		},
		window: {
			start: '2025-07-01T00:00:00.000Z',
			end: '2026-01-01T00:00:00.000Z',
			timeframe: '1d',
			session: 'regular',
			barCount: 128
		},
		candleType: 'candlestick',
		scale: 'linear',
		priceAdjustment: 'adjusted',
		normalization: { mode: 'none', anchor: 'window_start' },
		studies: [
			{
				studyId: 'study_1',
				catalogItemId: 'study.sma',
				params: { length: 20 },
				pane: 'price_overlay',
				order: 0,
				enabled: true
			}
		],
		comparisons: [],
		annotations: [
			{
				annotationId: 'annotation_1',
				kind: 'price_level',
				anchors: { kind: 'price_level', price: 150 },
				priceAdjustment: 'adjusted'
			}
		],
		provenance,
		...overrides
	};
}

describe('derive_filters_from_setup tool', () => {
	let deps: DeriveFiltersFromSetupDeps;
	let workspaceId: string;
	let screenerId: string;
	let revisions: RevisionService;
	let ids: IdSequencer;

	function currentDoc() {
		return deps.repository.get(workspaceId)!;
	}

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const clock = fixedClock('2026-01-01T00:00:00.000Z');
		ids = createIdSequencer();
		const idempotency = createIdempotencyCache();
		revisions = createRevisionService({ repository, clock, ids, idempotency });
		deps = {
			repository,
			revisions,
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			clock,
			ids,
			catalog: builtinCatalogRegistry
		};

		let workspace = emptyWorkspace('workspace_1', 'W', clock.now());
		const screener = createScreener(ids, workspace.id, 'S');
		workspace = writeScreener(workspace, screener);
		workspace = writeCapturedSetup(workspace, capturedSetup());
		repository.put(workspace);
		repository.setActiveId(workspace.id);

		workspaceId = workspace.id;
		screenerId = screener.screenerId;
	});

	function tool() {
		return buildDeriveFiltersFromSetupTool(deps);
	}

	it('derives a draft with a stable id and typed, traceable conditions (AC1-3)', async () => {
		const result = await tool().execute({ setup_id: 'setup_1' });
		expect(result.isError).toBeUndefined();
		const body = payload(result);
		expect(typeof body.draft_id).toBe('string');
		const draft = body.draft as Record<string, unknown>;
		expect(draft.provenance).toHaveLength(2);
		expect(body.change_id).toBeTruthy();
		expect(body.undo_token).not.toBeNull();
	});

	it("AC4: creating a draft never changes the target screener's live filter tree", async () => {
		const before = readScreener(currentDoc(), screenerId)!.filterTree;
		await tool().execute({ setup_id: 'setup_1', target_screener_id: screenerId });
		const after = readScreener(currentDoc(), screenerId)!.filterTree;
		expect(after).toEqual(before);
	});

	it('AC9: honours expected_revision and rejects a stale one on derive', async () => {
		const rev = currentDoc().revision;
		const fresh = await tool().execute({ setup_id: 'setup_1', expected_revision: rev });
		expect(fresh.isError).toBeUndefined();
		const stale = await tool().execute({ setup_id: 'setup_1', expected_revision: rev });
		expect(stale.isError).toBe(true);
		expect((payload(stale) as { error: string }).error).toBe('revision_conflict');
	});

	it('AC9: a repeated idempotency_key on derive does not produce a second draft', async () => {
		const t = tool();
		const first = payload(await t.execute({ setup_id: 'setup_1', idempotency_key: 'key-1' }));
		const replay = payload(await t.execute({ setup_id: 'setup_1', idempotency_key: 'key-1' }));
		expect(replay.change_id).toBe(first.change_id);
		expect(readFilterDrafts(currentDoc())).toHaveLength(1);
	});

	it('AC7: an unavailable study surfaces a warning and a disabled node through the envelope', async () => {
		let workspace = currentDoc();
		workspace = writeCapturedSetup(
			workspace,
			capturedSetup({
				setupId: 'setup_2',
				studies: [
					{
						studyId: 'study_1',
						catalogItemId: 'study.rsi',
						params: { length: 14 },
						pane: 'sub_pane',
						order: 0,
						enabled: true
					}
				],
				annotations: []
			})
		);
		deps.repository.put(workspace);
		const result = await tool().execute({ setup_id: 'setup_2' });
		const body = payload(result);
		expect((body.warnings as string[]).some((w) => w.includes('study.rsi'))).toBe(true);
		const tree = (body.draft as { tree: { children: { enabled: boolean }[] } }).tree;
		expect(tree.children[0]?.enabled).toBe(false);
	});

	it('AC8: a setup with nothing derivable returns an empty draft with a warning, not an error', async () => {
		let workspace = currentDoc();
		workspace = writeCapturedSetup(
			workspace,
			capturedSetup({ setupId: 'setup_3', studies: [], annotations: [] })
		);
		deps.repository.put(workspace);
		const result = await tool().execute({ setup_id: 'setup_3' });
		expect(result.isError).toBeUndefined();
		const body = payload(result);
		expect((body.warnings as string[]).length).toBeGreaterThan(0);
		const tree = (body.draft as { tree: { children: unknown[] } }).tree;
		expect(tree.children).toEqual([]);
	});

	it('rejects an unknown setup id without creating a draft', async () => {
		const result = await tool().execute({ setup_id: 'setup_missing' });
		expect(result.isError).toBe(true);
		expect(readFilterDrafts(currentDoc())).toEqual([]);
	});

	describe('operation "edit"', () => {
		async function deriveDraftId(): Promise<string> {
			const body = payload(await tool().execute({ setup_id: 'setup_1' }));
			return body.draft_id as string;
		}

		it('AC5: set_enabled updates the draft and it remains a draft', async () => {
			const draftId = await deriveDraftId();
			const before = readFilterDraft(currentDoc(), draftId)!;
			const nodeId = before.tree.kind === 'group' ? before.tree.children[0]?.nodeId : undefined;
			const result = await tool().execute({
				operation: 'edit',
				draft_id: draftId,
				edit_operation: 'set_enabled',
				node_id: nodeId,
				enabled: false
			});
			expect(result.isError).toBeUndefined();
			const after = readFilterDraft(currentDoc(), draftId)!;
			expect(after.acceptedAt).toBeUndefined();
			const node = after.tree.kind === 'group' ? after.tree.children[0] : null;
			expect(node?.enabled).toBe(false);
		});

		it('remove drops the node from the draft tree', async () => {
			const draftId = await deriveDraftId();
			const before = readFilterDraft(currentDoc(), draftId)!;
			const nodeId = before.tree.kind === 'group' ? before.tree.children[0]?.nodeId : undefined;
			await tool().execute({
				operation: 'edit',
				draft_id: draftId,
				edit_operation: 'remove',
				node_id: nodeId
			});
			const after = readFilterDraft(currentDoc(), draftId)!;
			const remainingIds =
				after.tree.kind === 'group' ? after.tree.children.map((c) => c.nodeId) : [];
			expect(remainingIds).not.toContain(nodeId);
		});

		it('rejects editing an unknown draft id', async () => {
			const result = await tool().execute({
				operation: 'edit',
				draft_id: 'filter_draft_9',
				edit_operation: 'set_enabled',
				node_id: 'filter_1',
				enabled: false
			});
			expect(result.isError).toBe(true);
		});
	});

	describe('operation "accept"', () => {
		async function deriveDraftId(): Promise<string> {
			const body = payload(await tool().execute({ setup_id: 'setup_1' }));
			return body.draft_id as string;
		}

		it("AC6: the target screener's filter tree becomes the draft's contents, as one reversible change", async () => {
			const draftId = await deriveDraftId();
			const draftTree = readFilterDraft(currentDoc(), draftId)!.tree;
			const result = await tool().execute({
				operation: 'accept',
				draft_id: draftId,
				target_screener_id: screenerId
			});
			expect(result.isError).toBeUndefined();
			const screener = readScreener(currentDoc(), screenerId)!;
			expect(screener.filterTree).toEqual(draftTree);
		});

		it("AC10: undoing the acceptance restores the screener's previous filter tree exactly", async () => {
			const draftId = await deriveDraftId();
			const before = readScreener(currentDoc(), screenerId)!.filterTree;
			const result = payload(
				await tool().execute({
					operation: 'accept',
					draft_id: draftId,
					target_screener_id: screenerId
				})
			);
			undoChange(result.undo_token as string, {
				history: deps.history,
				revisionService: revisions,
				clock: deps.clock,
				context: { actor: 'agent' }
			});
			const after = readScreener(currentDoc(), screenerId)!.filterTree;
			expect(after).toEqual(before);
		});

		it('AC9: a repeated idempotency_key on accept does not apply the acceptance twice', async () => {
			const draftId = await deriveDraftId();
			const revBeforeAccept = currentDoc().revision;
			const t = tool();
			const first = payload(
				await t.execute({
					operation: 'accept',
					draft_id: draftId,
					target_screener_id: screenerId,
					idempotency_key: 'accept-key'
				})
			);
			const replay = payload(
				await t.execute({
					operation: 'accept',
					draft_id: draftId,
					target_screener_id: screenerId,
					idempotency_key: 'accept-key'
				})
			);
			expect(replay.change_id).toBe(first.change_id);
			expect(currentDoc().revision).toBe(revBeforeAccept + 1);
		});

		it('rejects accepting onto an unknown screener id', async () => {
			const draftId = await deriveDraftId();
			const result = await tool().execute({
				operation: 'accept',
				draft_id: draftId,
				target_screener_id: 'screener_missing'
			});
			expect(result.isError).toBe(true);
		});
	});

	it('rejects an unknown top-level operation', async () => {
		const result = await tool().execute({ operation: 'delete_everything' });
		expect(result.isError).toBe(true);
	});
});
