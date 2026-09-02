import { describe, expect, it } from 'vitest';
import { GRID_COLUMNS, GRID_ROWS, type GridRect } from './grid';
import {
	applyLayout,
	findFreeRect,
	fullGridRect,
	rectsOverlap,
	splitRect,
	validatePlacement,
	type OccupiedRect,
	type Placement
} from './layout';

const NO_MIN = { colSpan: 1, rowSpan: 1 };

function rect(col: number, row: number, colSpan: number, rowSpan: number): GridRect {
	return { col, row, colSpan, rowSpan };
}

describe('rectsOverlap', () => {
	it('detects overlap when rects share at least one cell', () => {
		const a = rect(0, 0, 2, 2);
		const b = rect(1, 1, 2, 2);
		expect(rectsOverlap(a, b), `expected overlap for ${JSON.stringify({ a, b })}`).toBe(true);
	});

	it('does not treat rects that merely touch on the right edge as overlapping', () => {
		const a = rect(0, 0, 2, 2);
		const b = rect(2, 0, 2, 2);
		expect(
			rectsOverlap(a, b),
			`expected no overlap for touching columns ${JSON.stringify({ a, b })}`
		).toBe(false);
	});

	it('does not treat rects that merely touch on the bottom edge as overlapping', () => {
		const a = rect(0, 0, 2, 2);
		const b = rect(0, 2, 2, 2);
		expect(
			rectsOverlap(a, b),
			`expected no overlap for touching rows ${JSON.stringify({ a, b })}`
		).toBe(false);
	});

	it('is symmetric', () => {
		const a = rect(0, 0, 3, 2);
		const b = rect(2, 1, 3, 2);
		expect(rectsOverlap(a, b)).toBe(rectsOverlap(b, a));
	});
});

describe('validatePlacement — footprint shape', () => {
	it('accepts a whole-number footprint with spans of at least 1', () => {
		const result = validatePlacement({ rect: rect(0, 0, 1, 1), minSize: NO_MIN, occupied: [] });
		expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
	});

	it('rejects a colSpan of 0 as invalid_size', () => {
		const result = validatePlacement({ rect: rect(0, 0, 0, 1), minSize: NO_MIN, occupied: [] });
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('invalid_size');
		}
	});

	it('rejects a non-integer rowSpan as invalid_size', () => {
		const result = validatePlacement({ rect: rect(0, 0, 1, 1.5), minSize: NO_MIN, occupied: [] });
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('invalid_size');
		}
	});
});

describe('validatePlacement — bounds', () => {
	it('rejects a footprint extending past the last column, naming the bound', () => {
		const result = validatePlacement({
			rect: rect(GRID_COLUMNS - 1, 0, 2, 1),
			minSize: NO_MIN,
			occupied: []
		});
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('out_of_bounds');
			if (result.violation.code === 'out_of_bounds') {
				expect(result.violation.gridColumns).toBe(GRID_COLUMNS);
				expect(result.violation.message).toContain(String(GRID_COLUMNS));
			}
		}
	});

	it('rejects a footprint extending past the last row, naming the bound (T-1007-8 AC1)', () => {
		const result = validatePlacement({
			rect: rect(0, GRID_ROWS - 1, 1, 2),
			minSize: NO_MIN,
			occupied: []
		});
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('out_of_bounds');
			if (result.violation.code === 'out_of_bounds') {
				expect(result.violation.gridRows).toBe(GRID_ROWS);
				expect(result.violation.message).toContain(String(GRID_ROWS));
			}
		}
	});

	it('accepts a footprint exactly filling the grid', () => {
		const result = validatePlacement({
			rect: rect(0, 0, GRID_COLUMNS, GRID_ROWS),
			minSize: NO_MIN,
			occupied: []
		});
		expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
	});

	it('rejects a negative origin as out_of_bounds', () => {
		const result = validatePlacement({ rect: rect(-1, 0, 1, 1), minSize: NO_MIN, occupied: [] });
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('out_of_bounds');
		}
	});
});

