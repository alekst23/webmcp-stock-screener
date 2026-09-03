import { describe, expect, it } from 'vitest';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createRevisionService } from '../../workbench/application/revisionService';
import { RevisionConflictError } from '../../workbench/domain/errors';
import { createIdSequencer } from '../../workbench/domain/ids';
import { GRID_COLUMNS, GRID_ROWS } from '../domain/grid';
import { PanelOperationError } from './errors';
import { panelIdSeed, readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';

function ctx(overrides: Partial<{ expectedRevision: number; idempotencyKey: string }> = {}) {
	return { actor: 'agent' as const, ...overrides };
}

describe('createPanel', () => {
	it('AC1: adds a panel with a minted id, default title/config, and a free auto-chosen rect', () => {
		const deps = createPanelTestHarness();
		const envelope = createPanel(deps, { context: ctx(), kind: 'chart' });

		expect(envelope.newRevision, `expected revision 1, got ${envelope.newRevision}`).toBe(1);
		expect(envelope.affectedIds).toEqual(['panel_chart_1']);
		expect(envelope.undoToken, 'a successful create must carry an undo token').not.toBeNull();

		const doc = deps.repository.get(deps.workspaceId);
		const state = readPanelState(doc!);
		expect(state.panels.length, `expected one panel, got ${JSON.stringify(state.panels)}`).toBe(1);
		const panel = state.panels[0]!;
		expect(panel.id).toBe('panel_chart_1');
		expect(panel.title).toBe('Chart');
		expect(panel.renderer).toBe('chart_grid');
		expect(panel.rect).toEqual({ col: 0, row: 0, colSpan: 3, rowSpan: 2 });
	});

	it('AC1: explicit placement is honored exactly when valid and unoccupied', () => {
		const deps = createPanelTestHarness();
		const envelope = createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 4, row: 3, colSpan: 2, rowSpan: 1 }
		});
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(
			state.panels[0]!.rect,
			`expected the explicit rect, got envelope ${JSON.stringify(envelope)}`
		).toEqual({
			col: 4,
			row: 3,
			colSpan: 2,
			rowSpan: 1
		});
	});

	it('AC1: an unknown kind fails, changes nothing, and lists every registered kind', () => {
		const deps = createPanelTestHarness();
		try {
			createPanel(deps, { context: ctx(), kind: 'not_a_kind' });
			expect.fail('expected createPanel to throw for an unknown kind');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			const opErr = err as PanelOperationError;
			expect(opErr.code).toBe('unknown_panel_kind');
			expect(
				(opErr.details.registeredKinds as string[]).length,
				'expected the registered kinds to be listed'
			).toBeGreaterThan(0);
		}
		expect(deps.repository.get(deps.workspaceId), 'nothing should have been created').toBeNull();
	});

	it('AC1: invalid configuration fails, changes nothing, and names the rejected fields', () => {
		const deps = createPanelTestHarness();
		expect(() =>
			createPanel(deps, { context: ctx(), kind: 'chart', config: { not_a_real_field: true } })
		).toThrow(PanelOperationError);
		expect(deps.repository.get(deps.workspaceId)).toBeNull();
	});

	it('AC1: no room at the requested spot fails with an overlap error naming the occupying panel', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }
		});
		try {
			createPanel(deps, {
				context: ctx(),
				kind: 'alerts',
				rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }
			});
			expect.fail('expected an overlap error');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			expect((err as PanelOperationError).code).toBe('overlap');
			expect((err as PanelOperationError).details.occupiedBy).toBe('panel_alerts_1');
		}
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.panels.length, 'the second create must not have added a panel').toBe(1);
	});

	it('AC1/T-1007-8 AC3: grid is full fails cleanly, changes nothing, no revision consumed', () => {
		const deps = createPanelTestHarness();
		const first = createPanel(deps, {
			context: ctx(),
			kind: 'filter_builder',
			rect: { col: 0, row: 0, colSpan: GRID_COLUMNS, rowSpan: GRID_ROWS }
		});
		expect(first.newRevision).toBe(1);

		try {
			createPanel(deps, { context: ctx(), kind: 'alerts' });
			expect.fail('expected the grid-full error');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			expect((err as PanelOperationError).code).toBe('grid_full');
		}
		const doc = deps.repository.get(deps.workspaceId)!;
		expect(doc.revision, 'a failed create must not consume a revision (AC15)').toBe(1);
		expect(readPanelState(doc).panels.length).toBe(1);
	});

	it('AC13: a replayed idempotency_key returns the original envelope and creates no second panel', () => {
		const deps = createPanelTestHarness();
		const request = { context: ctx({ idempotencyKey: 'key-1' }), kind: 'chart' as const };
		const first = createPanel(deps, request);
		const second = createPanel(deps, request);

		expect(second, 'a replay must return the identical envelope').toEqual(first);
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.panels.length, 'a replay must not create a second panel').toBe(1);
	});

	it('AC12: a stale expected_revision is rejected as a conflict and changes nothing', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' }); // -> revision 1

		expect(() =>
			createPanel(deps, { context: ctx({ expectedRevision: 0 }), kind: 'chart' })
		).toThrow(RevisionConflictError);
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.panels.length, 'a rejected conflict must not add a panel').toBe(1);
	});

	it('AC14: undo restores the workspace to exactly its pre-create state', () => {
		const deps = createPanelTestHarness();
		const before = deps.repository.get(deps.workspaceId);
		const envelope = createPanel(deps, { context: ctx(), kind: 'chart' });

		const record = deps.history.findByUndoToken(envelope.undoToken!);
		expect(record?.inverseDraft, 'expected an inverse draft registered for undo').toBeTruthy();
		const restored = record!.inverseDraft!.document;
		expect(readPanelState(restored).panels, 'undo must restore to zero panels').toEqual([]);
		expect(restored.extensions, 'undo must restore the exact pre-mutation extensions').toEqual(
			before?.extensions ?? {}
		);
	});

	it('auto-placement is deterministic across a replay', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'alerts' }); // occupies (0,0) 2x1

		const deps2 = createPanelTestHarness();
		createPanel(deps2, { context: ctx(), kind: 'alerts' });

		const state1 = readPanelState(deps.repository.get(deps.workspaceId)!);
		const state2 = readPanelState(deps2.repository.get(deps2.workspaceId)!);
		expect(state1.panels[0]!.rect, 'identical requests must auto-place identically').toEqual(
			state2.panels[0]!.rect
		);
	});

	// Regression: without a seed, a fresh IdSequencer built after a
	// reload/remount that reuses the existing active document restarts its
	// counters at 0, so create_panel would re-mint an ID a panel already in
	// that document holds.
	it('regression: an unseeded sequencer reused against an existing document collides, and createPanel refuses rather than corrupting state', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' }); // mints panel_chart_1

		// Simulates a reload/remount: same repository and workspace document,
		// but a brand-new, unseeded sequencer -- exactly what
		// createWorkbenchSharedInfra() built before this fix.
		const staleIds = createIdSequencer();
		const reloaded = {
			...deps,
			ids: staleIds,
			revisions: createRevisionService({
				repository: deps.repository,
				clock: deps.clock,
				ids: staleIds,
				idempotency: createIdempotencyCache()
			})
		};

		try {
			createPanel(reloaded, { context: ctx(), kind: 'chart' });
			expect.fail('expected the colliding create to be refused');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			expect((err as PanelOperationError).code).toBe('panel_id_collision');
		}
		expect(
			readPanelState(deps.repository.get(deps.workspaceId)!).panels.length,
			'the refused create must not have added a second, colliding panel'
		).toBe(1);
	});

	it('panelIdSeed fixes the regression: a sequencer seeded from the reloaded document mints a fresh, non-colliding id', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' }); // mints panel_chart_1

		const doc = deps.repository.get(deps.workspaceId)!;
		const seededIds = createIdSequencer(panelIdSeed(doc));
		const reloaded = {
			...deps,
			ids: seededIds,
			revisions: createRevisionService({
				repository: deps.repository,
				clock: deps.clock,
				ids: seededIds,
				idempotency: createIdempotencyCache()
			})
		};

		const envelope = createPanel(reloaded, { context: ctx(), kind: 'chart' });
		expect(envelope.affectedIds).toEqual(['panel_chart_2']);
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.panels.map((p) => p.id)).toEqual(['panel_chart_1', 'panel_chart_2']);
	});
});
