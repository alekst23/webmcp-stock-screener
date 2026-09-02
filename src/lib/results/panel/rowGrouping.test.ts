import { describe, expect, it } from 'vitest';
import { groupRowsByAdjacentValue } from './rowGrouping';
import type { ProjectedRow } from '../domain/projection';

function row(rank: number, groupValue: ProjectedRow['groupValue']): ProjectedRow {
	return {
		resultId: `result_run_1_${rank}`,
		instrumentId: `inst_${rank}`,
		ticker: null,
		rank,
		compositeScore: null,
		columns: {},
		groupValue
	};
}

describe('groupRowsByAdjacentValue', () => {
	it('groups contiguous rows sharing the same group value', () => {
		const rows = [row(1, 'tech'), row(2, 'tech'), row(3, 'finance')];
		const groups = groupRowsByAdjacentValue(rows);
		expect(groups.map((g) => g.groupValue)).toEqual(['tech', 'finance']);
		expect(groups[0]?.rows.map((r) => r.rank)).toEqual([1, 2]);
		expect(groups[1]?.rows.map((r) => r.rank)).toEqual([3]);
	});

	it('never re-sorts rows -- a repeated group value that is not contiguous forms a second group', () => {
		// Sort key and group key disagree, so 'tech' legitimately reappears
		// non-adjacently; this must NOT be silently merged into one group,
		// since that would mean re-sorting rows out of the configured order.
		const rows = [row(1, 'tech'), row(2, 'finance'), row(3, 'tech')];
		const groups = groupRowsByAdjacentValue(rows);
		expect(groups.map((g) => g.groupValue)).toEqual(['tech', 'finance', 'tech']);
		expect(groups.map((g) => g.rows.map((r) => r.rank))).toEqual([[1], [2], [3]]);
		// Row order itself, flattened back out, must equal the input order.
		expect(groups.flatMap((g) => g.rows.map((r) => r.rank))).toEqual([1, 2, 3]);
	});

	it('handles an empty row set', () => {
		expect(groupRowsByAdjacentValue([])).toEqual([]);
	});

	it('treats every row as its own group when nothing is grouped (groupValue always null)', () => {
		const rows = [row(1, null), row(2, null)];
		const groups = groupRowsByAdjacentValue(rows);
		// null === null, so this is intentionally ONE group of two rows: a
		// caller that isn't grouping at all (config.grouping === null) is
		// expected to suppress the group-header UI itself, not rely on this
		// function to produce one group per row.
		expect(groups.length).toBe(1);
		expect(groups[0]?.rows.map((r) => r.rank)).toEqual([1, 2]);
	});
});