describe('validatePlacement — minimum size', () => {
	it('rejects a footprint below the declared minimum, naming the minimum', () => {
		const minSize = { colSpan: 2, rowSpan: 2 };
		const result = validatePlacement({ rect: rect(0, 0, 1, 2), minSize, occupied: [] });
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('below_minimum');
			if (result.violation.code === 'below_minimum') {
				expect(result.violation.minSize).toEqual(minSize);
				expect(result.violation.message).toContain('2x2');
			}
		}
	});

	it('accepts a footprint exactly at the minimum', () => {
		const minSize = { colSpan: 2, rowSpan: 2 };
		const result = validatePlacement({ rect: rect(0, 0, 2, 2), minSize, occupied: [] });
		expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
	});
});

describe('validatePlacement — overlap', () => {
	const occupied: OccupiedRect[] = [{ panelId: 'panel-a', rect: rect(0, 0, 2, 2) }];

	it('rejects a placement overlapping an existing panel, naming it', () => {
		const result = validatePlacement({ rect: rect(1, 1, 2, 2), minSize: NO_MIN, occupied });
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('overlap');
			if (result.violation.code === 'overlap') {
				expect(result.violation.occupiedBy).toBe('panel-a');
				expect(result.violation.message).toContain('panel-a');
			}
		}
	});

	it('accepts a placement that only touches the occupied rect at an edge', () => {
		const result = validatePlacement({ rect: rect(2, 0, 2, 2), minSize: NO_MIN, occupied });
		expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
	});

	it('lets ignorePanelId revalidate a panel against its own current cells', () => {
		const result = validatePlacement({
			rect: rect(0, 0, 3, 2),
			minSize: NO_MIN,
			occupied,
			ignorePanelId: 'panel-a'
		});
		expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
	});

	it('accepts a placement over cells of a panel not passed in occupied (hidden-panel exclusion)', () => {
		// The caller is responsible for filtering hidden panels out of `occupied`
		// before calling in here — this module has no concept of "hidden". A
		// panel simply absent from `occupied` never blocks a placement.
		const result = validatePlacement({ rect: rect(0, 0, 2, 2), minSize: NO_MIN, occupied: [] });
		expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
	});
});

describe('findFreeRect', () => {
	it('places the first panel at the top-left origin', () => {
		const found = findFreeRect({ colSpan: 2, rowSpan: 2 }, []);
		expect(found, 'expected a free rect on an empty grid').toEqual(rect(0, 0, 2, 2));
	});

	it('scans row-major, skipping occupied cells', () => {
		const occupied: OccupiedRect[] = [{ panelId: 'a', rect: rect(0, 0, 6, 1) }];
		const found = findFreeRect({ colSpan: 2, rowSpan: 1 }, occupied);
		expect(found, `expected a free rect, got ${JSON.stringify(found)}`).toEqual(rect(0, 1, 2, 1));
	});

	it('is deterministic: identical inputs always yield the identical rect', () => {
		const occupied: OccupiedRect[] = [
			{ panelId: 'a', rect: rect(0, 0, 3, 2) },
			{ panelId: 'b', rect: rect(3, 0, 3, 2) }
		];
		const size = { colSpan: 2, rowSpan: 2 };
		const first = findFreeRect(size, occupied);
		const second = findFreeRect(size, occupied);
		expect(second, 'expected identical replay result').toEqual(first);
	});

	it('never returns a rect that overlaps an occupied one', () => {
		const occupied: OccupiedRect[] = [{ panelId: 'a', rect: rect(0, 0, 4, 3) }];
		const found = findFreeRect({ colSpan: 2, rowSpan: 2 }, occupied);
		expect(found, 'expected a free rect').not.toBeNull();
		if (found !== null) {
			for (const o of occupied) {
				expect(
					rectsOverlap(found, o.rect),
					`${JSON.stringify(found)} overlaps ${JSON.stringify(o)}`
				).toBe(false);
			}
		}
	});

	it('returns null — never throws — when the 6x4 grid has no free rect of that size (T-1007-8 AC2)', () => {
		const occupied: OccupiedRect[] = [{ panelId: 'a', rect: rect(0, 0, GRID_COLUMNS, GRID_ROWS) }];
		expect(() => findFreeRect({ colSpan: 1, rowSpan: 1 }, occupied)).not.toThrow();
		const found = findFreeRect({ colSpan: 1, rowSpan: 1 }, occupied);
		expect(found, `expected null on a full grid, got ${JSON.stringify(found)}`).toBeNull();
	});

	it('returns null when the requested size itself exceeds the grid, never overflowing past GRID_ROWS', () => {
		const found = findFreeRect({ colSpan: 1, rowSpan: GRID_ROWS + 1 }, []);
		expect(
			found,
			`expected null for an oversized request, got ${JSON.stringify(found)}`
		).toBeNull();
	});
});

