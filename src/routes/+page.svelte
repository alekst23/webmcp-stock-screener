<script lang="ts">
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { workspaceStore } from '$lib/workspace/store';
	import { createApiEngine } from '$lib/workspace/apiEngine';
	import { connectWebmcp } from '$lib/webmcp/register';
	import WorkspaceView from '$lib/workspace/WorkspaceView.svelte';

	// The real fetch-based ResearchEngine (T-1001-5), the same one an agent's
	// WebMCP tool calls resolve against -- registered here so a real
	// WebMCP-capable browser sees the live tool surface on this page.
	const engine = createApiEngine(workspaceStore, {
		baseUrl: env.PUBLIC_API_BASE_URL ?? 'http://localhost:8000'
	});

	onMount(() => {
		void connectWebmcp(engine);
	});
</script>

<main>
	<h1>WebMCP Pattern Research Workbench</h1>
	<p>
		This is the shared research session — the same workspace state an agent reads and writes through
		WebMCP tools. It persists in this browser across reloads.
		<a href="/dev">Dev control surface →</a>
	</p>
	<WorkspaceView state={$workspaceStore} />
</main>

<style>
	main {
		max-width: 720px;
		margin: 2rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
	}
</style>
