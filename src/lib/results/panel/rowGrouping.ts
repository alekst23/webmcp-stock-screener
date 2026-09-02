// Renders configured grouping (AC3) as contiguous runs of equal groupValue
// in the page's already-sorted order, rather than re-sorting by group value
// -- projectResultRows (T-1010-4) sorts by the configured sort key, not
// necessarily the grouping key, and re-sorting here would silently violate
// AC2's "in the configured sort order." When sort and grouping keys agree
// (the expected configuration) this produces clean, non-repeating groups;
// when they don't, the same group value can legitimately reappear later on
// the page -- an honest reflection of the configuration, not a bug this
// module papers over.
import type { ColumnValue, ProjectedRow } from '../domain/projection';

export interface RowGroup {
	groupValue: ColumnValue;
	rows: ProjectedRow[];
}

export function groupRowsByAdjacentValue(rows: readonly ProjectedRow[]): RowGroup[] {
	const groups: RowGroup[] = [];
	for (const row of rows) {
		const last = groups[groups.length - 1];
		if (last && last.groupValue === row.groupValue) {
			last.rows.push(row);
		} else {
			groups.push({ groupValue: row.groupValue, rows: [row] });
		}
	}
	return groups;
}
