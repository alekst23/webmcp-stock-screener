// hotfix/empty-grid-canvas: proves the grid illustration actually reaches
// the DOM -- one outline element per unoccupied cell, none for occupied
// ones, and none that intercept pointer events. Mounts the real
// PanelContainer against createDefaultPanelShellRuntime()'s real deps
// (same pattern richDefaultLayout.test.ts uses), so this exercises the
// container's actual render path, not a stand-in.
//
// CONTRACT STUB -- driven by docs/design/panel-system/technical.md
// "Illustrate the empty grid": empty cells are rendered with
// data-testid="empty-cell" and pointer-events: none. Body replaced by the
// implementing agent as it wires PanelContainer.svelte to computeEmptyCells.
import { beforeEach, describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import PanelContainer from './PanelContainer.svelte';
import { createDefaultPanelShellRuntime } from './registerPanelTools';
import { createPanel } from '../application';
import { GRID_COLUMNS, GRID_ROWS } from '../domain/grid';

beforeEach(() => {
	localStorage.clear();
});

describe('PanelContainer renders an outline for every unoccupied cell', () => {
	it('shows 20 empty-cell outlines around the seeded filter_builder panel', () => {
		const { deps, observer } = createDefaultPanelShellRuntime();

		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelContainer, { target, props: { deps, observer } });
		flushSync();

		const panelFrames = target.querySelectorAll('.panel-frame');
		expect(
			panelFrames.length,
			'expected the seeded filter_builder to render as one panel frame'
		).toBe(1);

		const emptyCells = target.querySelectorAll('[data-testid="empty-cell"]');
		expect(
			emptyCells.length,
			`expected 20 empty-cell outlines (24 - 4 occupied), got ${emptyCells.length}`
		).toBe(GRID_COLUMNS * GRID_ROWS - 4);

		unmount(instance);
	});

	it('shows zero empty-cell outlines once the whole grid is occupied', () => {
		const { deps, observer } = createDefaultPanelShellRuntime();
		createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 1, row: 0, colSpan: 5, rowSpan: 4 }
		});

		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelContainer, { target, props: { deps, observer } });
		flushSync();

		expect(target.querySelectorAll('[data-testid="empty-cell"]').length).toBe(0);

		unmount(instance);
	});

	it('empty-cell outlines never intercept pointer events', () => {
		const { deps, observer } = createDefaultPanelShellRuntime();

		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelContainer, { target, props: { deps, observer } });
		flushSync();

		const outlines = target.querySelectorAll<HTMLElement>('[data-testid="empty-cell"]');
		expect(outlines.length).toBeGreaterThan(0);
		for (const outline of outlines) {
			expect(
				getComputedStyle(outline).pointerEvents,
				'expected every empty-cell outline to have pointer-events: none'
			).toBe('none');
		}

		unmount(instance);
	});
});
