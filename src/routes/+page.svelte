<script module lang="ts">
	// T-1015-3: module-scoped, not component-scoped -- mirrors
	// /workbench/+page.svelte's own compositionGuard (T-0020-9). This
	// survives across remounts of this route module (SPA back/forward
	// navigation without a full reload, a future in-app link back to '/'),
	// so a second mount reuses the first mount's composition instead of
	// silently building a second, orphaned one.
	import { createWorkbenchCompositionGuard } from '$lib/workbench/composition/workbenchCompositionGuard';

	const compositionGuard = createWorkbenchCompositionGuard();
</script>

<script lang="ts">
	// T-1015-3: the main route migrated off the legacy workspace model
	// (workspace/store.ts, workspace/apiEngine.ts, webmcp/tools.ts) onto the
	// same panel/workspace composition root EPIC-0020 wired for /workbench --
	// registerWorkbenchComposition(), reused here rather than a second
	// composition (AC1, AC8).
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import type { PanelShellRuntime } from '$lib/panels/shell/registerPanelTools';
	import PanelContainer from '$lib/panels/shell/PanelContainer.svelte';
	import { resolveApiBaseUrl } from '$lib/workspace/apiConfig';
	import {
		fetchPanelStatus,
		formatFreshness,
		formatPanelStatus,
		type PanelStatus
	} from '$lib/workspace/panelStatus';
	import { connectNewSurfaceBridge } from '$lib/webmcp/newSurfaceSession';
	import {
		formatAgentToolsContext,
		formatAvailableStatus,
		formatBridgeStatus,
		formatDefinedStatus,
		type WebmcpBridgeState,
		type WebmcpStatus
	} from '$lib/webmcp/status';

	const apiConfig = { baseUrl: resolveApiBaseUrl(env.PUBLIC_API_BASE_URL) };

	// The composed panel/workspace runtime PanelContainer needs. Null until
	// the composition guard's promise settles (AC1) -- there is no partial
	// state to render before then, same as /workbench's own page.
	let runtime = $state<PanelShellRuntime | null>(null);

	// AC2: the status header's two counts and bridge state, now fed by the
	// new tool surface's own document.modelContext.getTools() rather than
	// the legacy buildTools(engine) list -- see newSurfaceSession.ts for why
	// session.ts/register.ts (built around per-tool progressive availability,
	// a confirmed structural drop for this surface) could not be reused
	// as-is. There is no separate "available" count left to track once
	// connected: every flag-enabled tool group registers unconditionally in
	// one pass, so "defined" and "available" agree the moment the bridge
	// reports connected.
	let webmcpStatus = $state<WebmcpStatus | null>(null);
	let bridgeState = $state<WebmcpBridgeState>('connecting');
	let availableCount = $derived(bridgeState === 'connected' ? (webmcpStatus?.toolCount ?? 0) : 0);
	let availableNames = $derived(bridgeState === 'connected' ? (webmcpStatus?.toolNames ?? []) : []);

	// T-0001-9 AC4: how current the backend's price panel is. Independent of
	// the panel/workspace composition -- a plain backend freshness fetch, not
	// legacy workspace state (parity matrix: "Backend address resolution...
	// Match, exact, shared code").
	let panelStatus = $state<PanelStatus | null>(null);
	let freshness = $derived(formatFreshness(panelStatus));

	onMount(() => {
		fetchPanelStatus(apiConfig)
			.then((status) => (panelStatus = status))
			.catch(() => (panelStatus = null));

		connectNewSurfaceBridge(
			() => compositionGuard.ensure(),
			(state) => (bridgeState = state)
		).then(({ result, status }) => {
			runtime = result;
			webmcpStatus = status;
		});
	});

	// Same dismiss-on-outside-click/Escape affordance the legacy header used
	// for its two tool-name disclosures -- purely DOM-local, no workspace
	// state involved.
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
			menu.querySelector<HTMLElement>('summary')?.focus();
		}
	}
</script>

<svelte:window onpointerdown={dismissToolMenus} onkeydown={dismissToolMenusOnEscape} />

<svelte:head>
	<title>MarketPane</title>
</svelte:head>

<div class="page">
	<header class="status-bar">
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
					<summary>{formatAvailableStatus(availableCount)}</summary>
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
	</header>

	<div class="panel-viewport">
		{#if runtime}
			<PanelContainer deps={runtime.deps} observer={runtime.observer} />
		{:else}
			<p class="loading">Preparing workspace…</p>
		{/if}
	</div>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		background: var(--bg-app);
	}

	/* Sticky, matching the legacy header's own treatment: identity and
	   session status stay in view while panels below scroll. */
	.status-bar {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm) var(--space-lg);
		min-height: 2.75rem;
		padding: var(--space-xs) var(--space-lg);
		background: var(--bg-panel);
		border-bottom: 1px solid var(--border);
	}

	/* `contain: layout` makes this box the containing block for
	   PanelContainer's own `position: fixed; inset: 0` (the escape hatch
	   that lets /workbench render it with no shell at all) -- so the panel
	   grid fills this region instead of the true viewport, without any
	   change to PanelContainer.svelte itself. */
	.panel-viewport {
		position: relative;
		flex: 1;
		min-height: 0;
		contain: layout;
	}

	.loading {
		padding: var(--space-lg);
		color: var(--text-muted);
		font-style: italic;
	}

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
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.bridge.degraded {
		color: var(--degraded);
		background: var(--degraded-bg);
		border: 1px solid var(--degraded);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-xs);
	}

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

	.freshness-pill.stale {
		color: var(--warning);
		border-color: var(--warning);
	}

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
