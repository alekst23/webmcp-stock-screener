// T-0027-2: maps a raw drop point to the 1x1 grid cell under it, using the
// same uniform-fraction geometry gridStyle.ts's containerGridStyle renders
// (GRID_COLUMNS equal columns, GRID_ROWS equal rows, filling the
// container exactly) -- pure so it's testable without a real DOM drag
// event or a mounted component. PanelContainer.svelte's own drop handler
// is the only caller: it already knows a drop landed on the empty
// background (not on an existing panel-frame, which is resolved
// separately, by DOM lookup) and needs to know which grid cell that point
// falls in -- the anchor `createChartFromDrop` (panelController.ts) places
// the dropped-on kind's own footprint at (AC1), instead of relying on
// auto-placement.
import { GRID_COLUMNS, GRID_ROWS, type GridPosition } from '../domain/grid';

export interface DropPoint {
	clientX: number;
	clientY: number;
}

export interface ContainerBounds {
	left: number;
	top: number;
	width: number;
	height: number;
}

export function resolveDropCell(
	point: DropPoint,
	bounds: ContainerBounds,
	columns: number = GRID_COLUMNS,
	rows: number = GRID_ROWS
): GridPosition | null {
	if (bounds.width <= 0 || bounds.height <= 0) {
		return null;
	}
	const col = Math.floor(((point.clientX - bounds.left) / bounds.width) * columns);
	const row = Math.floor(((point.clientY - bounds.top) / bounds.height) * rows);
	if (col < 0 || col >= columns || row < 0 || row >= rows) {
		return null;
	}
	return { col, row };
}
