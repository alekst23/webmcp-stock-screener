<script lang="ts">
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { workspaceStore } from '$lib/workspace/store';
	import { activityStore, clearActivity } from '$lib/workspace/activity';
	import { createApiEngine, type InstanceWindowView } from '$lib/workspace/apiEngine';
	import { connectWebmcp } from '$lib/webmcp/register';
	import { buildTools } from '$lib/webmcp/tools';
	import { buildWebmcpStatus, formatWebmcpStatus, type WebmcpStatus } from '$lib/webmcp/status';
	import GridPanel from '$lib/workspace/GridPanel.svelte';
	import FocusChart from '$lib/workspace/FocusChart.svelte';
	import ActivityFeed from '$lib/workspace/ActivityFeed.svelte';
	import ChartToolbar from '$lib/workspace/ChartToolbar.svelte';
	import SnapshotPicker from '$lib/workspace/SnapshotPicker.svelte';

	const apiConfig = { baseUrl: env.PUBLIC_API_BASE_URL ?? 'http://localhost:8000' };

	// The real fetch-based ResearchEngine (T-1001-5), the same one an agent's
	// WebMCP tool calls resolve against -- registered here so a real
	// WebMCP-capable browser sees the live tool surface on this page.
	const engine = createApiEngine(workspaceStore, apiConfig);

	// The instance selected from a grid cell (AC2), rendered as the larger
	// detail chart below. Holds the already-fetched InstanceWindowView, not
	// just a (ticker, date) -- there's no backend request that fetches a
	// single named instance's window on its own (see FocusChart.svelte).
	let focusedView = $state<InstanceWindowView | null>(null);

	// Static full tool surface (AC3) -- independent of feature #10's
	// progressive availability, which only affects what's registered.
	let webmcpStatus = $state<WebmcpStatus | null>(null);

	onMount(() => {
		webmcpStatus = buildWebmcpStatus(buildTools(engine));
		void connectWebmcp(engine, activityStore);
	});
</script>

<main>
	<h1>WebMCP Pattern Research Workbench</h1>
	{#if webmcpStatus}
		<p class="webmcp-status">{formatWebmcpStatus(webmcpStatus)}</p>
		<ul class="webmcp-tool-names">
			{#each webmcpStatus.toolNames as toolName (toolName)}
				<li>{toolName}</li>
			{/each}
		</ul>
	{/if}
	<p>
		This is the shared research session — the same workspace state an agent reads and writes through
		WebMCP tools. It persists in this browser across reloads.
		<a href="/dev">Dev control surface →</a>
	</p>

	<SnapshotPicker store={workspaceStore} onload={() => (focusedView = null)} />

	<ChartToolbar {engine} activity={activityStore} onclear={() => (focusedView = null)} />

	{#each $workspaceStore.panels as panel (panel.id + ':' + panel.instanceSetId)}
		{#if panel.kind === 'grid'}
			<GridPanel
				{panel}
				{engine}
				config={apiConfig}
				store={workspaceStore}
				onselect={(view) => (focusedView = view)}
			/>
		{/if}
	{/each}

	{#if focusedView && $workspaceStore.focus?.selected.length}
		<FocusChart view={focusedView} />
	{/if}

	<ActivityFeed events={$activityStore} onclear={() => clearActivity(activityStore)} />
</main>

<style>
	main {
		max-width: 720px;
		margin: 2rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
	}

	.webmcp-status {
		font-size: 0.9rem;
		color: #555;
		margin-bottom: 0.25rem;
	}

	.webmcp-tool-names {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		font-size: 0.75rem;
		color: #555;
	}

	.webmcp-tool-names li {
		padding: 0.1rem 0.4rem;
		border: 1px solid #ddd;
		border-radius: 3px;
		background: #f6f6f6;
	}
</style>
