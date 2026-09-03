<script lang="ts">
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { workspaceStore } from '$lib/workspace/store';
	import { activityStore, clearActivity } from '$lib/workspace/activity';
	import { createApiEngine, type InstanceWindowView } from '$lib/workspace/apiEngine';
	import { resolveApiBaseUrl } from '$lib/workspace/apiConfig';
	import {
		fetchPanelStatus,
		formatFreshness,
		formatPanelStatus,
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

	const apiConfig = { baseUrl: resolveApiBaseUrl(env.PUBLIC_API_BASE_URL) };

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

	// No header search control on this page: ticker/universe selection is a
	// WebMCP tool-only action here, so an agent can't be bypassed by a human
	// typing directly into a text box. ChartToolbar's "Show monthly" action
	// still reads this value; only the control that let a human write to it
	// is gone.
	let tickers = $state('MOCK02, MOCK03');

	// Derived rather than computed inline in the template ({@const} may only
	// sit directly inside a block/snippet, not a plain <div>) -- recomputes
	// whenever panelStatus changes, same as everything else the header reads
	// off it.
	let freshness = $derived(formatFreshness(panelStatus));

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

	// The tool lists are overlays (see the .tool-menu styles) and <details>
	// has no native dismissal, so without this an open list sits over the work
	// area and swallows the next click on a panel beneath it -- the only way
	// out would be clicking its own summary again.
	let statusBar = $state<HTMLElement | null>(null);

	function openToolMenus(): HTMLDetailsElement[] {
		return [...(statusBar?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? [])];
	}

	function dismissToolMenus(event: PointerEvent): void {
		for (const menu of openToolMenus()) {
			if (event.target instanceof Node && menu.contains(event.target)) {
				continue;
			}
			menu.open = false;
		}
	}

	function dismissToolMenusOnEscape(event: KeyboardEvent): void {
		if (event.key !== 'Escape') {
			return;
		}
		for (const menu of openToolMenus()) {
			menu.open = false;
			// Escape must not strand focus inside the list it just hid.
			menu.querySelector<HTMLElement>('summary')?.focus();
		}
	}
</script>

<svelte:window onpointerdown={dismissToolMenus} onkeydown={dismissToolMenusOnEscape} />

<AppShell>
	{#snippet topBar()}
		<div class="identity-group">
			<div class="identity">
				<span class="mark" aria-hidden="true"></span>
				<h1>MarketPane</h1>
				<span class="protocol">WebMCP</span>
			</div>
			<span
				class="freshness-pill"
				class:synthetic={freshness.state === 'synthetic'}
				class:stale={freshness.state === 'stale'}
				class:unknown={freshness.state === 'unknown'}
				title={panelStatus ? formatPanelStatus(panelStatus) : undefined}
			>
				{freshness.label}
			</span>
		</div>
		{#if webmcpStatus}
			<div class="webmcp-status" bind:this={statusBar}>
				<details class="tool-menu" name="tool-menu">
					<summary>{formatDefinedStatus(webmcpStatus)}</summary>
					<ul>
						{#each webmcpStatus.toolNames as name (name)}
							<li>{name}</li>
						{/each}
					</ul>
				</details>
				<details class="tool-menu" name="tool-menu">
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

	<SnapshotPicker store={workspaceStore} onload={() => (focusedView = null)} />

	<ChartToolbar {engine} activity={activityStore} {tickers} onclear={() => (focusedView = null)} />

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
	.identity-group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-sm) var(--space-md);
		min-width: 0;
	}

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
		letter-spacing: var(--tracking-label);
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
	   growing the top bar and shoving the whole page down. Both menus carry
	   the same `name`, so the browser keeps at most one open and they can
	   never occlude each other. */
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
		/* Above AppShell's sticky .top-bar (z-index 10): the list is anchored
		   inside that header, so anything lower is clipped behind it. */
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
		letter-spacing: var(--tracking-label);
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

	/* Replaces the permanent synthetic-data warning banner: the header's one
	   freshness/status indicator (docs/design/terminal-ui-theme/spec.md's
	   "Data-freshness pill"). Base treatment covers `fresh`; `unknown` and
	   the two disclosure states below override colour only. */
	.freshness-pill {
		display: inline-block;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		color: var(--text-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-xs);
		white-space: nowrap;
	}

	.freshness-pill.unknown {
		color: var(--text-muted);
	}

	/* A stale pull must not carry the same visual weight as a fresh one. */
	.freshness-pill.stale {
		color: var(--warning);
		border-color: var(--warning);
	}

	/* Synthetic data must not read like real market data at a glance -- the
	   disclosure the old permanent banner existed to make, now carried by
	   the pill instead. */
	.freshness-pill.synthetic {
		color: var(--synthetic);
		background: var(--synthetic-bg);
		border-color: var(--synthetic);
	}

	@media (max-width: 680px) {
		h1 {
			white-space: normal;
		}
	}
</style>
