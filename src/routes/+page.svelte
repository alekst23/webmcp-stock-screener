<script lang="ts">
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { workspaceStore } from '$lib/workspace/store';
	import { activityStore, clearActivity } from '$lib/workspace/activity';
	import { createApiEngine, type InstanceWindowView } from '$lib/workspace/apiEngine';
	import {
		fetchPanelStatus,
		formatPanelStatus,
		isMockPanel,
		type PanelStatus
	} from '$lib/workspace/panelStatus';
	import { startBridgeSession } from '$lib/webmcp/session';
	import { buildTools } from '$lib/webmcp/tools';
	import {
		buildWebmcpStatus,
		formatAgentToolsContext,
		formatAvailableStatus,
		formatBridgeStatus,
		formatDefinedStatus,
		type WebmcpBridgeState,
		type WebmcpStatus
	} from '$lib/webmcp/status';
	import GridPanel from '$lib/workspace/GridPanel.svelte';
	import FocusChart from '$lib/workspace/FocusChart.svelte';
	import ActivityFeed from '$lib/workspace/ActivityFeed.svelte';
	import ChartToolbar from '$lib/workspace/ChartToolbar.svelte';
	import SnapshotPicker from '$lib/workspace/SnapshotPicker.svelte';

	const apiConfig = { baseUrl: env.PUBLIC_API_BASE_URL ?? 'http://localhost:8000' };

	// The real fetch-based ResearchEngine (T-0001-5), the same one an agent's
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

	// Whether an agent can actually call any of them right now, and how many
	// are registered at this moment. Kept apart from webmcpStatus so the
	// defined count never has to stand in for callability.
	let bridgeState = $state<WebmcpBridgeState>('connecting');
	let availableNames = $state<string[]>([]);

	// How current the backend's price panel is (T-0001-9 AC4). Null while it
	// is being fetched, and left null when the backend has no panel at all --
	// claiming an unknown as-of date would be worse than showing none.
	let panelStatus = $state<PanelStatus | null>(null);

	onMount(() => {
		webmcpStatus = buildWebmcpStatus(buildTools(engine));

		fetchPanelStatus(apiConfig)
			.then((status) => (panelStatus = status))
			.catch(() => (panelStatus = null));

		// The bridge state machine lives in session.ts so it is testable without
		// mounting this component (hotfix/webmcp-bridge-status).
		return startBridgeSession(
			engine,
			activityStore,
			(state) => (bridgeState = state),
			(names) => (availableNames = names)
		);
	});
</script>

<main>
	<h1>WebMCP Pattern Research Workbench</h1>
	{#if webmcpStatus}
		<div class="webmcp-status">
			<details>
				<summary>{formatDefinedStatus(webmcpStatus)}</summary>
				<ul>
					{#each webmcpStatus.toolNames as name (name)}
						<li>{name}</li>
					{/each}
				</ul>
			</details>
			<details>
				<summary>{formatAvailableStatus(availableNames.length)}</summary>
				{#if availableNames.length}
					<ul>
						{#each availableNames as name (name)}
							<li>{name}</li>
						{/each}
					</ul>
				{:else}
					<p class="empty">No tools are registered for an agent to call right now.</p>
				{/if}
			</details>
			<span class="bridge" class:degraded={bridgeState === 'failed'}>
				{formatBridgeStatus(bridgeState)}
			</span>
		</div>
		{@html `<!-- ${formatAgentToolsContext(webmcpStatus, bridgeState)} -->`}
	{/if}
	{#if panelStatus}
		<p class="panel-status" class:synthetic={isMockPanel(panelStatus)}>
			{formatPanelStatus(panelStatus)}
		</p>
	{/if}
	<p>
		WebMCP Pattern Research Workbench lets a trader or researcher and an AI agent turn a vague chart
		pattern into a tested hypothesis together, in the same browser tab. They share one visible
		research session — defining patterns, searching price history, and measuring outcomes — that
		persists in this browser across reloads.
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
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 1rem;
		font-size: 0.9rem;
		color: #555;
	}

	.webmcp-status summary {
		cursor: pointer;
	}

	.webmcp-status ul {
		margin: 0.25rem 0 0;
		padding-left: 1.25rem;
		font-family: ui-monospace, monospace;
		font-size: 0.85rem;
	}

	.webmcp-status .empty {
		margin: 0.25rem 0 0;
		font-style: italic;
	}

	.panel-status {
		margin: 0.5rem 0 0;
		font-size: 0.9rem;
		color: #555;
	}

	/* Synthetic data must not read like real market data at a glance -- the
	   whole point of showing this line (T-0001-9 AC4). */
	.panel-status.synthetic {
		color: #7a5c00;
		background: #fdf8e6;
		border-radius: 0.2rem;
		padding: 0.2rem 0.35rem;
	}

	/* A degraded bridge must not read like a working one at a glance -- the
	   whole point of this line is that "defined" never implies "callable". */
	.bridge.degraded {
		color: #a33;
		background: #fdf0f0;
		border-radius: 0.2rem;
		padding: 0 0.35rem;
	}
</style>
