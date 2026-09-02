import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { splitPanel } from './splitPanel';

function ctx() {
	return { actor: 'agent' as const };
}

describe('splitPanel', () => {
	it("AC7: divides the panel's footprint into two, creating a new panel that keeps its own id/kind/source/renderer", () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 4, rowSpan: 2 }
		});

		const envelope = splitPanel(deps, {
			context: ctx(),
			panelId: 'panel_chart_1',
			direction: 'vertical'
		});
		expect(envelope.affectedIds).toEqual(['panel_chart_1', 'panel_chart_2']);

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		const original = state.panels.find((p) => p.id === 'panel_chart_1')!;
		const created = state.panels.find((p) => p.id === 'panel_chart_2')!;
		expect(original.rect).toEqual({ col: 0, row: 0, colSpan: 2, rowSpan: 2 });
		expect(created.rect).toEqual({ col: 2, row: 0, colSpan: 2, rowSpan: 2 });
		expect(created.kind).toBe(original.kind);
		expect(created.renderer).toBe(original.renderer);
	});

	it('AC7: a split that would leave a half below the minimum size fails, and no panel is split or resized', () => {
		const deps = createPanelTestHarness();
		// chart minSize is 2x2; a 3x2 footprint split vertically yields 2x2/1x2 -- the created half is below minimum.
		createPanel(deps, {
			context: ctx(),
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 3, rowSpan: 2 }
		});

		try {
			splitPanel(deps, { context: ctx(), panelId: 'panel_chart_1', direction: 'vertical' });
			expect.fail('expected a below_minimum error');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			expect((err as PanelOperationError).code).toBe('below_minimum');
		}
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.panels.length).toBe(1);
		expect(state.panels[0]!.rect).toEqual({ col: 0, row: 0, colSpan: 3, rowSpan: 2 });
	});
});
