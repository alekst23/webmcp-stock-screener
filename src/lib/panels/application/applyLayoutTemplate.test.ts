import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { applyLayoutTemplate } from './applyLayoutTemplate';

function ctx() {
	return { actor: 'agent' as const };
}

describe('applyLayoutTemplate', () => {
	it("AC7: applies a named template's footprints to the named panels atomically", () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
		});
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }
		});
		createPanel(deps, {
			context: ctx(),
			kind: 'alerts',
			rect: { col: 2, row: 0, colSpan: 1, rowSpan: 1 }
		});

		const envelope = applyLayoutTemplate(deps, {
			context: ctx(),
			templateName: 'three_columns',
			panelIds: ['panel_alerts_1', 'panel_alerts_2', 'panel_alerts_3']
		});
		expect(envelope.affectedIds).toEqual(['panel_alerts_1', 'panel_alerts_2', 'panel_alerts_3']);

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.panels.find((p) => p.id === 'panel_alerts_1')!.rect).toEqual({
			col: 0,
			row: 0,
			colSpan: 2,
			rowSpan: 4
		});
		expect(state.panels.find((p) => p.id === 'panel_alerts_2')!.rect).toEqual({
			col: 2,
			row: 0,
			colSpan: 2,
			rowSpan: 4
		});
		expect(state.panels.find((p) => p.id === 'panel_alerts_3')!.rect).toEqual({
			col: 4,
			row: 0,
			colSpan: 2,
			rowSpan: 4
		});
	});

	it('AC7: an unknown template fails, changes nothing, and lists every registered template', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'alerts' });

		try {
			applyLayoutTemplate(deps, {
				context: ctx(),
				templateName: 'not_a_template',
				panelIds: ['panel_alerts_1']
			});
			expect.fail('expected an unknown_layout_template error');
		} catch (err) {
			expect(err).toBeInstanceOf(PanelOperationError);
			const opErr = err as PanelOperationError;
			expect(opErr.code).toBe('unknown_layout_template');
			expect((opErr.details.registeredTemplates as string[]).length).toBeGreaterThan(0);
		}
	});

	it('fails cleanly when the panel count does not match the template slot count', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'alerts' });

		expect(() =>
			applyLayoutTemplate(deps, {
				context: ctx(),
				templateName: 'quad',
				panelIds: ['panel_alerts_1']
			})
		).toThrow(PanelOperationError);
	});
});
