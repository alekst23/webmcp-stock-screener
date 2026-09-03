// hotfix/panel-system: failing stubs for resetLayout.ts's contract, ahead of
// its real implementation. resetLayout(deps, request) currently throws
// ("not implemented") from every call, so every test below is red until the
// implementing agent replaces that stub body.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED_PANELS } from '../domain/defaultLayout';
import { readPanelState } from './panelState';
import { createPanelTestHarness } from './testSupport';
import { createPanel } from './createPanel';
import { linkPanels } from './linkPanels';
import { resetLayout } from './resetLayout';

function ctx() {
	return { actor: 'agent' as const };
}

describe('resetLayout', () => {
	it('spec.md "Reset the workspace layout to the default seed" / happy path: restores the default six-panel seed from a modified arrangement', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, { context: ctx(), kind: 'chart', rect: { col: 0, row: 0, colSpan: 6, rowSpan: 4 } });

		const envelope = resetLayout(deps, { context: ctx() });

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.panels).toHaveLength(DEFAULT_SEED_PANELS.length);
		const kindsAndRects = state.panels
			.map((p) => ({ kind: p.kind, rect: p.rect }))
			.sort((a, b) => a.kind.localeCompare(b.kind));
		const expected = DEFAULT_SEED_PANELS.map((s) => ({ kind: s.kind, rect: s.rect })).sort((a, b) =>
			a.kind.localeCompare(b.kind)
		);
		expect(kindsAndRects, `expected the default seed arrangement, got ${JSON.stringify(kindsAndRects)}`).toEqual(
			expected
		);
		expect(
			envelope.affectedIds.sort(),
			'expected every newly-created panel named as affected'
		).toEqual(state.panels.map((p) => p.id).sort());
	});

	it('drops link groups and selections that referenced the pre-reset panels', () => {
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
		linkPanels(deps, {
			context: ctx(),
			channel: 'symbol',
			panelIds: ['panel_chart_1', 'panel_chart_2']
		});

		resetLayout(deps, { context: ctx() });

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		expect(state.links.groups, 'expected no link groups to survive a reset').toEqual([]);
		expect(state.selections, 'expected no selections to survive a reset').toEqual({});
	});

	it('spec.md "Undo": one undo restores the exact pre-reset arrangement', () => {
		const deps = createPanelTestHarness();
		createPanel(deps, {
			context: ctx(),
			kind: 'watchlist',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		const beforeState = readPanelState(deps.repository.get(deps.workspaceId)!);

		const envelope = resetLayout(deps, { context: ctx() });
		const record = deps.history.findByUndoToken(envelope.undoToken!);
		const restoredState = readPanelState(record!.inverseDraft!.document);

		expect(restoredState.panels, 'undo must bring back the exact pre-reset panel set').toEqual(
			beforeState.panels
		);
	});

	it('spec.md "Already at default": succeeds and reports no effective change when panels already match the seed', () => {
		const deps = createPanelTestHarness();
		resetLayout(deps, { context: ctx() });
		const afterFirstReset = readPanelState(deps.repository.get(deps.workspaceId)!).panels;

		resetLayout(deps, { context: ctx() });
		const afterSecondReset = readPanelState(deps.repository.get(deps.workspaceId)!).panels;

		expect(
			afterSecondReset.map((p) => ({ kind: p.kind, rect: p.rect })),
			'expected the same kind/rect arrangement after resetting an already-default layout'
		).toEqual(afterFirstReset.map((p) => ({ kind: p.kind, rect: p.rect })));
	});
});
