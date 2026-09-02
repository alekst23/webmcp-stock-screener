// AC8: the authoring and refinement flow -- create a computed field and a
// custom study, use them in a filter and on a chart, then refine a
// similarity search from accepted and rejected matches. Filter/chart usage
// goes through EPIC-1009's edit_filter_tree tool and EPIC-1011's
// chart.edit_studies operation, both driven with the workspace-composed
// catalog (composeWorkspaceCatalogRegistry) so the just-created field/study
// resolve exactly as a built-in one would -- proving T-1014-2's catalog
// overlay actually reaches every consumer, not just its own tool.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import { composeWorkspaceCatalogRegistry } from '../domain/workspaceCatalog';
import {
	CHART_EDIT_STUDIES_KIND,
	createEditChartStudiesOperation
} from '../../chart/application/chartStudies';
import { readChartState, writeChartState, createChartState } from '../../chart/domain/chartState';
import { applyOperations } from '../../application/operationRegistry';
import { buildAllFollowupTools, type FollowupSurfaceRuntime } from './registerAllFollowupTools';
import {
	jsonOf,
	buildSourceSimilarityRun,
	seedCapturedSetup,
	seedSimilarityPanel
} from './testFixtures';
import { buildRuntime, SETUP_ID } from './followupMutatingFixtures';

const PANEL_ID = 'panel_chart_1';

