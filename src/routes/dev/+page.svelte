<script lang="ts">
	import { dev } from '$app/environment';
	import { workspaceStore } from '$lib/workspace/store';
	import { createDevEngine } from '$lib/workspace/devEngine';
	import { buildTools } from '$lib/webmcp/tools';
	import WorkspaceView from '$lib/workspace/WorkspaceView.svelte';
	import type { ToolResult } from '$lib/webmcp/types';

	// T-1001-5 will swap this placeholder engine for a real fetch-based
	// ResearchEngine wired to the FastAPI backend. Until then this lets a
	// developer exercise the full tool surface without an AI agent or a
	// WebMCP-capable browser (AC3), against the same store the human view
	// reads from (AC4).
	const engine = createDevEngine(workspaceStore);
	const tools = buildTools(engine);

	let inputs = $state<Record<string, string>>(Object.fromEntries(tools.map((t) => [t.name, '{}'])));
	let results = $state<Record<string, { ok: boolean; text: string }>>({});

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
				<article class:disabled={!isAvailable}>
					<h3>
						{tool.name}{#if !isAvailable}
							(locked){/if}
					</h3>
					<p>{tool.description}</p>
					<textarea bind:value={inputs[tool.name]} rows="4" disabled={!isAvailable}></textarea>
					<button onclick={() => run(tool.name)} disabled={!isAvailable}>Run</button>
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
		<WorkspaceView state={$workspaceStore} />
	</main>
{/if}

<style>
	main {
		max-width: 960px;
		margin: 2rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
	}
	.tools {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		margin-bottom: 2rem;
	}
	article {
		border: 1px solid #ccc;
		border-radius: 4px;
		padding: 0.75rem;
	}
	article.disabled {
		opacity: 0.5;
	}
	textarea {
		width: 100%;
		font-family: monospace;
		margin: 0.5rem 0;
		box-sizing: border-box;
	}
	pre {
		white-space: pre-wrap;
		background: #f5f5f5;
		padding: 0.5rem;
		font-size: 0.8em;
	}
	pre.error {
		background: #fee;
	}
</style>
