<script lang="ts">
	import type { AgentActivityEvent } from './activity';

	// AC4: every tool call an agent makes, visible to the human in call
	// order. Populated by register.ts's execute() wrapper -- see activity.ts.
	let { events }: { events: AgentActivityEvent[] } = $props();
</script>

<section class="activity-feed">
	<h2>Agent activity ({events.length})</h2>
	{#if events.length === 0}
		<p class="empty">No tool calls yet.</p>
	{:else}
		<ol>
			{#each events as event (event.id)}
				<li>
					<time>{new Date(event.timestamp).toLocaleTimeString()}</time>
					<strong>{event.toolName}</strong> — {event.summary}
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.activity-feed {
		margin-bottom: 1.5rem;
	}
	h2 {
		font-size: 1rem;
		margin-bottom: 0.25rem;
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
</style>
