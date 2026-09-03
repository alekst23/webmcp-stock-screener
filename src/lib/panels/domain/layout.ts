// Pure geometry over the fixed 6x4 logical grid. No state, no I/O, and no
// knowledge of panel kinds, hidden panels, the link graph, WebMCP, or
// Svelte — kind minimum sizes are passed in as data by the caller, and
// `occupied` is always assumed to already exclude hidden panels (the caller
// filters before calling in here; this module has no "hidden" concept).

import { GRID_COLUMNS, GRID_ROWS, type GridRect, type GridSize } from './grid';

export interface OccupiedRect {
	panelId: string;
	rect: GridRect;
}

export type PlacementViolation =
	| { code: 'invalid_size'; message: string; rect: GridRect }
	| {
			code: 'out_of_bounds';
			message: string;
			rect: GridRect;
			gridColumns: number;
			gridRows: number;
	  }
	| { code: 'below_minimum'; message: string; rect: GridRect; minSize: GridSize }
	| { code: 'overlap'; message: string; rect: GridRect; occupiedBy: string }
	| { code: 'batch_conflict'; message: string; panelIds: [string, string] };

export type PlacementResult =
	{ ok: true; rect: GridRect } | { ok: false; violation: PlacementViolation };

// Half-open intervals: a rect spans [col, col+colSpan) x [row, row+rowSpan).
// Rects that merely touch an edge (one's end equals the other's start) do
// NOT overlap — that is the single most likely off-by-one in this module.
export function rectsOverlap(a: GridRect, b: GridRect): boolean {
	const colsOverlap = a.col < b.col + b.colSpan && b.col < a.col + a.colSpan;
	const rowsOverlap = a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan;
	return colsOverlap && rowsOverlap;
}

function isInvalidSize(rect: GridRect): boolean {
	return (
		!Number.isInteger(rect.colSpan) ||
		!Number.isInteger(rect.rowSpan) ||
		rect.colSpan < 1 ||
		rect.rowSpan < 1
	);
}

function isOutOfBounds(rect: GridRect): boolean {
	return (
		!Number.isInteger(rect.col) ||
		!Number.isInteger(rect.row) ||
		rect.col < 0 ||
		rect.row < 0 ||
		rect.col + rect.colSpan > GRID_COLUMNS ||
		rect.row + rect.rowSpan > GRID_ROWS
	);
}

function isBelowMinimum(rect: GridRect, minSize: GridSize): boolean {
	return rect.colSpan < minSize.colSpan || rect.rowSpan < minSize.rowSpan;
}

function findOverlap(
	rect: GridRect,
	occupied: OccupiedRect[],
	ignorePanelId: string | undefined
): OccupiedRect | undefined {
	return occupied.find((o) => o.panelId !== ignorePanelId && rectsOverlap(rect, o.rect));
}

// Bounds + min-size + overlap in one pass, checked in that fixed order so a
// rect failing several checks at once always reports the same violation.
export function validatePlacement(input: {
	rect: GridRect;
	minSize: GridSize;
	occupied: OccupiedRect[];
	ignorePanelId?: string;
}): PlacementResult {
	const { rect, minSize, occupied, ignorePanelId } = input;

	if (isInvalidSize(rect)) {
		return {
			ok: false,
			violation: {
				code: 'invalid_size',
				message: `Footprint spans must be whole numbers of at least 1 (got colSpan=${rect.colSpan}, rowSpan=${rect.rowSpan}).`,
				rect
			}
		};
	}

	if (isOutOfBounds(rect)) {
		return {
			ok: false,
			violation: {
				code: 'out_of_bounds',
				message: `Footprint at (${rect.col}, ${rect.row}) sized ${rect.colSpan}x${rect.rowSpan} exceeds the grid's ${GRID_COLUMNS}x${GRID_ROWS} bounds.`,
				rect,
				gridColumns: GRID_COLUMNS,
				gridRows: GRID_ROWS
			}
		};
	}

	if (isBelowMinimum(rect, minSize)) {
		return {
			ok: false,
			violation: {
				code: 'below_minimum',
				message: `Footprint ${rect.colSpan}x${rect.rowSpan} is below the minimum size ${minSize.colSpan}x${minSize.rowSpan}.`,
				rect,
				minSize
			}
		};
	}

	const collision = findOverlap(rect, occupied, ignorePanelId);
	if (collision !== undefined) {
		return {
			ok: false,
			violation: {
				code: 'overlap',
				message: `Footprint at (${rect.col}, ${rect.row}) sized ${rect.colSpan}x${rect.rowSpan} overlaps panel "${collision.panelId}".`,
				rect,
				occupiedBy: collision.panelId
			}
		};
	}

	return { ok: true, rect };
}

// Deterministic top-left-first scan, row-major from (0,0): the same
// `occupied` set always yields the same rect, so a replayed idempotent
// create_panel produces the identical layout. Returns null — never throws
// — when no free rect of that size exists anywhere in the bounded 6x4
// grid (including when `size` itself exceeds a grid dimension), so the
// caller reports "grid is full" rather than the search overflowing past
// GRID_ROWS.
export function findFreeRect(size: GridSize, occupied: OccupiedRect[]): GridRect | null {
	for (let row = 0; row <= GRID_ROWS - size.rowSpan; row++) {
		for (let col = 0; col <= GRID_COLUMNS - size.colSpan; col++) {
			const candidate: GridRect = { col, row, colSpan: size.colSpan, rowSpan: size.rowSpan };
			if (findOverlap(candidate, occupied, undefined) === undefined) {
				return candidate;
			}
		}
	}
	return null;
}

