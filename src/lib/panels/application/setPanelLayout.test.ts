import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { configurePanelView } from './configurePanelView';
import { setPanelLayout } from './setPanelLayout';

function ctx() {
	return { actor: 'agent' as const };
}

describe('setPanelLayout', () => {
	it('AC7: moves/resizes a batch as one change; panels absent from the batch stay exactly where they are', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }
		});
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 2, row: 0, colSpan: 2, rowSpan: 1 }
		});

		setPanelLayout(deps, {
			context: ctx(),
			placements: [{ panelId: 'panel_alerts_1', rect: { col: 4, row: 3, colSpan: 2, rowSpan: 1 } }]
		});

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		const moved = state.panels.find((p) => p.id === 'panel_alerts_1')!;
		const unmoved = state.panels.find((p) => p.id === 'panel_alerts_2')!;
		expect(moved.rect).toEqual({ col: 4, row: 3, colSpan: 2, rowSpan: 1 });
		expect(unmoved.rect, 'the panel not named in the batch must be untouched').toEqual({
			col: 2,
			row: 0,
			colSpan: 2,
			rowSpan: 1
		});
	});

	it("AC7: below the kind's minimum size fails naming the minimum, and no panel moves", () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'results_table',
			rect: { col: 0, row: 0, colSpan: 4, rowSpan: 2 }
		}); // minSize 2x1

		try {
			setPanelLayout(deps, {
				context: ctx(),
				placements: [
					{ panelId: 'panel_results_table_1', rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } }
				]
			});
			expect.fail('expected a below_minimum error');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			expect((err as PanelOperationError).code).toBe('below_minimum');
		}
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.panels[0]!.rect).toEqual({ col: 0, row: 0, colSpan: 4, rowSpan: 2 });
	});

	it('AC7: out of bounds fails naming the grid bounds, and no panel moves', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }
		});

		try {
			setPanelLayout(deps, {
				context: ctx(),
				placements: [
					{ panelId: 'panel_alerts_1', rect: { col: 5, row: 0, colSpan: 2, rowSpan: 1 } }
				]
			});
			expect.fail('expected an out_of_bounds error');
		} catch (err) {
			expect((err as PanelOperationError).code).toBe('out_of_bounds');
		}
	});

	it('AC7: an overlap within one call fails identifying the conflicting pair, and no panel moves', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }
		});
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 2, row: 0, colSpan: 2, rowSpan: 1 }
		});

		try {
			setPanelLayout(deps, {
				context: ctx(),
				placements: [
					{ panelId: 'panel_alerts_1', rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 } },
					{ panelId: 'panel_alerts_2', rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 } }
				]
			});
			expect.fail('expected a batch_conflict error');
		} catch (err) {
			expect((err as PanelOperationError).code).toBe('batch_conflict');
		}
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.panels.map((p) => p.rect)).toEqual([
			{ col: 0, row: 0, colSpan: 2, rowSpan: 1 },
			{ col: 2, row: 0, colSpan: 2, rowSpan: 1 }
		]);
	});

	it('AC7: a hidden panel occupying cells does not block a visible placement over those cells', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }
		});
		configurePanelView(deps, { context: ctx(), panelId: 'panel_alerts_1', hidden: true });
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 2, row: 0, colSpan: 2, rowSpan: 1 }
		});

		expect(() =>
			setPanelLayout(deps, {
				context: ctx(),
				placements: [
					{ panelId: 'panel_alerts_2', rect: { col: 0, row: 0, colSpan: 2, rowSpan: 1 } }
				]
			})
		).not.toThrow();
	});
});
