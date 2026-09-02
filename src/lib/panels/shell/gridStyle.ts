// T-1007-8 AC4: the CSS half of the fixed, non-scrolling 6x4 grid. Row and
// column sizing is expressed as fractions of the container, never a
// JS-computed pixel table, so the same layout holds at any viewport size --
// there is no new domain state here beyond the existing GRID_COLUMNS/
// GRID_ROWS, just the mapping from a logical rect to a CSS placement.
import { GRID_COLUMNS, GRID_ROWS, type GridRect } from '../domain/grid';

// The outer grid: fills exactly 100% of the viewport's width and height,
// laid out in GRID_COLUMNS equal columns and GRID_ROWS equal rows.
export function containerGridStyle(): string {
	return (
		'display: grid; ' +
		`grid-template-columns: repeat(${GRID_COLUMNS}, 1fr); ` +
		`grid-template-rows: repeat(${GRID_ROWS}, 1fr); ` +
		'width: 100%; height: 100%;'
	);
}

// A panel's placement from its zero-based stored rect. CSS grid lines are
// 1-based, so col/row are offset by one; `span N` reads directly off the
// rect's colSpan/rowSpan.
//
// min-width/min-height: 0 defeats the classic CSS-grid overflow trap -- a
// grid item's default min-size is `auto`, which grows to fit its content
// and can blow out the row/column track (and therefore the page) past the
// viewport. overflow: hidden on the frame itself means only the frame's own
// body (not this element) may ever introduce a scrollbar.
export function panelFrameStyle(rect: GridRect): string {
	return (
		`grid-column: ${rect.col + 1} / span ${rect.colSpan}; ` +
		`grid-row: ${rect.row + 1} / span ${rect.rowSpan}; ` +
		'min-width: 0; min-height: 0; overflow: hidden;'
	);
}