export interface Placement {
	panelId: string;
	rect: GridRect;
	minSize: GridSize;
}

export type LayoutResult =
	{ ok: true; rects: OccupiedRect[] } | { ok: false; violation: PlacementViolation };

function findBatchConflict(placements: Placement[]): [Placement, Placement] | undefined {
	for (const [i, a] of placements.entries()) {
		for (const b of placements.slice(i + 1)) {
			if (rectsOverlap(a.rect, b.rect)) {
				return [a, b];
			}
		}
	}
	return undefined;
}

// All-or-nothing batch move/resize. Panels in `current` but absent from
// `placements` keep their existing rect exactly. Each placement is
// validated against only the panels NOT in this batch — a panel moving out
// of its old cell must never block itself or a batch-mate — then the
// placements are checked pairwise against each other; two placements in
// the same batch colliding yields a 'batch_conflict' naming both panel ids.
export function applyLayout(current: OccupiedRect[], placements: Placement[]): LayoutResult {
	const movingIds = new Set(placements.map((p) => p.panelId));
	const unmoved = current.filter((o) => !movingIds.has(o.panelId));

	for (const placement of placements) {
		const result = validatePlacement({
			rect: placement.rect,
			minSize: placement.minSize,
			occupied: unmoved
		});
		if (!result.ok) {
			return { ok: false, violation: result.violation };
		}
	}

	const conflict = findBatchConflict(placements);
	if (conflict !== undefined) {
		const [a, b] = conflict;
		return {
			ok: false,
			violation: {
				code: 'batch_conflict',
				message: `Panels "${a.panelId}" and "${b.panelId}" would occupy the same cells in this batch.`,
				panelIds: [a.panelId, b.panelId]
			}
		};
	}

	const moved: OccupiedRect[] = placements.map((p) => ({ panelId: p.panelId, rect: p.rect }));
	return { ok: true, rects: [...unmoved, ...moved] };
}

export type SplitResult =
	| { ok: true; original: GridRect; created: GridRect }
	| { ok: false; violation: PlacementViolation };

// Divides one rect in two along a line through its middle. 'vertical'
// splits along a vertical line into left (original) / right (created)
// halves, dividing colSpan; 'horizontal' splits along a horizontal line
// into top (original) / bottom (created) halves, dividing rowSpan — the
// split line's orientation names the direction, per the common
// pane-splitting convention. The midpoint favors `original` (it gets the
// equal or larger half via Math.ceil). `minSize` is checked against BOTH
// halves; a span that rounds to 0 (splitting a span of 1) is naturally
// rejected by the minimum check since every real minSize is >= 1, so no
// separate zero-span guard is needed. Neither half needs a bounds/overlap
// re-check: both are subsets of an already-valid parent rect.
export function splitRect(input: {
	rect: GridRect;
	direction: 'horizontal' | 'vertical';
	originalMinSize: GridSize;
	createdMinSize: GridSize;
}): SplitResult {
	const { rect, direction, originalMinSize, createdMinSize } = input;

	const [original, created] =
		direction === 'vertical'
			? splitAlong(rect, 'col', 'colSpan')
			: splitAlong(rect, 'row', 'rowSpan');

	if (isBelowMinimum(original, originalMinSize)) {
		return {
			ok: false,
			violation: {
				code: 'below_minimum',
				message: `Split leaves the original panel at ${original.colSpan}x${original.rowSpan}, below its minimum ${originalMinSize.colSpan}x${originalMinSize.rowSpan}.`,
				rect: original,
				minSize: originalMinSize
			}
		};
	}

	if (isBelowMinimum(created, createdMinSize)) {
		return {
			ok: false,
			violation: {
				code: 'below_minimum',
				message: `Split leaves the new panel at ${created.colSpan}x${created.rowSpan}, below its minimum ${createdMinSize.colSpan}x${createdMinSize.rowSpan}.`,
				rect: created,
				minSize: createdMinSize
			}
		};
	}

	return { ok: true, original, created };
}

// Splits `rect` along one axis (col/colSpan or row/rowSpan), giving the
// original the equal or larger half.
function splitAlong(
	rect: GridRect,
	posKey: 'col' | 'row',
	spanKey: 'colSpan' | 'rowSpan'
): [GridRect, GridRect] {
	const span = rect[spanKey];
	const originalSpan = Math.ceil(span / 2);
	const createdSpan = span - originalSpan;

	const original: GridRect = { ...rect, [spanKey]: originalSpan };
	const created: GridRect = {
		...rect,
		[posKey]: rect[posKey] + originalSpan,
		[spanKey]: createdSpan
	};

	return [original, created];
}

// The full-grid rect maximize_panel renders at. Never stored on a panel —
// computed fresh each call for render-only state layered over the saved
// layout.
export function fullGridRect(): GridRect {
	return { col: 0, row: 0, colSpan: GRID_COLUMNS, rowSpan: GRID_ROWS };
}

// Walks every unit cell of the columns x rows grid, row-major from (0, 0),
// and returns the ones not covered by any rect in `occupied` as their own
// 1x1 GridRect -- used to render the empty-grid illustration. Reuses
// rectsOverlap rather than re-deriving overlap math.
export function computeEmptyCells(
	occupied: OccupiedRect[],
	columns: number = GRID_COLUMNS,
	rows: number = GRID_ROWS
): GridRect[] {
	const empty: GridRect[] = [];
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < columns; col++) {
			const cell: GridRect = { col, row, colSpan: 1, rowSpan: 1 };
			const covered = occupied.some((o) => rectsOverlap(cell, o.rect));
			if (!covered) {
				empty.push(cell);
			}
		}
	}
	return empty;
}