describe('applyLayout', () => {
	it('moves and resizes a batch together and returns the full resulting set', () => {
		const current: OccupiedRect[] = [
			{ panelId: 'a', rect: rect(0, 0, 2, 2) },
			{ panelId: 'b', rect: rect(2, 0, 2, 2) }
		];
		const placements: Placement[] = [
			{ panelId: 'a', rect: rect(0, 0, 3, 3), minSize: NO_MIN },
			{ panelId: 'b', rect: rect(3, 0, 3, 3), minSize: NO_MIN }
		];
		const result = applyLayout(current, placements);
		expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
		if (result.ok) {
			expect(result.rects).toHaveLength(2);
			expect(result.rects.find((r) => r.panelId === 'a')?.rect).toEqual(rect(0, 0, 3, 3));
			expect(result.rects.find((r) => r.panelId === 'b')?.rect).toEqual(rect(3, 0, 3, 3));
		}
	});

	it('leaves panels not named in the batch exactly where they were', () => {
		const current: OccupiedRect[] = [
			{ panelId: 'a', rect: rect(0, 0, 2, 2) },
			{ panelId: 'b', rect: rect(2, 2, 2, 2) }
		];
		const placements: Placement[] = [{ panelId: 'a', rect: rect(4, 0, 2, 2), minSize: NO_MIN }];
		const result = applyLayout(current, placements);
		expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
		if (result.ok) {
			expect(result.rects.find((r) => r.panelId === 'b')?.rect).toEqual(rect(2, 2, 2, 2));
		}
	});

	it('rejects the whole batch, and moves nothing, when one placement is below its minimum', () => {
		const current: OccupiedRect[] = [{ panelId: 'a', rect: rect(0, 0, 2, 2) }];
		const placements: Placement[] = [
			{ panelId: 'a', rect: rect(0, 0, 1, 1), minSize: { colSpan: 2, rowSpan: 2 } }
		];
		const result = applyLayout(current, placements);
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('below_minimum');
		}
	});

	it('rejects the whole batch when a placement is out of the 6x4 bounds', () => {
		const current: OccupiedRect[] = [{ panelId: 'a', rect: rect(0, 0, 2, 2) }];
		const placements: Placement[] = [
			{ panelId: 'a', rect: rect(0, 0, GRID_COLUMNS + 1, 1), minSize: NO_MIN }
		];
		const result = applyLayout(current, placements);
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('out_of_bounds');
		}
	});

	it('rejects a placement overlapping an unmoved panel, naming it', () => {
		const current: OccupiedRect[] = [
			{ panelId: 'a', rect: rect(0, 0, 2, 2) },
			{ panelId: 'b', rect: rect(2, 0, 2, 2) }
		];
		const placements: Placement[] = [{ panelId: 'a', rect: rect(1, 0, 2, 2), minSize: NO_MIN }];
		const result = applyLayout(current, placements);
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('overlap');
			if (result.violation.code === 'overlap') {
				expect(result.violation.occupiedBy).toBe('b');
			}
		}
	});

	it('rejects two colliding placements in the same batch, naming both panel ids', () => {
		const current: OccupiedRect[] = [
			{ panelId: 'a', rect: rect(0, 0, 2, 2) },
			{ panelId: 'b', rect: rect(2, 0, 2, 2) }
		];
		const placements: Placement[] = [
			{ panelId: 'a', rect: rect(4, 0, 2, 2), minSize: NO_MIN },
			{ panelId: 'b', rect: rect(4, 0, 2, 2), minSize: NO_MIN }
		];
		const result = applyLayout(current, placements);
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('batch_conflict');
			if (result.violation.code === 'batch_conflict') {
				expect(result.violation.panelIds).toEqual(['a', 'b']);
			}
		}
	});

	it('lets a panel swap into a cell vacated by another panel in the same batch', () => {
		const current: OccupiedRect[] = [
			{ panelId: 'a', rect: rect(0, 0, 2, 2) },
			{ panelId: 'b', rect: rect(2, 0, 2, 2) }
		];
		const placements: Placement[] = [
			{ panelId: 'a', rect: rect(2, 0, 2, 2), minSize: NO_MIN },
			{ panelId: 'b', rect: rect(0, 0, 2, 2), minSize: NO_MIN }
		];
		const result = applyLayout(current, placements);
		expect(result.ok, `expected ok for a swap, got ${JSON.stringify(result)}`).toBe(true);
	});
});

