import { describe, expect, it } from 'vitest';
import type { RendererTypeDefinition } from '../registry/sourceRendererRegistry';
import { PanelOperationError } from './errors';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { linkPanels } from './linkPanels';
import { setPanelSelection } from './setPanelSelection';

function ctx() {
	return { actor: 'agent' as const };
}

const PLAIN_RENDERER: RendererTypeDefinition = {
	name: 'mock_plain_renderer',
	configSchema: { type: 'object', properties: {} },
	validateConfig: () => ({ ok: true, value: {} }),
	defaultConfig: () => ({}),
	acceptedSourceTypes: []
	// No validateSelection, no selectionCapacity -- this is the pre-T-1010-6 shape.
};

// Rejects any selection containing 'bad', and only ever shows one result at a time.
const STRICT_SINGLE_RENDERER: RendererTypeDefinition = {
	name: 'mock_strict_single_renderer',
	configSchema: { type: 'object', properties: {} },
	validateConfig: () => ({ ok: true, value: {} }),
	defaultConfig: () => ({}),
	acceptedSourceTypes: [],
	selectionCapacity: 'single',
	validateSelection: ({ selectedIds }) =>
		selectedIds.includes('bad')
			? { ok: false, errors: [{ field: 'selected_ids', reason: '"bad" is not permitted' }] }
			: { ok: true }
};

describe('setPanelSelection: T-1010-6 hooks are additive and backward compatible', () => {
	it('a renderer with no validateSelection/selectionCapacity accepts and propagates anything, as before', () => {
		const deps = createPanelTestHarness();
		deps.sourceRenderer.registerRendererType(PLAIN_RENDERER);
		createPanel(deps, { context: ctx(), kind: 'chart', renderer: 'mock_plain_renderer' });
		createPanel(deps, { context: ctx(), kind: 'chart', renderer: 'mock_plain_renderer' });
		linkPanels(deps, {
			context: ctx(),
			channel: 'result_selection',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});

		const envelope = setPanelSelection(deps, {
			context: { actor: 'agent', expectedRevision: 3 },
			panelId: 'panel_chart_1',
			selectedIds: ['anything', 'goes', 'here']
		});

		expect(envelope.warnings).toEqual([]);
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.selections['panel_chart_2']).toEqual(['anything', 'goes', 'here']);
	});

	it('a renderer that defines validateSelection rejects an unacceptable selection, changing nothing', () => {
		const deps = createPanelTestHarness();
		deps.sourceRenderer.registerRendererType(STRICT_SINGLE_RENDERER);
		createPanel(deps, { context: ctx(), kind: 'chart', renderer: 'mock_strict_single_renderer' });
		setPanelSelection(deps, {
			context: ctx(),
			panelId: 'panel_chart_1',
			selectedIds: ['good']
		});

		expect(() =>
			setPanelSelection(deps, {
				context: ctx(),
				panelId: 'panel_chart_1',
				selectedIds: ['bad']
			})
		).toThrow(PanelOperationError);

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.selections['panel_chart_1'], 'a rejected selection changes nothing').toEqual([
			'good'
		]);
	});

	it('a renderer that declares selectionCapacity "single" only propagates the primary selection', () => {
		const deps = createPanelTestHarness();
		deps.sourceRenderer.registerRendererType(PLAIN_RENDERER);
		deps.sourceRenderer.registerRendererType(STRICT_SINGLE_RENDERER);
		createPanel(deps, { context: ctx(), kind: 'chart', renderer: 'mock_plain_renderer' });
		createPanel(deps, { context: ctx(), kind: 'chart', renderer: 'mock_strict_single_renderer' });
		linkPanels(deps, {
			context: ctx(),
			channel: 'result_selection',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});

		const envelope = setPanelSelection(deps, {
			context: ctx(),
			panelId: 'panel_chart_1',
			selectedIds: ['r1', 'r2']
		});

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.selections['panel_chart_1']).toEqual(['r1', 'r2']);
		expect(
			state.selections['panel_chart_2'],
			'the single-capacity target gets only the primary'
		).toEqual(['r1']);
		expect(envelope.warnings.length).toBeGreaterThan(0);
	});
});

describe('setPanelSelection', () => {
	it('AC8: propagates a selection to every panel in the result_selection group, and to no panel outside it', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'chart',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		createPanel(deps, {
			context: ctx(),
			kind: 'chart',
			rect: { col: 2, row: 0, colSpan: 2, rowSpan: 2 }
		});
		createPanel(deps, {
			context: ctx(),
			kind: 'chart',
			rect: { col: 4, row: 0, colSpan: 2, rowSpan: 2 }
		}); // not linked
		linkPanels(deps, {
			context: ctx(),
			channel: 'result_selection',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});

		const envelope = setPanelSelection(deps, {
			context: ctx(),
			panelId: 'panel_chart_1',
			selectedIds: ['r1', 'r2']
		});
		expect(envelope.affectedIds.sort()).toEqual(['panel_chart_1', 'panel_chart_2']);

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.selections['panel_chart_1']).toEqual(['r1', 'r2']);
		expect(
			state.selections['panel_chart_2'],
			'the linked panel must receive the same selection'
		).toEqual(['r1', 'r2']);
		expect(
			state.selections['panel_chart_3'],
			'the unlinked panel must not receive the selection'
		).toBeUndefined();
	});

	it('AC8: selecting an empty set clears the selection and the clear propagates', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart' });
		createPanel(deps, { context: ctx(), kind: 'chart' });
		linkPanels(deps, {
			context: ctx(),
			channel: 'result_selection',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});
		setPanelSelection(deps, { context: ctx(), panelId: 'panel_chart_1', selectedIds: ['r1'] });

		setPanelSelection(deps, { context: ctx(), panelId: 'panel_chart_1', selectedIds: [] });

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.selections['panel_chart_1']).toEqual([]);
		expect(
			state.selections['panel_chart_2'],
			'the clear must propagate like any other change'
		).toEqual([]);
	});

	it('an unknown panel id fails and says the id is unknown', () => {
		const deps = createPanelTestHarness();
		expect(() =>
			setPanelSelection(deps, { context: ctx(), panelId: 'panel_chart_99', selectedIds: [] })
		).toThrow(PanelOperationError);
	});
});
