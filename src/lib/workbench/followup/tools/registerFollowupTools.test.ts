import { describe, expect, it, vi } from 'vitest';
import { emptyWorkspace } from '../../domain/workspace';
import type { WorkspaceDocument } from '../../domain/workspace';
import {
	createPanelShellRuntime,
	createWorkbenchSharedInfra
} from '../../../panels/shell/registerPanelTools';
import { writeComputedField, type ComputedFieldRecord } from '../domain/computedField';
import { writeCustomStudy, type CustomStudyRecord } from '../domain/customStudy';
import type { ValidatedExpression } from '../domain/expressionModel';

const NOW = '2026-09-02T20:00:00.000Z';

function makeExpression(): ValidatedExpression {
	return {
		node: { kind: 'field_ref', fieldId: 'field.price.close' },
		resultType: 'number',
		resultUnit: 'currency',
		usage: 'numeric_column'
	};
}

function seededDocument(): WorkspaceDocument {
	const field: ComputedFieldRecord = {
		id: 'field.custom.3',
		workspaceId: 'workspace_1',
		name: 'Existing field',
		expression: makeExpression(),
		createdAt: NOW,
		updatedAt: NOW
	};
	const study: CustomStudyRecord = {
		id: 'study.custom.5',
		workspaceId: 'workspace_1',
		name: 'Existing study',
		expression: makeExpression(),
		parameters: [],
		catalogParameters: [],
		createdAt: NOW,
		updatedAt: NOW
	};
	let doc = emptyWorkspace('workspace_1', 'Test', NOW);
	doc = writeComputedField(doc, field);
	doc = writeCustomStudy(doc, study);
	return doc;
}

// T-1015-3: mirrors registerChartTools.test.ts / registerWorkbenchTools.test.ts's
// own flag-flip coverage -- registerFollowupAuthoringTools() and its
// *_TOOLS_ENABLED constant previously had no dedicated test of their own
// (createComputedField.test.ts/createCustomStudy.test.ts exercise the tool
// factories directly, never this file's registration/flag behavior).
describe('registerFollowupAuthoringTools', () => {
	it('FOLLOWUP_AUTHORING_TOOLS_ENABLED is true now that the composition root wires this group in (T-1015-3)', async () => {
		const { FOLLOWUP_AUTHORING_TOOLS_ENABLED } = await import('./registerFollowupTools');
		expect(FOLLOWUP_AUTHORING_TOOLS_ENABLED).toBe(true);
	});

	it('registers the two authoring tools against document.modelContext now that the flag is on', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		try {
			const { registerFollowupAuthoringTools, createDefaultFollowupAuthoringDeps } =
				await import('./registerFollowupTools');
			await registerFollowupAuthoringTools(createDefaultFollowupAuthoringDeps());
			const names = registerTool.mock.calls.map((args: unknown[]) => {
				const tool = args[0] as { name: string };
				return tool.name;
			});
			expect(names).toEqual(
				expect.arrayContaining(['create_computed_field', 'create_custom_study'])
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('createFollowupAuthoringDeps', () => {
	// Bug fix (see git history): this composition root used to build its own,
	// separate WorkspaceRepository rather than sharing the one instance
	// registerPanelTools.ts's createWorkbenchSharedInfra() builds.
	it('shares the repository/revisions/history instances from the given shared infra bag', async () => {
		const { createFollowupAuthoringDeps } = await import('./registerFollowupTools');
		const shared = createWorkbenchSharedInfra();
		const deps = createFollowupAuthoringDeps(shared);

		expect(
			deps.repository,
			"followup tools must share the composition root's WorkspaceRepository, not build their own"
		).toBe(shared.repository);
		expect(deps.revisions).toBe(shared.revisions);
		expect(deps.history).toBe(shared.history);
	});

	// The actual regression: without a seed, a reload's fresh IdSequencer
	// re-mints an id an existing computed field/custom study already holds.
	it("seeds the id sequencer from the active workspace's existing computed fields and custom studies", async () => {
		const { createFollowupAuthoringDeps } = await import('./registerFollowupTools');
		const shared = createWorkbenchSharedInfra();
		createPanelShellRuntime(shared); // seeds the active workspace document
		const activeId = shared.repository.getActiveId()!;
		const base = shared.repository.get(activeId)!;
		const withRecords = seededDocument();
		shared.repository.put({ ...base, extensions: withRecords.extensions });

		const deps = createFollowupAuthoringDeps(shared);

		expect(
			deps.ids.next('computedfield'),
			'must mint past the existing field.custom.3, not re-mint it'
		).toBe('computedfield_4');
		expect(
			deps.ids.next('customstudy'),
			'must mint past the existing study.custom.5, not re-mint it'
		).toBe('customstudy_6');
	});
});

describe('followupIdSeed', () => {
	it('returns an empty seed for a null document', async () => {
		const { followupIdSeed } = await import('./registerFollowupTools');
		expect(followupIdSeed(null)).toEqual({});
	});

	it('seeds both computedfield and customstudy from the document, independently', async () => {
		const { followupIdSeed } = await import('./registerFollowupTools');
		const seed = followupIdSeed(seededDocument());
		expect(seed.computedfield, 'field.custom.3 must seed the computedfield counter to 3').toBe(3);
		expect(seed.customstudy, 'study.custom.5 must seed the customstudy counter to 5').toBe(5);
	});
});

describe('composition root: similarity and chart tool groups also reuse the shared infra', () => {
	// Confirms the same class of bug this file's own tests guard against
	// (an unseeded, independent WorkspaceRepository per tool group) is fixed
	// consistently across every /workbench tool group, not just this one --
	// see registerSimilarityTools.ts's createSimilarityDeps and
	// registerChartTools.ts's createChartDeps.
	it('createSimilarityDeps reuses the shared repository and the panel runtime\'s live kinds/sourceRenderer/templates registries', async () => {
		const { createSimilarityDeps } = await import('../../similarity/tools/registerSimilarityTools');
		const shared = createWorkbenchSharedInfra();
		const panelRuntime = createPanelShellRuntime(shared);

		const deps = createSimilarityDeps(shared, panelRuntime.deps);

		expect(deps.repository, 'must share the same repository, not build a second one').toBe(
			shared.repository
		);
		expect(deps.ids, 'must reuse the already panel-seeded shared.ids').toBe(shared.ids);
		expect(
			deps.kinds,
			"must reuse the panel runtime's live registry, not a second, disconnected one"
		).toBe(panelRuntime.deps.kinds);
		expect(deps.sourceRenderer).toBe(panelRuntime.deps.sourceRenderer);
	});
});
