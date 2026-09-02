// T-1010-6: registration-level tests for the results-table renderer contract,
// plus end-to-end coverage proving EPIC-1007's generic configurePanelView and
// setPanelSelection use cases produce this ticket's behavior once the real
// contract (not the placeholder registered by
// panels/registry/defaultSourceRendererTypes.ts) is registered for 'table'.
//
// Deliberately does NOT use panels/application/testSupport.ts's
// createPanelTestHarness(): that harness always seeds the shared placeholder
// 'table'/'chart_grid' renderer types via registerDefaultSourceRendererTypes,
// which would conflict with (and mask) this ticket's real 'table' contract --
// the same reason chartRendererContract.ts's own registration is never
// exercised through that harness either. This file builds its own minimal
// registry instead.
import { describe, expect, it } from 'vitest';
import { createChangeHistory, undoChange } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createRevisionService } from '../../workbench/application/revisionService';
import { RevisionConflictError } from '../../workbench/domain/errors';
import { createIdSequencer } from '../../workbench/domain/ids';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import {
	createLayoutTemplateRegistry,
	registerDefaultLayoutTemplates
} from '../../panels/domain/layoutTemplates';
import { createPanelRegistry } from '../../panels/registry/panelKindRegistry';
import { registerDefaultPanelKinds } from '../../panels/registry/defaultPanelKinds';
import { createSourceRendererRegistry } from '../../panels/registry/sourceRendererRegistry';
import {
	bindPanelSource,
	configurePanelView,
	createPanel,
	linkPanels,
	PanelOperationError,
	readPanelState,
	setPanelSelection,
	type PanelUseCaseDeps
} from '../../panels/application';
import { mintResultId } from '../domain/page';
import { createSpyPinnedRunStore, testPinnedRunStore, testRun } from '../testSupport';
import {
	registerResultsTableRendererContract,
	RESULTS_TABLE_RENDERER_NAME,
	RESULTS_TABLE_SOURCE_TYPE
} from './tableRendererContract';
import type { PinnedRunStore } from '../../screener/ports';

function ctx(overrides: Partial<{ expectedRevision: number; idempotencyKey: string }> = {}) {
	return { actor: 'agent' as const, ...overrides };
}

const CLOSE_COLUMN_WIRE = {
	id: 'column_1',
	identity: { source: 'catalog_field', field_id: 'field.price.close' },
	label: 'Close',
	value_type: 'number'
};

function createHarness(runs: PinnedRunStore): PanelUseCaseDeps {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const clock = { now: () => '2026-01-01T00:00:00.000Z' };
	const ids = createIdSequencer();

	const kinds = createPanelRegistry();
	registerDefaultPanelKinds(kinds);

	const sourceRenderer = createSourceRendererRegistry();
	registerResultsTableRendererContract(sourceRenderer, { runs });
	// A minimal single-selection renderer standing in for a real chart/details
	// contract (T-1010-6's AC7 only needs "some renderer that declares
	// selectionCapacity: 'single'" to exist -- which real renderer does isn't
	// this ticket's concern, see the ticket's own note about not touching
	// EPIC-1011's already-merged chart module).
	sourceRenderer.registerRendererType({
		name: 'chart_grid',
		configSchema: { type: 'object', properties: {} },
		validateConfig: () => ({ ok: true, value: {} }),
		defaultConfig: () => ({}),
		acceptedSourceTypes: [],
		selectionCapacity: 'single'
	});

	const templates = createLayoutTemplateRegistry();
	registerDefaultLayoutTemplates(templates);

	const revisions = createRevisionService({
		repository,
		clock,
		ids,
		idempotency: createIdempotencyCache()
	});

	return {
		workspaceId: 'workspace_1',
		repository,
		revisions,
		history: createChangeHistory(),
		clock,
		ids,
		kinds,
		sourceRenderer,
		templates
	};
}

