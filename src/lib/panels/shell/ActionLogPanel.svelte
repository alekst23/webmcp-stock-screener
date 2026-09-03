<script lang="ts">
	// T-1015-10 AC3: the log view a compact header icon expands into. Purely
	// presentational -- WorkbenchShell.svelte owns the expand/collapse state
	// and calls panelController.ts's readActionLog() to populate `records`.
	// The actor badge is reimplemented inline rather than imported from
	// workspace/activity.ts's actorLabel: that module is a T-1015-6 deletion
	// target (see legacyModelRemoval.test.ts), not something new code should
	// depend on.
	import type { ChangeRecord } from '../../workbench/application/changeHistory';

	let { records }: { records: ChangeRecord[] } = $props();
</script>

<section class="action-log" aria-label="Action log">
	{#if records.length === 0}
		<p class="empty">No actions recorded yet.</p>
	{:else}
		<ol>
			{#each records as record (record.changeId)}
				<li>
					<time>{new Date(record.at).toLocaleTimeString()}</time>
					<span class="actor" class:actor-human={record.actor === 'human'}>
						{record.actor === 'human' ? 'Human' : 'Agent'}
					</span>
					<span class="summary">{record.diffSummary}</span>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.action-log {
		padding: var(--space-sm) var(--space-lg);
		background: var(--bg-panel);
		border-bottom: 1px solid var(--border);
	}

	.empty {
		margin: 0;
		color: var(--text-muted);
		font-style: italic;
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 220px;
		overflow-y: auto;
		background: var(--bg-app);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	li {
		padding: var(--space-xs) var(--space-sm);
		border-bottom: 1px solid var(--separator);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}

	li:last-child {
		border-bottom: none;
	}

	time {
		color: var(--text-muted);
		margin-right: var(--space-sm);
	}

	/* Actor colour, not actor background: matches the legacy activity feed's
	   own treatment (see workspace/ActivityFeed.svelte, retired). */
	.actor {
		display: inline-block;
		min-width: 3.5rem;
		margin-right: var(--space-xs);
		padding: 0.05rem var(--space-xs);
		border-radius: var(--radius-sm);
		font-family: var(--font-ui);
		font-size: var(--font-size-xs);
		font-weight: 600;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		text-align: center;
		color: var(--actor-agent);
		border: 1px solid var(--actor-agent);
		background: var(--bg-elevated);
	}

	.actor-human {
		color: var(--actor-human);
		border-color: var(--actor-human);
	}

	.summary {
		color: var(--text-primary);
	}
</style>
