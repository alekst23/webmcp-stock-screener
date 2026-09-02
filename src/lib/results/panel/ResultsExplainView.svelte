<script lang="ts">
	// AC9: every visible row's "why" -- the filter tree with AND/OR/NOT
	// structure, and the ranking contribution breakdown. Branches on
	// explainResult's three-way outcome (a real explanation, an unavailable
	// run, or an instrument the run never evaluated) rather than assuming
	// success, matching this codebase's "no run" -> AC10-style message
	// convention used elsewhere in this panel.
	import type { ExplainResultOutcome } from '../application/explainResult';
	import ExplainFilterNode from './ExplainFilterNode.svelte';

	let { outcome, onClose }: { outcome: ExplainResultOutcome; onClose: () => void } = $props();

	function isRunNotAvailable(
		o: ExplainResultOutcome
	): o is Extract<ExplainResultOutcome, { available: false; reason: 'unknown' | 'evicted' }> {
		return 'available' in o && o.available === false && o.reason !== 'not_in_universe';
	}

	function isNotEvaluated(
		o: ExplainResultOutcome
	): o is Extract<ExplainResultOutcome, { reason: 'not_in_universe' }> {
		return 'reason' in o && o.reason === 'not_in_universe';
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="overlay">
	<!-- A real, keyboard-reachable button as the backdrop (not a click
	     handler on a non-interactive div) so closing by clicking outside the
	     dialog needs no extra keyboard-event wiring of its own; the dialog
	     itself sits above it and is never covered by anything the backdrop
	     button would intercept. -->
	<button type="button" class="backdrop" aria-label="Close explanation" onclick={onClose}></button>
	<div
		class="dialog panel-card"
		role="dialog"
		aria-modal="true"
		aria-label="Result explanation"
		tabindex="-1"
	>
		<div class="dialog-header">
			<h3>Explanation</h3>
			<button type="button" class="control" onclick={onClose} aria-label="Close">✕</button>
		</div>

		{#if isRunNotAvailable(outcome)}
			<p class="message">{outcome.message} Run the screener again to see current results.</p>
		{:else if isNotEvaluated(outcome)}
			<p class="message">{outcome.message}</p>
		{:else}
			<section>
				<h4>
					{outcome.standing.status === 'result' ? `Rank ${outcome.standing.rank}` : 'Rejected'}
				</h4>
				<ul class="tree">
					<ExplainFilterNode node={outcome.filterTree} />
				</ul>
			</section>

			{#if outcome.ranking}
				{@const ranking = outcome.ranking}
				<section>
					<h4>Ranking contribution</h4>
					<table class="ranking">
						<thead>
							<tr>
								<th>Field</th>
								<th>Raw</th>
								<th>Normalized</th>
								<th>Weight</th>
								<th>Contribution</th>
							</tr>
						</thead>
						<tbody>
							{#each ranking.fields as field (field.fieldId)}
								<tr>
									<td>{field.fieldId}</td>
									<td>{field.rawValue ?? '—'}</td>
									<td>{field.normalizedValue?.toFixed(3) ?? '—'}</td>
									<td>{field.weight}</td>
									<td>{field.contribution?.toFixed(4) ?? '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<p class="composite">Composite score: {ranking.compositeScore.toFixed(4)}</p>
					{#if ranking.truncatedFieldCount}
						<p class="truncated">
							+{ranking.truncatedFieldCount} more ranking field(s) not shown
						</p>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: var(--bg-app);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
	}

	.backdrop {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: none;
		padding: 0;
		/* Same ground as .overlay behind it -- this button IS the backdrop,
		   not a see-through layer above a separately-painted one. */
		background: var(--bg-app);
		cursor: default;
	}

	.dialog {
		position: relative;
		max-width: 40rem;
		max-height: 80vh;
		overflow: auto;
		width: 90%;
	}

	.dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-sm);
	}

	.dialog-header h3 {
		margin: 0;
	}

	h4 {
		margin: var(--space-md) 0 var(--space-xs);
	}

	.tree {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.message {
		color: var(--text-secondary);
	}

	.ranking {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sm);
	}

	.ranking th,
	.ranking td {
		text-align: left;
		padding: var(--space-xs) var(--space-sm);
		border-bottom: 1px solid var(--separator);
		font-variant-numeric: tabular-nums;
	}

	.composite {
		font-weight: 600;
		color: var(--text-primary);
	}

	.truncated {
		color: var(--text-muted);
		font-style: italic;
		font-size: var(--font-size-sm);
	}
</style>