function createTablePanel(deps: PanelUseCaseDeps, runId: string): void {
	createPanel(deps, { context: ctx(), kind: 'results_table' });
	bindPanelSource(deps, {
		context: ctx(),
		panelId: 'panel_results_table_1',
		source: { type: RESULTS_TABLE_SOURCE_TYPE, ref: { run_id: runId } }
	});
}

describe('registerResultsTableRendererContract', () => {
	it('registers the "table" renderer and "screener_results" source type without conflict', () => {
		const registry = createSourceRendererRegistry();
		registerResultsTableRendererContract(registry, { runs: testPinnedRunStore() });
		expect(registry.getRendererType(RESULTS_TABLE_RENDERER_NAME)).toBeDefined();
		expect(registry.getSourceType(RESULTS_TABLE_SOURCE_TYPE)).toBeDefined();
	});

	it('defaultConfig produces a config its own validateConfig accepts', () => {
		const registry = createSourceRendererRegistry();
		registerResultsTableRendererContract(registry, { runs: testPinnedRunStore() });
		const rendererType = registry.requireRendererType(RESULTS_TABLE_RENDERER_NAME);
		const validation = rendererType.validateConfig(rendererType.defaultConfig());
		expect(validation.ok, 'the default config must validate against its own contract').toBe(true);
	});
});

describe('configurePanelView through the real table contract', () => {
	it('AC1: applies a valid config and returns the common mutation envelope', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1');

		const envelope = configurePanelView(deps, {
			context: ctx({ expectedRevision: 2 }),
			panelId: 'panel_results_table_1',
			config: { columns: [CLOSE_COLUMN_WIRE] }
		});

		expect(envelope.changeId).toBeTruthy();
		expect(envelope.newRevision).toBeGreaterThan(0);
		expect(envelope.affectedIds).toEqual(['panel_results_table_1']);
		expect(typeof envelope.diffSummary).toBe('string');
		expect(envelope.warnings).toEqual([]);
		expect(envelope.undoToken).not.toBeNull();

		const panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels.find(
			(p) => p.id === 'panel_results_table_1'
		)!;
		expect(panel.config.columns).toEqual([CLOSE_COLUMN_WIRE]);
	});

	it('AC2: diff_summary states plain-language what changed, not the whole configuration', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1');

		const envelope = configurePanelView(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			config: { columns: [CLOSE_COLUMN_WIRE] }
		});

		expect(envelope.diffSummary).toContain('added column "Close"');
		expect(envelope.diffSummary).not.toBe('Panel "Results": view configuration updated.');
	});

	it('AC3: a config that fails validation is rejected and applies nothing', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1');
		const before = deps.repository.get(deps.workspaceId)!;

		expect(() =>
			configurePanelView(deps, {
				context: ctx(),
				panelId: 'panel_results_table_1',
				config: {
					computed_columns: [
						{ id: 'computed_1', label: 'Bad', value_type: 'number', expression: 'nonsense(1)' }
					]
				}
			})
		).toThrow(PanelOperationError);

		const after = deps.repository.get(deps.workspaceId)!;
		expect(after.revision, 'a rejected config must not consume a revision').toBe(before.revision);
		const panel = readPanelState(after).panels.find((p) => p.id === 'panel_results_table_1')!;
		expect(panel.config, 'the panel config must be untouched').toEqual(
			readPanelState(before).panels.find((p) => p.id === 'panel_results_table_1')!.config
		);
	});

	it('AC4: a sort key that is not a visible column is a warning, and the mutation still applies', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1');

		const envelope = configurePanelView(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			config: {
				columns: [CLOSE_COLUMN_WIRE],
				sort: { key: { source: 'catalog_field', field_id: 'field.volume' }, direction: 'desc' }
			}
		});

		expect(envelope.warnings.length, 'the not-visible sort key must be a warning').toBeGreaterThan(
			0
		);
		expect(envelope.warnings.join(' ')).toContain('not among the displayed columns');
		const panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels.find(
			(p) => p.id === 'panel_results_table_1'
		)!;
		expect(panel.config.sort, 'a warning must not block the mutation').toEqual({
			key: { source: 'catalog_field', field_id: 'field.volume' },
			direction: 'desc',
			tie_break: { source: 'result_id' },
			tie_break_direction: 'asc'
		});
	});

	it('AC8: a stale expected_revision is rejected as a conflict and changes nothing', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1'); // -> revision 2
		const before = deps.repository.get(deps.workspaceId)!;

		expect(() =>
			configurePanelView(deps, {
				context: ctx({ expectedRevision: 1 }),
				panelId: 'panel_results_table_1',
				config: { columns: [CLOSE_COLUMN_WIRE] }
			})
		).toThrow(RevisionConflictError);

		const after = deps.repository.get(deps.workspaceId)!;
		expect(after.revision, 'a rejected conflict must not bump the revision').toBe(before.revision);
	});

	it('AC9: a replayed idempotency_key returns the original envelope and applies once', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1');
		const request = {
			context: ctx({ idempotencyKey: 'configure-1' }),
			panelId: 'panel_results_table_1',
			config: { columns: [CLOSE_COLUMN_WIRE] }
		};

		const first = configurePanelView(deps, request);
		const revisionAfterFirst = deps.repository.get(deps.workspaceId)!.revision;
		const second = configurePanelView(deps, request);

		expect(second, 'a replay must return the identical envelope').toEqual(first);
		expect(
			deps.repository.get(deps.workspaceId)!.revision,
			'a replay must not consume a second revision'
		).toBe(revisionAfterFirst);
	});

	it('AC10: the undo_token reverses the config change', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1');
		const before = readPanelState(deps.repository.get(deps.workspaceId)!).panels.find(
			(p) => p.id === 'panel_results_table_1'
		)!.config;

		const envelope = configurePanelView(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			config: { columns: [CLOSE_COLUMN_WIRE] }
		});
		expect(envelope.undoToken).not.toBeNull();

		undoChange(envelope.undoToken!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock: deps.clock,
			context: ctx()
		});

		const after = readPanelState(deps.repository.get(deps.workspaceId)!).panels.find(
			(p) => p.id === 'panel_results_table_1'
		)!.config;
		expect(after).toEqual(before);
	});

	it('AC12: never calls PinnedRunStore.putRun -- no screener is executed', () => {
		const spy = createSpyPinnedRunStore(testPinnedRunStore(testRun('run_1', 3)));
		const deps = createHarness(spy);
		createTablePanel(deps, 'run_1');

		configurePanelView(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			config: { columns: [CLOSE_COLUMN_WIRE] }
		});

		expect(spy.putRunCalls, 'configuring the table must never store a run').toBe(0);
	});
});

