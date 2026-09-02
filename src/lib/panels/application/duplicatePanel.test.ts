import { describe, expect, it } from 'vitest';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { duplicatePanel } from './duplicatePanel';

function ctx() {
	return { actor: 'agent' as const };
}

describe('duplicatePanel', () => {
	it('AC2: copies kind/config/source/renderer to a new panel with a fresh id and free footprint, original untouched', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'chart',
			config: { symbol: 'AAPL', timeframe: '1D', studies: [] }
		});

		const envelope = duplicatePanel(deps, { context: ctx(), panelId: 'panel_chart_1' });
		expect(envelope.affectedIds).toEqual(['panel_chart_2']);

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.panels.length, `expected two panels, got ${JSON.stringify(state.panels)}`).toBe(2);
		const original = state.panels.find((p) => p.id === 'panel_chart_1')!;
		const copy = state.panels.find((p) => p.id === 'panel_chart_2')!;
		expect(copy.kind).toBe(original.kind);
		expect(copy.config).toEqual(original.config);
		expect(copy.renderer).toBe(original.renderer);
		expect(copy.rect, 'the duplicate must not overlap the original').not.toEqual(original.rect);
		expect(original.rect, 'the original must be untouched').toEqual({
			col: 0,
			row: 0,
			colSpan: 3,
			rowSpan: 2
		});
	});

	it('AC2: an override on duplicate replaces only the overridden field', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'chart',
			config: { symbol: 'AAPL', timeframe: '1D', studies: [] }
		});

		duplicatePanel(deps, { context: ctx(), panelId: 'panel_chart_1', symbolOverride: 'MSFT' });

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		const copy = state.panels.find((p) => p.id === 'panel_chart_2')!;
		expect(
			copy.config.symbol,
			`expected the override to apply, got ${JSON.stringify(copy.config)}`
		).toBe('MSFT');
		expect(copy.config.timeframe, 'unrelated fields must be preserved').toBe('1D');
	});

	it('AC2: an unknown panel id fails and changes nothing', () => {
		const deps = createPanelTestHarness();
		expect(() => duplicatePanel(deps, { context: ctx(), panelId: 'panel_chart_99' })).toThrow(
			PanelOperationError
		);
		expect(deps.repository.get(deps.workspaceId)).toBeNull();
	});
});
