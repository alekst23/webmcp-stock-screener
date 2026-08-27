<script lang="ts">
	import { workspaceStore } from '$lib/workspace/store';
	import WorkspaceView from '$lib/workspace/WorkspaceView.svelte';
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
