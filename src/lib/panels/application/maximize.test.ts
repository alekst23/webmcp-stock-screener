import { describe, expect, it } from 'vitest';
import { makePanel } from '../domain/panel';
import { GRID_COLUMNS, GRID_ROWS } from '../domain/grid';
import { renderedRects } from './maximize';

function panel(id: string, hidden = false) {
	return makePanel({
		id,
		kind: 'chart',
		title: id,
		config: {},
		rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
		hidden
	});
}

describe('renderedRects', () => {
	it('renders every visible panel at its saved rect when nothing is maximized', () => {
		const panels = [panel('a'), panel('b')];
		const rects = renderedRects(panels, null);
		expect(
			rects.map((r) => r.panelId).sort(),
			`expected both panels rendered, got ${JSON.stringify(rects)}`
		).toEqual(['a', 'b']);
	});

	it('renders only the maximized panel, at the full grid, when one is maximized', () => {
		const panels = [panel('a'), panel('b')];
		const rects = renderedRects(panels, 'a');
		expect(rects, `expected only "a" at the full grid rect, got ${JSON.stringify(rects)}`).toEqual([
			{ panelId: 'a', rect: { col: 0, row: 0, colSpan: GRID_COLUMNS, rowSpan: GRID_ROWS } }
		]);
	});

	it('restoring from maximize (null) renders the exact same layout as before maximizing', () => {
		const panels = [panel('a'), panel('b'), panel('c')];
		const before = renderedRects(panels, null);
		renderedRects(panels, 'b'); // maximize, never mutates `panels`
		const after = renderedRects(panels, null);
		expect(after, 'restoring must render exactly the pre-maximize layout').toEqual(before);
	});

	it('never renders a hidden panel, maximized or not', () => {
		const panels = [panel('a', true), panel('b')];
		expect(renderedRects(panels, null).map((r) => r.panelId)).toEqual(['b']);
		expect(
			renderedRects(panels, 'a').map((r) => r.panelId),
			'a maximized-but-hidden panel must not render'
		).toEqual(['b']);
	});
});
