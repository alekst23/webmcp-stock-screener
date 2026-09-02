import { describe, expect, it } from 'vitest';
import type { Normalization } from '../domain/instrument';
import { normalizeSeries, projectComparison, resolveAnchorIndex } from './chartNormalization';

const PRIMARY = [100, 110, 120, 90];
// A tenth of the primary's price: on a raw axis this is a flat line along the
// bottom, which is the whole reason normalization exists.
const COMPARISON = [10, 12, 11, 9];

function normalization(
	mode: Normalization['mode'],
	anchor: Normalization['anchor']
): Normalization {
	return { mode, anchor };
}

// Rebasing is a division followed by a multiplication, so an exact deep-equal
// on the result would be asserting IEEE-754 rounding rather than the ratio.
function expectSeriesCloseTo(
	actual: readonly (number | null)[],
	expected: (number | null)[]
): void {
	expect(actual).toHaveLength(expected.length);
	expected.forEach((value, index) => {
		if (value === null) {
			expect(actual[index]).toBeNull();
			return;
		}
		expect(actual[index]).toBeCloseTo(value, 9);
	});
}

describe('normalizeSeries', () => {
	it('leaves the values alone under mode none', () => {
		expect(normalizeSeries(COMPARISON, 'none', 0)).toEqual(COMPARISON);
	});

	it('states percent_change as the move away from the anchor', () => {
		expectSeriesCloseTo(normalizeSeries(COMPARISON, 'percent_change', 0), [0, 20, 10, -10]);
	});

	it('states indexed_100 with the anchor at 100', () => {
		expectSeriesCloseTo(normalizeSeries(COMPARISON, 'indexed_100', 0), [100, 120, 110, 90]);
	});

	it('standardizes to zero mean and unit deviation under z_score', () => {
		const zs = normalizeSeries(COMPARISON, 'z_score', 0) as number[];
		const mean = zs.reduce((total, z) => total + z, 0) / zs.length;
		expect(mean).toBeCloseTo(0, 10);
		expect(Math.max(...zs)).toBeGreaterThan(0);
		expect(Math.min(...zs)).toBeLessThan(0);
	});

	it('rebases from the named anchor bar rather than always the first', () => {
		expectSeriesCloseTo(normalizeSeries(COMPARISON, 'indexed_100', 1), [
			(10 / 12) * 100,
			100,
			(11 / 12) * 100,
			75
		]);
	});

	it('skips past a warm-up hole at the anchor instead of nulling everything', () => {
		expect(normalizeSeries([null, 20, 40], 'indexed_100', 0)).toEqual([null, 100, 200]);
	});

	it('standardizes a flat series to zero rather than dividing by no spread', () => {
		expect(normalizeSeries([5, 5, 5], 'z_score', 0)).toEqual([0, 0, 0]);
	});

	it('yields nothing to draw when no usable anchor exists', () => {
		expect(normalizeSeries([null, null], 'percent_change', 0)).toEqual([null, null]);
	});
});

describe('resolveAnchorIndex', () => {
	it('uses the first bar for a window_start anchor', () => {
		expect(resolveAnchorIndex(normalization('indexed_100', 'window_start'), 3)).toBe(0);
	});

	it('uses the nominated bar for an anchor_bar anchor', () => {
		expect(resolveAnchorIndex(normalization('indexed_100', 'anchor_bar'), 3)).toBe(3);
	});

	it('falls back to the first bar when anchor_bar names none', () => {
		expect(resolveAnchorIndex(normalization('indexed_100', 'anchor_bar'))).toBe(0);
	});
});

describe('projectComparison', () => {
	it('overlays raw prices under mode none, as asked', () => {
		const projected = projectComparison(PRIMARY, COMPARISON, normalization('none', 'window_start'));
		expect(projected.values).toEqual(COMPARISON);
		expect(projected.unitLabel).toBe('price');
	});

	it('rebases a cheaper instrument onto the primary price axis', () => {
		const projected = projectComparison(
			PRIMARY,
			COMPARISON,
			normalization('percent_change', 'window_start')
		);
		// The comparison starts at the primary's own anchor price, and moves by
		// its own percentages from there: +20%, +10%, -10%.
		expectSeriesCloseTo(projected.values, [100, 120, 110, 90]);
	});

	it('draws the same curve for percent_change and indexed_100 but labels them apart', () => {
		const percent = projectComparison(
			PRIMARY,
			COMPARISON,
			normalization('percent_change', 'window_start')
		);
		const indexed = projectComparison(
			PRIMARY,
			COMPARISON,
			normalization('indexed_100', 'window_start')
		);
		expect(indexed.values).toEqual(percent.values);
		expect(indexed.unitLabel).not.toBe(percent.unitLabel);
		expect(indexed.normalized).not.toEqual(percent.normalized);
	});

	it('puts a z_score comparison in the primary series own spread', () => {
		const projected = projectComparison(
			PRIMARY,
			COMPARISON,
			normalization('z_score', 'window_start')
		);
		const values = projected.values as number[];
		const min = Math.min(...PRIMARY);
		const max = Math.max(...PRIMARY);
		// It lands in the primary's own neighbourhood rather than down at $10.
		for (const value of values) {
			expect(value).toBeGreaterThan(min - (max - min));
			expect(value).toBeLessThan(max + (max - min));
		}
	});

	it('rebases from the nominated anchor bar', () => {
		const projected = projectComparison(
			PRIMARY,
			COMPARISON,
			normalization('indexed_100', 'anchor_bar'),
			1
		);
		expect(projected.anchorIndex).toBe(1);
		// Both series pinned at bar 1: the comparison sits on the primary there.
		expect(projected.values[1]).toBeCloseTo(PRIMARY[1]!, 10);
	});

	it('leaves a hole where the comparison has no bar', () => {
		const projected = projectComparison(
			PRIMARY,
			[10, null, 11, 9],
			normalization('indexed_100', 'window_start')
		);
		expect(projected.values[1]).toBeNull();
		expect(projected.values[2]).not.toBeNull();
	});

	it('draws nothing when the comparison has no usable anchor', () => {
		const projected = projectComparison(
			PRIMARY,
			[null, null, null, null],
			normalization('percent_change', 'window_start')
		);
		expect(projected.values).toEqual([null, null, null, null]);
	});
});
