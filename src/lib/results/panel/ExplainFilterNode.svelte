<script lang="ts">
	// AC9: one node of the filter-tree explanation, recursing into its own
	// children for a group -- the AND/OR/NOT structure is legible because it
	// is rendered as literal nesting, not flattened into a list. Renders the
	// fields T-1010-3/T-1010-5 already derived (restatement, operatorLabel,
	// actualValue, outcome) verbatim rather than re-deriving a condition's
	// threshold text here.
	import type { ConditionOutcome, FilterNodeExplanation } from '../domain/explanation';
	// Self-import: Svelte 5's supported way to write a recursive component
	// (<svelte:self> is deprecated).
	import ExplainFilterNode from './ExplainFilterNode.svelte';

	let { node }: { node: FilterNodeExplanation } = $props();

	function outcomeLabel(outcome: ConditionOutcome | null): string {
		if (!node.enabled) return 'disabled';
		if (!outcome) return 'unknown';
		if (outcome.status === 'indeterminate') return `indeterminate (${outcome.reason})`;
		return outcome.status;
	}

	function outcomeClass(outcome: ConditionOutcome | null): string {
		if (!node.enabled) return 'disabled';
		if (!outcome) return 'disabled';
		return outcome.status;
	}

	function groupLabel(op: string): string {
		return op.toUpperCase();
	}
</script>

{#if node.kind === 'condition'}
	<li class="node condition">
		<div class="line">
			<span class="outcome {outcomeClass(node.outcome)}">{outcomeLabel(node.outcome)}</span>
			<span class="restatement">{node.restatement}</span>
		</div>
		{#if node.actualValue}
			<div class="actual">
				Actual: {node.actualValue.value}{node.actualValue.unit ? ` ${node.actualValue.unit}` : ''}
			</div>
		{/if}
	</li>
{:else}
	<li class="node group">
		<div class="line">
			<span class="outcome {outcomeClass(node.outcome)}">{outcomeLabel(node.outcome)}</span>
			<span class="op">{groupLabel(node.op)}</span>
		</div>
		<ul class="children">
			{#each node.children as child (child.nodeId)}
				<ExplainFilterNode node={child} />
			{/each}
		</ul>
		{#if node.truncatedChildCount}
			<div class="truncated">+{node.truncatedChildCount} more condition(s) not shown</div>
		{/if}
	</li>
{/if}

<style>
	.node {
		margin: var(--space-xs) 0;
	}

	.line {
		display: flex;
		align-items: baseline;
		gap: var(--space-sm);
	}

	.outcome {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		padding: 0 var(--space-xs);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
	}

	.outcome.pass {
		color: var(--actor-agent);
		border-color: var(--actor-agent);
	}

	.outcome.fail {
		color: var(--error);
		border-color: var(--error);
	}

	.outcome.indeterminate {
		color: var(--warning);
		border-color: var(--warning);
	}

	.outcome.disabled {
		color: var(--text-muted);
	}

	.op {
		font-weight: 600;
		color: var(--text-primary);
	}

	.restatement {
		color: var(--text-secondary);
	}

	.actual {
		margin-left: calc(var(--space-sm) * 4);
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}

	.children {
		list-style: none;
		margin: var(--space-xs) 0 0;
		padding-left: var(--space-lg);
		border-left: 1px solid var(--border);
	}

	.truncated {
		margin-left: var(--space-lg);
		color: var(--text-muted);
		font-style: italic;
		font-size: var(--font-size-sm);
	}
</style>
