import { describe, expect, it } from 'vitest';
import { containerGridStyle, emptyCellBorderStyle, panelFrameStyle } from './gridStyle';

describe('containerGridStyle', () => {
	it('lays out a 6x4 fractional grid filling the viewport', () => {
		const style = containerGridStyle();
		expect(style, `expected a 6-column track, got: ${style}`).toContain(
			'grid-template-columns: repeat(6, 1fr)'
		);
		expect(style, `expected a 4-row track, got: ${style}`).toContain(
			'grid-template-rows: repeat(4, 1fr)'
		);
		expect(style, `expected the container to fill its viewport, got: ${style}`).toContain(
			'width: 100%; height: 100%;'
		);
	});
});

describe('panelFrameStyle', () => {
	it('maps a zero-based rect to 1-based CSS grid lines', () => {
		const style = panelFrameStyle({ col: 1, row: 2, colSpan: 2, rowSpan: 1 });
		expect(style, `expected col 1 -> grid line 2, got: ${style}`).toContain(
			'grid-column: 2 / span 2;'
		);
		expect(style, `expected row 2 -> grid line 3, got: ${style}`).toContain(
			'grid-row: 3 / span 1;'
		);
	});

	it('spans the full width for a colSpan of 6', () => {
		const style = panelFrameStyle({ col: 0, row: 0, colSpan: 6, rowSpan: 4 });
		expect(style, `expected a full-width column span, got: ${style}`).toContain(
			'grid-column: 1 / span 6;'
		);
	});

	it('defeats the grid overflow trap on every panel frame', () => {
		const style = panelFrameStyle({ col: 0, row: 0, colSpan: 1, rowSpan: 1 });
		expect(style, `expected min-width/min-height resets, got: ${style}`).toContain(
			'min-width: 0; min-height: 0;'
		);
		expect(style, `expected overflow to be contained to the frame, got: ${style}`).toContain(
			'overflow: hidden;'
		);
	});
});

// hotfix/panel-default-width-grid-lines: the empty-grid outline should blend
// further into the background -- a dotted line in the new, darker
// --grid-line token, rather than the old solid --separator border.
describe('emptyCellBorderStyle', () => {
	it('renders a dotted border in the darker grid-line token, not a solid one', () => {
		const style = emptyCellBorderStyle();
		expect(style, `expected a dotted border style, got: ${style}`).toContain('dotted');
		expect(style, `expected the dedicated --grid-line token, got: ${style}`).toContain(
			'--grid-line'
		);
		expect(style, `expected no solid border left over, got: ${style}`).not.toContain('solid');
	});
});
