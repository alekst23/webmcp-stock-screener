<script lang="ts">
	import type { WorkspaceState } from '../webmcp/types';

	let { state }: { state: WorkspaceState } = $props();
</script>

<section>
	<h2>Studies ({state.studies.length})</h2>
	{#if state.studies.length === 0}
		<p class="empty">No studies defined yet.</p>
	{:else}
		<ul>
			{#each state.studies as study (study.id)}
				<li><code>{study.id}</code> — <strong>{study.name}</strong>: {study.expression}</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h2>Setups ({state.setups.length})</h2>
	{#if state.setups.length === 0}
		<p class="empty">No setups defined yet.</p>
	{:else}
		<ul>
			{#each state.setups as setup (setup.id)}
				<li>
					<code>{setup.id}</code> — {setup.name ?? '(unnamed)'}
					<ol>
						{#each setup.steps as step, i (i)}
							<li>
								{step.condition}
								{#if step.within}within [{step.within[0]}, {step.within[1]}] days{/if}
								{#if step.sustained}(sustained){/if}
							</li>
						{/each}
					</ol>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h2>Instance sets ({state.instanceSets.length})</h2>
	{#if state.instanceSets.length === 0}
		<p class="empty">No instance sets yet.</p>
	{:else}
		<ul>
			{#each state.instanceSets as set (set.id)}
				<li>
					<code>{set.id}</code> — {set.count} instances of <code>{set.setupId}</code>
					({set.from} – {set.to})
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h2>Panels ({state.panels.length})</h2>
	{#if state.panels.length === 0}
		<p class="empty">No panels open yet.</p>
	{:else}
		<ul>
			{#each state.panels as panel (panel.id + ':' + panel.instanceSetId)}
				<li>
					<code>{panel.id}</code> — {panel.kind}{#if panel.instanceSetId}
						over <code>{panel.instanceSetId}</code>{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h2>Focus</h2>
	{#if state.focus === null}
		<p class="empty">Nothing focused.</p>
	{:else}
		<p>
			Panel <code>{state.focus.panelId}</code>, {state.focus.selected.length} selected instance(s)
		</p>
		{#if state.focus.selected.length > 0}
			<ul>
				{#each state.focus.selected as instance (instance.ticker + instance.date)}
					<li>{instance.ticker} — {instance.date}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<style>
	section {
		margin-bottom: var(--space-lg);
		padding: var(--space-md);
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	h2 {
		margin: 0 0 var(--space-xs);
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}
	.empty {
		margin: 0;
		color: var(--text-muted);
		font-style: italic;
	}
	code {
		font-size: 0.85em;
		color: var(--accent);
	}
</style>