describe('setPanelSelection through the real table contract', () => {
	function runIds(runId: string, ranks: number[]): string[] {
		return ranks.map((rank) => mintResultId(runId, rank));
	}

	it('AC5: replaces the selected result ids wholesale, and an empty set clears it', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1');
		const [id1, id2] = runIds('run_1', [1, 2]);

		setPanelSelection(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			selectedIds: [id1!, id2!]
		});
		let state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.selections['panel_results_table_1']).toEqual([id1, id2]);

		setPanelSelection(deps, { context: ctx(), panelId: 'panel_results_table_1', selectedIds: [] });
		state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.selections['panel_results_table_1']).toEqual([]);
	});

	it('AC6: a result id outside the bound run is rejected by name, and the previous selection is unchanged', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1');
		const [id1] = runIds('run_1', [1]);
		setPanelSelection(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			selectedIds: [id1!]
		});

		let thrown: PanelOperationError | undefined;
		try {
			setPanelSelection(deps, {
				context: ctx(),
				panelId: 'panel_results_table_1',
				selectedIds: ['result_run_1_999']
			});
		} catch (err) {
			thrown = err as PanelOperationError;
		}

		expect(thrown).toBeInstanceOf(PanelOperationError);
		expect(JSON.stringify(thrown!.details)).toContain('result_run_1_999');
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(
			state.selections['panel_results_table_1'],
			'a rejected selection must leave the previous selection in place'
		).toEqual([id1]);
	});

	it('AC7: a linked single-capacity panel gets only the primary selection, with a warning about the rest', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1');
		createPanel(deps, { context: ctx(), kind: 'chart' }); // chart_grid, selectionCapacity 'single'
		linkPanels(deps, {
			context: ctx(),
			channel: 'result_selection',
			panelIds: ['panel_results_table_1', 'panel_chart_1']
		});
		const [id1, id2] = runIds('run_1', [1, 2]);

		const envelope = setPanelSelection(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			selectedIds: [id1!, id2!]
		});

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(
			state.selections['panel_results_table_1'],
			'the source panel keeps the full selection'
		).toEqual([id1, id2]);
		expect(
			state.selections['panel_chart_1'],
			'the single-capacity target gets only the primary'
		).toEqual([id1]);
		expect(envelope.warnings.join(' ')).toContain('can only show one selected result');
	});

	it('AC8: a stale expected_revision is rejected as a conflict and changes nothing', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1'); // -> revision 2
		const before = deps.repository.get(deps.workspaceId)!;

		expect(() =>
			setPanelSelection(deps, {
				context: ctx({ expectedRevision: 1 }),
				panelId: 'panel_results_table_1',
				selectedIds: [mintResultId('run_1', 1)]
			})
		).toThrow(RevisionConflictError);

		const after = deps.repository.get(deps.workspaceId)!;
		expect(after.revision).toBe(before.revision);
	});

	it('AC9: a replayed idempotency_key returns the original envelope and applies once', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1');
		const request = {
			context: ctx({ idempotencyKey: 'select-1' }),
			panelId: 'panel_results_table_1',
			selectedIds: [mintResultId('run_1', 1)]
		};

		const first = setPanelSelection(deps, request);
		const revisionAfterFirst = deps.repository.get(deps.workspaceId)!.revision;
		const second = setPanelSelection(deps, request);

		expect(second).toEqual(first);
		expect(deps.repository.get(deps.workspaceId)!.revision).toBe(revisionAfterFirst);
	});

	it('AC10: the undo_token restores the previous selection', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1');
		const [id1] = runIds('run_1', [1]);
		setPanelSelection(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			selectedIds: [id1!]
		});

		const envelope = setPanelSelection(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			selectedIds: [mintResultId('run_1', 2)]
		});
		undoChange(envelope.undoToken!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock: deps.clock,
			context: ctx()
		});

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.selections['panel_results_table_1']).toEqual([id1]);
	});

	it('AC11: an agent selection replaces a person-made one wholesale, and both are readable the same way', () => {
		const deps = createHarness(testPinnedRunStore(testRun('run_1', 3)));
		createTablePanel(deps, 'run_1');
		const [id1, id2] = runIds('run_1', [1, 2]);

		setPanelSelection(deps, {
			context: { actor: 'human' },
			panelId: 'panel_results_table_1',
			selectedIds: [id1!]
		});
		expect(
			readPanelState(deps.repository.get(deps.workspaceId)!).selections['panel_results_table_1'],
			'the agent reads the human selection through the same state'
		).toEqual([id1]);

		setPanelSelection(deps, {
			context: { actor: 'agent' },
			panelId: 'panel_results_table_1',
			selectedIds: [id2!]
		});
		expect(
			readPanelState(deps.repository.get(deps.workspaceId)!).selections['panel_results_table_1'],
			'the agent selection replaces the human one wholesale, not merged'
		).toEqual([id2]);
	});

	it('AC12: never calls PinnedRunStore.putRun -- no screener is executed', () => {
		const spy = createSpyPinnedRunStore(testPinnedRunStore(testRun('run_1', 3)));
		const deps = createHarness(spy);
		createTablePanel(deps, 'run_1');

		setPanelSelection(deps, {
			context: ctx(),
			panelId: 'panel_results_table_1',
			selectedIds: [mintResultId('run_1', 1)]
		});

		expect(spy.putRunCalls).toBe(0);
	});
});
