import { describe, expect, it } from 'vitest';
import { resolveDropCell } from './dropGeometry';

const BOUNDS = { left: 0, top: 0, width: 600, height: 400 };

describe('resolveDropCell', () => {
	it('resolves the top-left cell for a point near the origin', () => {
		expect(resolveDropCell({ clientX: 10, clientY: 10 }, BOUNDS, 6, 4)).toEqual({ col: 0, row: 0 });
	});

	it('resolves the bottom-right cell for a point near the far corner', () => {
		expect(resolveDropCell({ clientX: 599, clientY: 399 }, BOUNDS, 6, 4)).toEqual({
			col: 5,
			row: 3
		});
	});

	it('resolves an interior cell proportionally', () => {
		// 600/6 = 100px per column, 400/4 = 100px per row -- (250, 150) is
		// column 2, row 1.
		expect(resolveDropCell({ clientX: 250, clientY: 150 }, BOUNDS, 6, 4)).toEqual({
			col: 2,
			row: 1
		});
	});

	it('accounts for a non-zero container offset', () => {
		const offsetBounds = { left: 50, top: 20, width: 600, height: 400 };
		expect(resolveDropCell({ clientX: 60, clientY: 30 }, offsetBounds, 6, 4)).toEqual({
			col: 0,
			row: 0
		});
	});

	it('returns null for a point outside the container bounds', () => {
		expect(resolveDropCell({ clientX: -5, clientY: 10 }, BOUNDS, 6, 4)).toBeNull();
		expect(resolveDropCell({ clientX: 10, clientY: 500 }, BOUNDS, 6, 4)).toBeNull();
	});

	it('returns null for a zero-sized container', () => {
		expect(resolveDropCell({ clientX: 10, clientY: 10 }, { ...BOUNDS, width: 0 }, 6, 4)).toBeNull();
	});
});