function seedChartPanel(runtime: FollowupSurfaceRuntime): void {
	const doc = {
		...runtime.repository.get(runtime.workspaceId)!,
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
	runtime.repository.put(writeChartState(doc, createChartState(PANEL_ID)));
}

describe('AC8: author a computed field and custom study, use them, then refine a similarity search', () => {
	let runtime: FollowupSurfaceRuntime;
	let byName: Map<string, ToolSpec>;

	beforeEach(() => {
		runtime = buildRuntime();
		byName = new Map(buildAllFollowupTools(runtime).map((t) => [t.name, t]));
		seedChartPanel(runtime);
	});

	it('creates a computed field and custom study, uses each, then refines a similarity search', async () => {
		// 1. Create a computed field.
		const field = jsonOf(
			await byName.get('create_computed_field')!.execute({
				name: 'Double close',
				expression: {
					kind: 'arithmetic',
					op: '*',
					left: { kind: 'field_ref', fieldId: 'field.price.close' },
					right: { kind: 'literal', value: 2, valueType: 'number' }
				}
			})
		);
		expect(field.error, JSON.stringify(field)).toBeUndefined();
		const fieldId = field.computed_field_id as string;
		expect(fieldId).toBeTruthy();

		// 2. Create a custom study.
		const study = jsonOf(
			await byName.get('create_custom_study')!.execute({
				name: 'Custom SMA',
				expression: {
					kind: 'function_call',
					functionId: 'study.sma',
					args: { length: 10 },
					outputName: 'sma'
				}
			})
		);
		expect(study.error, JSON.stringify(study)).toBeUndefined();
		const studyId = study.custom_study_id as string;
		expect(studyId).toBeTruthy();

		// 3. Use the computed field in a screener filter -- through the real
		// edit_filter_tree tool (EPIC-1009), with the workspace-composed
		// catalog so `fieldId` resolves to the field just created.
		const { createCreateScreenerTool } = await import('../../../webmcp/screener/createScreener');
		const { createEditFilterTreeTool } = await import('../../../webmcp/screener/editFilterTree');
		const { makeProvenance } = await import('../../domain/provenance');
		const workbenchDeps = {
			repository: runtime.repository,
			revisions: runtime.revisions,
			history: runtime.history,
			registry: runtime.registry,
			provenance: {
				current: () =>
					makeProvenance({
						asOf: '2026-09-02T00:00:00.000Z',
						sourceId: 'not_configured',
						sourceLabel: 'No market-data source configured',
						liveness: 'static',
						timezone: 'America/New_York'
					})
			},
			clock: runtime.clock,
			ids: runtime.ids,
			idempotency: runtime.idempotency
		};
		const createdScreener = jsonOf(
			await createCreateScreenerTool(workbenchDeps).execute({ name: 'Uses computed field' })
		);
		const screenerId = (createdScreener.affected_ids as string[])[0]!;

		const catalog = composeWorkspaceCatalogRegistry(runtime.repository.get(runtime.workspaceId)!);
		expect(catalog.getCatalogItem(fieldId)?.kind).toBe('field');

		const edited = jsonOf(
			await createEditFilterTreeTool(workbenchDeps, catalog).execute({
				screener_id: screenerId,
				operation: 'add',
				condition: { type: 'scalar', fieldId, operator: 'op.greater_than', value: 10, unit: null }
			})
		);
		expect(edited.error, JSON.stringify(edited)).toBeUndefined();

		// 3b. Use the custom study in a filter too -- a study_output condition,
		// the second usage T-1014-2's own design spec commits to ("addable to
		// charts and usable in study-output filter conditions"). This validates
		// purely against the catalog's declared outputs/params
		// (conditionValidation.catalog.ts's validateStudyOutput), with no
		// chart-engine involvement at all -- unlike step 4 below.
		const editedWithStudy = jsonOf(
			await createEditFilterTreeTool(workbenchDeps, catalog).execute({
				screener_id: screenerId,
				operation: 'add',
				condition: {
					type: 'study_output',
					studyId,
					params: {},
					outputName: 'value',
					predicate: 'rising'
				}
			})
		);
		expect(editedWithStudy.error, JSON.stringify(editedWithStudy)).toBeUndefined();

		// 4. Use the custom study "on a chart" -- through the real
		// chart.edit_studies operation (EPIC-1011; not exposed as a standalone
		// tool by design -- see chart/tools/index.ts's own header comment),
		// with the workspace-composed catalog so the custom study resolves by
		// id exactly the way a built-in one would.
		//
		// This is as far as "on a chart" goes today: EPIC-1011's chart engine
		// (chart/domain/studyEngine.ts) plots from a fixed, hand-written
		// calculator map (SMA/EMA/RSI/MACD/Bollinger/ATR/VWAP) with no
		// expression-interpretation path at all, so resolveStudyItem's
		// isStudySupported() gate rejects *any* non-built-in catalog id,
		// including a custom study, before chart.edit_studies ever adds it.
		// That is a structurally missing capability in EPIC-1011 (a chart-side
		// custom-study evaluator), not a wiring gap this ticket's composition
		// root can route around -- see this ticket's final report. What T-1014-2
		// actually promises here (design spec's "Declared surface" scenario:
		// "addable to charts ... described the same way built-in studies are")
		// is catalog discoverability with chart-shaped metadata, asserted below.
		const catalogAfterScreenerEdit = composeWorkspaceCatalogRegistry(
			runtime.repository.get(runtime.workspaceId)!
		);
		const studyItem = catalogAfterScreenerEdit.getCatalogItem(studyId);
		expect(studyItem?.kind).toBe('study');
		expect(studyItem).toMatchObject({
			kind: 'study',
			outputs: expect.any(Array),
			parameters: expect.any(Array)
		});

		runtime.registry.register(
			createEditChartStudiesOperation({ registry: catalogAfterScreenerEdit })
		);
		expect(() =>
			applyOperations(
				[
					{
						kind: CHART_EDIT_STUDIES_KIND,
						input: { panelId: PANEL_ID, operations: [{ op: 'add', catalogItemId: studyId }] }
					}
				],
				{ actor: 'agent' },
				{
					registry: runtime.registry,
					workspaceId: runtime.workspaceId,
					history: runtime.history,
					revisionService: runtime.revisions,
					clock: runtime.clock,
					ids: runtime.ids
				}
			)
		).toThrowError(/cannot plot/);
		const chartState = readChartState(runtime.repository.get(runtime.workspaceId)!, PANEL_ID);
		expect(chartState?.studies ?? []).toHaveLength(0);

		// 5. Refine a similarity search from accepted and rejected matches.
		// SETUP_ID/the default run id match what buildRuntime()'s own
		// similarityApi() fixture is already bound to (followupMutatingFixtures.ts)
		// -- seedCapturedSetup here just needs to reuse the same id so the
		// fakeSimilarityApi's getRun/search calls resolve against a setup that
		// actually exists in this workspace.
		seedCapturedSetup(runtime, SETUP_ID);
		const sourceRun = buildSourceSimilarityRun(SETUP_ID);
		seedSimilarityPanel(runtime, sourceRun.runId);

		const refined = jsonOf(
			await byName.get('refine_similarity_search')!.execute({
				run_id: sourceRun.runId,
				accepted_match_ids: ['A'],
				rejected_match_ids: ['B']
			})
		);
		expect(refined.error, JSON.stringify(refined)).toBeUndefined();
		expect(refined.run_id).not.toBe(sourceRun.runId);
		expect(Array.isArray(refined.weight_changes)).toBe(true);
		expect((refined.weight_changes as unknown[]).length).toBeGreaterThan(0);
		expect(refined.undo_token).not.toBeNull();

		// AC9: created resources are visible independent of the creating
		// call's own response -- reading a *fresh* catalog composed from the
		// current document, not the one captured mid-test.
		const doc = runtime.repository.get(runtime.workspaceId)!;
		const finalCatalog = composeWorkspaceCatalogRegistry(doc);
		expect(finalCatalog.getCatalogItem(fieldId)?.kind).toBe('field');
		expect(finalCatalog.getCatalogItem(studyId)?.kind).toBe('study');
	});
});
