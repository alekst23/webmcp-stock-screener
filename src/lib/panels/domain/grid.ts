// Logical grid coordinates for the panel system. The canvas is a fixed,
// non-scrolling 6-column by 4-row grid (24 cells) that always exactly fills
// the viewport, so a footprint is always expressed in cells and never in
// pixels — the same layout survives any screen size.
// Resolved 2026-09-02; see docs/design/panel-system/technical.md.

export const GRID_COLUMNS = 6;
export const GRID_ROWS = 4;

export interface GridPosition {
	// Zero-based, in [0, GRID_COLUMNS).
	col: number;
	// Zero-based, in [0, GRID_ROWS).
	row: number;
}

export interface GridSize {
	colSpan: number;
	rowSpan: number;
}

export type GridRect = GridPosition & GridSize;
