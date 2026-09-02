<script lang="ts">
	import { env } from '$env/dynamic/public';
	import { dev } from '$app/environment';
	import { workspaceStore } from '$lib/workspace/store';
	import { createApiEngine, type InstanceWindowView } from '$lib/workspace/apiEngine';
	import { buildTools } from '$lib/webmcp/tools';
	import GridPanel from '$lib/workspace/GridPanel.svelte';
	import FocusChart from '$lib/workspace/FocusChart.svelte';
	import WorkspaceView from '$lib/workspace/WorkspaceView.svelte';
	import type { ToolResult } from '$lib/webmcp/types';

	// Real fetch-based ResearchEngine (T-0001-5), wired to the FastAPI
	// backend. Lets a developer exercise the full tool surface without an AI
	// agent or a WebMCP-capable browser (AC3), against the same store the
	// human view reads from (AC4) and the same live backend an agent's tool
	// calls would hit.
	const engine = createApiEngine(workspaceStore, {
		baseUrl: env.PUBLIC_API_BASE_URL ?? 'http://localhost:8000'
	});
	const tools = buildTools(engine);

	let inputs = $state<Record<string, string>>(Object.fromEntries(tools.map((t) => [t.name, '{}'])));
	let results = $state<Record<string, { ok: boolean; text: string }>>({});
	let focusedView = $state<InstanceWindowView | null>(null);

	async function run(name: string): Promise<void> {
		const tool = tools.find((t) => t.name === name);
		if (!tool) {
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(inputs[name] ?? '{}');
		} catch (e) {
			results = {
				...results,
				[name]: { ok: false, text: `Invalid JSON: ${(e as Error).message}` }
			};
			return;
		}
		const result: ToolResult = await tool.execute(parsed);
		results = {
			...results,
			[name]: { ok: !result.isError, text: result.content.map((c) => c.text).join('\n') }
		};
	}
</script>

{#if !dev}
	<p>The dev control surface is only available in development builds.</p>
{:else}
	<main>
		<h1>Dev control surface</h1>
		<p>
			Call any tool from <code>buildTools()</code> directly, with arbitrary JSON input, against an
			in-memory placeholder engine — no agent or WebMCP-capable browser required. Availability
			follows the same workflow-unlock rules an agent sees (e.g. <code>measure</code> only appears once
			an instance set exists).
		</p>

		<section class="tools">
			{#each tools as tool (tool.name)}
				{@const isAvailable = tool.available($workspaceStore)}
				<article class="panel-card" class:disabled={!isAvailable}>
					<h3>
						{tool.name}{#if !isAvailable}
							(locked){/if}
					</h3>
					<p>{tool.description}</p>
					<textarea class="field" bind:value={inputs[tool.name]} rows="4" disabled={!isAvailable}
					></textarea>
					<button class="control" onclick={() => run(tool.name)} disabled={!isAvailable}>Run</button
					>
					{#if results[tool.name]}
						<!-- TS can't narrow an index access across two separate reads of
						     results[tool.name]; the `!` is safe under the #if guard above. -->
						{@const outcome = results[tool.name]!}
						<pre class:error={!outcome.ok}>{outcome.text}</pre>
					{/if}
				</article>
			{/each}
		</section>

		<h2>Current workspace state</h2>
		{#each $workspaceStore.panels as panel (panel.id + ':' + panel.instanceSetId)}
			{#if panel.kind === 'grid'}
				<GridPanel
					{panel}
					{engine}
					config={{ baseUrl: env.PUBLIC_API_BASE_URL ?? 'http://localhost:8000' }}
					store={workspaceStore}
					onselect={(view) => (focusedView = view)}
				/>
			{/if}
		{/each}
		{#if focusedView && $workspaceStore.focus?.selected.length}
			<FocusChart view={focusedView} />
		{/if}
		<WorkspaceView state={$workspaceStore} />
	</main>
{/if}

<style>
	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: var(--space-lg) var(--space-lg) var(--space-xl);
	}
	h1 {
		font-size: var(--font-size-xl);
		margin: 0 0 var(--space-sm);
	}
	h2 {
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
		margin: 0 0 var(--space-sm);
	}
	main > p {
		max-width: 72ch;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.tools {
		display: grid;
		gap: var(--space-md);
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		margin-bottom: var(--space-xl);
	}
	article h3 {
		margin: 0 0 var(--space-xs);
		font-family: var(--font-mono);
		font-size: var(--font-size-md);
		color: var(--accent);
	}
	article p {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	article.disabled {
		opacity: 0.5;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		margin: var(--space-sm) 0;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}
	button {
		font-size: var(--font-size-sm);
	}
	pre {
		white-space: pre-wrap;
		background: var(--bg-app);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		padding: var(--space-sm);
		font-size: 0.8em;
		margin: var(--space-sm) 0 0;
	}
	pre.error {
		background: var(--error-bg);
		border-color: var(--error);
		color: var(--error);
	}
</style>