describe('splitRect', () => {
	it('splits vertically into left (original) and right (created) halves', () => {
		const result = splitRect({
			rect: rect(0, 0, 4, 2),
			direction: 'vertical',
			originalMinSize: NO_MIN,
			createdMinSize: NO_MIN
		});
		expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
		if (result.ok) {
			expect(result.original).toEqual(rect(0, 0, 2, 2));
			expect(result.created).toEqual(rect(2, 0, 2, 2));
			expect(rectsOverlap(result.original, result.created)).toBe(false);
		}
	});

	it('splits horizontally into top (original) and bottom (created) halves', () => {
		const result = splitRect({
			rect: rect(0, 0, 2, 4),
			direction: 'horizontal',
			originalMinSize: NO_MIN,
			createdMinSize: NO_MIN
		});
		expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
		if (result.ok) {
			expect(result.original).toEqual(rect(0, 0, 2, 2));
			expect(result.created).toEqual(rect(0, 2, 2, 2));
			expect(rectsOverlap(result.original, result.created)).toBe(false);
		}
	});

	it('rejects a split that leaves the original below its minimum', () => {
		const result = splitRect({
			rect: rect(0, 0, 2, 1),
			direction: 'vertical',
			originalMinSize: { colSpan: 2, rowSpan: 1 },
			createdMinSize: NO_MIN
		});
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('below_minimum');
		}
	});

	it('rejects a split that leaves the created panel below its minimum', () => {
		const result = splitRect({
			rect: rect(0, 0, 1, 2),
			direction: 'horizontal',
			originalMinSize: NO_MIN,
			createdMinSize: { colSpan: 1, rowSpan: 2 }
		});
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
		if (!result.ok) {
			expect(result.violation.code).toBe('below_minimum');
		}
	});

	it('rejects splitting a span of 1 without a separate zero-span guard being needed', () => {
		const result = splitRect({
			rect: rect(0, 0, 1, 3),
			direction: 'vertical',
			originalMinSize: { colSpan: 1, rowSpan: 1 },
			createdMinSize: { colSpan: 1, rowSpan: 1 }
		});
		expect(result.ok, `expected rejection, got ${JSON.stringify(result)}`).toBe(false);
	});
});

describe('fullGridRect (T-1007-8 AC5)', () => {
	it('spans the entire 6x4 grid', () => {
		expect(fullGridRect()).toEqual(rect(0, 0, GRID_COLUMNS, GRID_ROWS));
	});

	it('never overlaps nothing — is a valid placement candidate against an empty grid', () => {
		const result = validatePlacement({ rect: fullGridRect(), minSize: NO_MIN, occupied: [] });
		expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
	});
});
