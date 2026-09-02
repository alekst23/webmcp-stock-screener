// Conditional formatting (T-1010-1's FormattingRule) resolved to one cell's
// style, pure and side-effect free (AC4): a rule whose predicate does not
// match this row simply never contributes anything to any cell's style --
// there is no code path that touches a cell's style without a rule that
// actually matched it, which is what "a rule that matches no rows leaves
// the table unchanged" means operationally.
import type { ColumnValue } from '../domain/projection';
import type { FormattingComparator, FormattingRule } from '../domain/tableConfig';

export interface CellStyle {
	backgroundColor?: string;
	color?: string;
	icon?: string;
}

function compare(
	actual: ColumnValue,
	comparator: FormattingComparator,
	expected: unknown
): boolean {
	if (actual === null) {
		return false;
	}
	switch (comparator) {
		case 'eq':
			return actual === expected;
		case 'ne':
			return actual !== expected;
		case 'lt':
			return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
		case 'lte':
			return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
		case 'gt':
			return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
		case 'gte':
			return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
	}
}

// Rules are applied in configured order; a later matching rule's declared
// style fields override an earlier match's for the same property, matching
// the natural reading of "these rules apply to this cell" rather than only
// ever honoring the first match.
export function resolveCellStyle(
	columnValues: Readonly<Record<string, ColumnValue>>,
	columnId: string,
	rules: readonly FormattingRule[]
): CellStyle {
	let style: CellStyle = {};
	for (const rule of rules) {
		if (rule.predicate.columnId !== columnId) {
			continue;
		}
		const actual = columnValues[columnId] ?? null;
		if (!compare(actual, rule.predicate.comparator, rule.predicate.value)) {
			continue;
		}
		style = {
			...style,
			...(rule.style.backgroundColor !== undefined
				? { backgroundColor: rule.style.backgroundColor }
				: {}),
			...(rule.style.textColor !== undefined ? { color: rule.style.textColor } : {}),
			...(rule.style.icon !== undefined ? { icon: rule.style.icon } : {})
		};
	}
	return style;
}
