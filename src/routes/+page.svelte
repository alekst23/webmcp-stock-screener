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
	import AppShell from '$lib/shell/AppShell.svelte';
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

<AppShell>
	{#snippet topBar()}
		<div class="identity">
			<span class="mark" aria-hidden="true"></span>
			<h1>Pattern Research Workbench</h1>
			<span class="protocol">WebMCP</span>
		</div>
		{#if webmcpStatus}
			<div class="webmcp-status">
				<details class="tool-menu">
					<summary>{formatDefinedStatus(webmcpStatus)}</summary>
					<ul>
						{#each webmcpStatus.toolNames as name (name)}
							<li>{name}</li>
						{/each}
					</ul>
				</details>
				<details class="tool-menu">
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
	{/snippet}

	{#if panelStatus}
		<p class="panel-status" class:synthetic={isMockPanel(panelStatus)}>
			{formatPanelStatus(panelStatus)}
		</p>
	{/if}
	<p class="intro">
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

	{#snippet log()}
		<ActivityFeed events={$activityStore} onclear={() => clearActivity(activityStore)} />
	{/snippet}
</AppShell>

<style>
	.identity {
		display: flex;
		align-items: baseline;
		gap: var(--space-sm);
		min-width: 0;
	}

	.mark {
		align-self: center;
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 1px;
		background: var(--accent);
		box-shadow: 0 0 0 3px var(--bg-elevated);
	}

	h1 {
		margin: 0;
		font-size: var(--font-size-lg);
		white-space: nowrap;
	}

	.protocol {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-xs);
	}

	.webmcp-status {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-xs) var(--space-md);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}

	/* Anchored so opening a tool list overlays the work area instead of
	   growing the top bar and shoving the whole page down. */
	.tool-menu {
		position: relative;
	}

	.tool-menu summary {
		cursor: pointer;
		padding: var(--space-xs) var(--space-sm);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
		white-space: nowrap;
		user-select: none;
	}

	.tool-menu[open] summary {
		border-color: var(--border-strong);
		color: var(--text-primary);
	}

	.tool-menu ul,
	.tool-menu .empty {
		position: absolute;
		right: 0;
		top: calc(100% + var(--space-xs));
		z-index: 20;
		min-width: 14rem;
		max-height: 60vh;
		overflow-y: auto;
		margin: 0;
		padding: var(--space-sm) var(--space-sm) var(--space-sm) var(--space-lg);
		background: var(--bg-elevated);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}

	.tool-menu .empty {
		padding-left: var(--space-sm);
		font-family: var(--font-ui);
		font-style: italic;
		color: var(--text-muted);
	}

	.bridge {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
		white-space: nowrap;
	}

	/* A degraded bridge must not read like a working one at a glance -- the
	   whole point of this line is that "defined" never implies "callable". */
	.bridge.degraded {
		color: var(--degraded);
		background: var(--degraded-bg);
		border: 1px solid var(--degraded);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-xs);
	}

	.panel-status {
		margin: 0 0 var(--space-md);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--text-muted);
	}

	/* Synthetic data must not read like real market data at a glance -- the
	   whole point of showing this line (T-0001-9 AC4). */
	.panel-status.synthetic {
		display: inline-block;
		color: var(--synthetic);
		background: var(--synthetic-bg);
		border: 1px solid var(--synthetic);
		border-radius: var(--radius-sm);
		padding: var(--space-xs) var(--space-sm);
	}

	.intro {
		max-width: 62ch;
		margin: 0 0 var(--space-lg);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}

	@media (max-width: 680px) {
		h1 {
			white-space: normal;
		}
	}
</style>
