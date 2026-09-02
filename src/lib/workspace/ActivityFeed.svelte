<script lang="ts">
	import { actorLabel, type AgentActivityEvent } from './activity';

	// Unified action log (T-1002): every human UI action and agent tool call
	// appended through recordAction, in call order. Populated by
	// register.ts's execute() wrapper (actor: 'agent') and ChartToolbar.svelte
	// (actor: 'human') -- see activity.ts. No client-side sort needed: both
	// call sites append via the same recordAction, so array order already is
	// call order.
	let { events, onclear }: { events: AgentActivityEvent[]; onclear?: () => void } = $props();

	function clear(): void {
		if (confirm('Clear the entire activity log? This cannot be undone.')) {
			onclear?.();
		}
	}
</script>

<section class="activity-feed">
	<div class="header-row">
		<h2>Activity log ({events.length})</h2>
		<button type="button" onclick={clear} disabled={events.length === 0}>Clear log</button>
	</div>
	{#if events.length === 0}
		<p class="empty">No activity yet.</p>
	{:else}
		<ol>
			{#each events as event (event.id)}
				<li>
					<time>{new Date(event.timestamp).toLocaleTimeString()}</time>
					<span class="actor" class:actor-human={event.actor === 'human'}
						>{actorLabel(event.actor)}</span
					>
					<strong>{event.toolName}</strong> — {event.summary}
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.activity-feed {
		margin: 0;
	}
	.header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
		margin-bottom: var(--space-sm);
	}
	h2 {
		margin: 0;
		font-size: var(--font-size-xs);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-secondary);
	}
	.header-row button {
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-xs) var(--space-sm);
		background: var(--bg-elevated);
		color: var(--text-secondary);
		font: inherit;
		font-size: var(--font-size-xs);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		cursor: pointer;
		white-space: nowrap;
	}
	.header-row button:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
	.header-row button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.empty {
		margin: 0;
		color: var(--text-muted);
		font-style: italic;
	}
	ol {
		list-style: none;
		padding: 0;
		margin: 0;
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
	li strong {
		color: var(--text-primary);
	}
	time {
		color: var(--text-muted);
		margin-right: var(--space-sm);
	}
	/* Actor colour, not actor background: on a dark ground a tinted chip with
	   a coloured label reads at a glance without a white-on-saturated pairing
	   that would fall under the contrast floor. */
	.actor {
		display: inline-block;
		min-width: 3.5rem;
		margin-right: var(--space-xs);
		padding: 0.05rem var(--space-xs);
		border-radius: var(--radius-sm);
		font-family: var(--font-ui);
		font-size: var(--font-size-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
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
</style>
