<script lang="ts">
	import { actorLabel, type AgentActivityEvent } from './activity';

	// Unified action log (T-1002): every human UI action and agent tool call
	// appended through recordAction, in call order. Populated by
	// register.ts's execute() wrapper (actor: 'agent') and ChartToolbar.svelte
	// (actor: 'human') -- see activity.ts. No client-side sort needed: both
	// call sites append via the same recordAction, so array order already is
	// call order.
	let { events, onclear }: { events: AgentActivityEvent[]; onclear?: () => void } = $props();
</script>

<section class="activity-feed">
	<div class="header-row">
		<h2>Activity log ({events.length})</h2>
		<button type="button" onclick={onclear} disabled={events.length === 0}>Clear log</button>
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
		margin: 1rem 0 1.5rem;
		padding: 0.75rem 0;
		border-top: 1px solid #ddd;
		border-bottom: 1px solid #ddd;
	}
	.header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}
	h2 {
		font-size: 1rem;
		margin: 0;
	}
	.header-row button {
		border: 1px solid #999;
		border-radius: 4px;
		padding: 0.3rem 0.6rem;
		background: #fff;
		color: #111;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.header-row button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.empty {
		color: #888;
		font-style: italic;
	}
	ol {
		list-style: none;
		padding: 0;
		margin: 0;
		max-height: 220px;
		overflow-y: auto;
		border: 1px solid #ddd;
		border-radius: 4px;
	}
	li {
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid #eee;
		font-size: 0.85rem;
	}
	li:last-child {
		border-bottom: none;
	}
	time {
		color: #888;
		margin-right: 0.5rem;
		font-variant-numeric: tabular-nums;
	}
	.actor {
		display: inline-block;
		min-width: 3.5rem;
		margin-right: 0.4rem;
		padding: 0.05rem 0.35rem;
		border-radius: 3px;
		font-size: 0.75rem;
		font-weight: 600;
		text-align: center;
		color: #fff;
		background: #6b7280;
	}
	.actor-human {
		background: #2563eb;
	}
</style>
