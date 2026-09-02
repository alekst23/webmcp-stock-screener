// Plain-language description of what changed between two already-accepted
// results-table configurations (T-1010-6, AC2). Pure domain function: no I/O,
// no catalog lookup -- both configs are already-normalized ResultsTableConfig
// values (validateResultsTableConfig's `ok` arm), so display labels already
// live on the columns/computed columns themselves.
import type { ColumnIdentity, ResultsTableConfig, SortSpec } from './tableConfig';

function sameIdentity(a: ColumnIdentity, b: ColumnIdentity): boolean {
	if (a.source !== b.source) {
		return false;
	}
	if (a.source === 'catalog_field' && b.source === 'catalog_field') {
		return a.fieldId === b.fieldId;
	}
	if (a.source === 'computed_column' && b.source === 'computed_column') {
		return a.computedColumnId === b.computedColumnId;
	}
	return true; // both 'result_id'
}

function identityKey(identity: ColumnIdentity): string {
	if (identity.source === 'catalog_field') return `catalog_field:${identity.fieldId}`;
	if (identity.source === 'computed_column') return `computed_column:${identity.computedColumnId}`;
	return 'result_id';
}

// Prefers the label of a currently-displayed column sharing this identity --
// what a person actually sees -- falling back to a description of the
// identity itself for a sort/grouping key that isn't (also) a display column.
function describeIdentity(
	identity: ColumnIdentity,
	columns: ResultsTableConfig['columns']
): string {
	const shown = columns.find((c) => sameIdentity(c.identity, identity));
	if (shown) {
		return `"${shown.label}"`;
	}
	if (identity.source === 'catalog_field') return `field "${identity.fieldId}"`;
	if (identity.source === 'computed_column')
		return `computed column "${identity.computedColumnId}"`;
	return 'the result id';
}

function describeColumnChanges(previous: ResultsTableConfig, next: ResultsTableConfig): string[] {
	const previousKeys = new Set(previous.columns.map((c) => identityKey(c.identity)));
	const nextKeys = new Set(next.columns.map((c) => identityKey(c.identity)));
	const added = next.columns.filter((c) => !previousKeys.has(identityKey(c.identity)));
	const removed = previous.columns.filter((c) => !nextKeys.has(identityKey(c.identity)));

	const parts: string[] = [];
	if (added.length > 0) {
		parts.push(
			`added column${added.length > 1 ? 's' : ''} ${added.map((c) => `"${c.label}"`).join(', ')}`
		);
	}
	if (removed.length > 0) {
		parts.push(
			`removed column${removed.length > 1 ? 's' : ''} ${removed.map((c) => `"${c.label}"`).join(', ')}`
		);
	}
	return parts;
}

function sameSort(a: SortSpec | null, b: SortSpec | null): boolean {
	if (a === null || b === null) {
		return a === b;
	}
	return sameIdentity(a.key, b.key) && a.direction === b.direction;
}

function describeSortChange(previous: ResultsTableConfig, next: ResultsTableConfig): string | null {
	if (sameSort(previous.sort, next.sort)) {
		return null;
	}
	if (next.sort === null) {
		return 'cleared the sort';
	}
	return `sorted by ${describeIdentity(next.sort.key, next.columns)} (${next.sort.direction})`;
}

function describeGroupingChange(
	previous: ResultsTableConfig,
	next: ResultsTableConfig
): string | null {
	const prevKey = previous.grouping ? identityKey(previous.grouping.key) : null;
	const nextKey = next.grouping ? identityKey(next.grouping.key) : null;
	if (prevKey === nextKey) {
		return null;
	}
	if (next.grouping === null) {
		return 'cleared grouping';
	}
	return `grouped by ${describeIdentity(next.grouping.key, next.columns)}`;
}

function describeCountChange(previous: number, next: number, noun: string): string | null {
	if (previous === next) {
		return null;
	}
	return `${noun} changed from ${previous} to ${next}`;
}

export function describeResultsTableConfigChange(
	previous: ResultsTableConfig,
	next: ResultsTableConfig
): string {
	const parts: string[] = [...describeColumnChanges(previous, next)];

	const sortChange = describeSortChange(previous, next);
	if (sortChange) parts.push(sortChange);

	const groupingChange = describeGroupingChange(previous, next);
	if (groupingChange) parts.push(groupingChange);

	if (previous.pageSize !== next.pageSize) {
		parts.push(`page size changed to ${next.pageSize ?? 'the default'}`);
	}

	const computedChange = describeCountChange(
		previous.computedColumns.length,
		next.computedColumns.length,
		'computed columns'
	);
	if (computedChange) parts.push(computedChange);

	const formattingChange = describeCountChange(
		previous.formattingRules.length,
		next.formattingRules.length,
		'formatting rules'
	);
	if (formattingChange) parts.push(formattingChange);

	if (previous.chartPanelId !== next.chartPanelId) {
		parts.push(
			next.chartPanelId
				? `linked to chart panel "${next.chartPanelId}"`
				: 'unlinked from its chart panel'
		);
	}

	return parts.length > 0 ? parts.join('; ') : 'no changes to the table configuration';
}
