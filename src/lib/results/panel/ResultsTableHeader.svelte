<script lang="ts">
	// AC2: column headers show each configured column's own label and unit,
	// in the configured order -- this component never reorders or relabels
	// what it's handed.
	import type { ColumnIdentity, SortSpec } from '../domain/tableConfig';
	import type { RenderColumn } from './defaultColumns';

	let { columns, sort }: { columns: RenderColumn[]; sort: SortSpec | null } = $props();

	function isSortedBy(columnId: string, key: ColumnIdentity | undefined): boolean {
		if (!key) {
			return false;
		}
		// The only identity a RenderColumn.id can be compared against
		// directly is a catalog_field/computed_column id -- result_id has no
		// matching RenderColumn (it backs the default Rank column via its own
		// synthetic id), so it never matches here, which is correct: there is
		// nothing to mark as sorted in that case.
		return (
			(key.source === 'catalog_field' && key.fieldId === columnId) ||
			(key.source === 'computed_column' && key.computedColumnId === columnId)
		);
	}
</script>

<tr class="header-row">
	<th class="select-cell" aria-label="Select"></th>
	{#each columns as column (column.id)}
		<th>
			{column.label}{#if column.unit}
				<span class="unit">({column.unit})</span>
			{/if}
			{#if sort && isSortedBy(column.id, sort.key)}
				<span
					class="sort-indicator"
					aria-label={sort.direction === 'asc' ? 'ascending' : 'descending'}
				>
					{sort.direction === 'asc' ? '▲' : '▼'}
				</span>
			{/if}
		</th>
	{/each}
	<th class="explain-cell" aria-label="Explain"></th>
</tr>

<style>
	.header-row th {
		text-align: left;
		padding: var(--space-xs) var(--space-sm);
		border-bottom: 1px solid var(--border-strong);
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		white-space: nowrap;
	}

	.unit {
		color: var(--text-muted);
		text-transform: none;
		letter-spacing: normal;
	}

	.sort-indicator {
		color: var(--accent);
	}
</style>
