<script lang="ts">
	// One result row: a selection checkbox, the configured columns (each
	// formatted and conditionally styled), and an explain affordance every
	// visible row carries (AC9). Selection goes through the same
	// setPanelSelection use case the agent uses -- this component only
	// reports "this row was toggled," it never mutates anything itself
	// (see ResultsTablePanel.svelte's toggleRow).
	import type { ProjectedRow } from '../domain/projection';
	import type { FormattingRule } from '../domain/tableConfig';
	import type { RenderColumn } from './defaultColumns';
	import { formatColumnValue } from './formatColumnValue';
	import { resolveCellStyle } from './cellFormatting';

	let {
		row,
		columns,
		formattingRules,
		selected,
		onToggle,
		onExplain
	}: {
		row: ProjectedRow;
		columns: RenderColumn[];
		formattingRules: readonly FormattingRule[];
		selected: boolean;
		onToggle: (resultId: string) => void;
		onExplain: (instrumentId: string) => void;
	} = $props();
</script>

<tr class="row" class:selected>
	<td class="select-cell">
		<input
			type="checkbox"
			checked={selected}
			aria-label={`Select ${row.ticker ?? row.instrumentId}`}
			onchange={() => onToggle(row.resultId)}
		/>
	</td>
	{#each columns as column (column.id)}
		{@const style = resolveCellStyle(row.columns, column.id, formattingRules)}
		<td style:background-color={style.backgroundColor} style:color={style.color}>
			{#if style.icon}<span class="icon">{style.icon}</span>{/if}
			{formatColumnValue(column.accessor(row), column.unit)}
		</td>
	{/each}
	<td class="explain-cell">
		<button type="button" class="control explain" onclick={() => onExplain(row.instrumentId)}>
			Explain
		</button>
	</td>
</tr>

<style>
	.row.selected {
		background: var(--bg-hover);
	}

	td {
		padding: var(--space-xs) var(--space-sm);
		border-bottom: 1px solid var(--separator);
		font-variant-numeric: tabular-nums;
	}

	.select-cell {
		width: 1%;
	}

	.explain-cell {
		width: 1%;
		white-space: nowrap;
	}

	.icon {
		margin-right: var(--space-xs);
	}

	.explain {
		font-size: var(--font-size-xs);
		padding: var(--space-xs);
	}
</style>
