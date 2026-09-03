<script module lang="ts">
	// T-1015-3: module-scoped, not component-scoped -- originally mirrored
	// the interim /workbench route's own compositionGuard (T-0020-9);
	// T-1015-9 retired that route (AC3), so this is now the only guard.
	// Surviving across remounts of this route module (SPA back/forward
	// navigation without a full reload, a future in-app link back to '/')
	// means a second mount reuses the first mount's composition instead of
	// silently building a second, orphaned one.
	import { env } from '$env/dynamic/public';
	import { resolveApiBaseUrl } from '$lib/workspace/apiConfig';
	import { createWorkbenchCompositionGuard } from '$lib/workbench/composition/workbenchCompositionGuard';
	import { registerWorkbenchComposition } from '$lib/workbench/composition/workbenchCompositionRoot';

	// Resolved once, at module scope, so every mount (and the chart tool
	// group's own composition below) agrees on which backend the app talks
	// to -- $env/dynamic/public is populated server-side and does not change
	// between mounts of this route module.
	const apiBaseUrl = resolveApiBaseUrl(env.PUBLIC_API_BASE_URL);

	// Bug fix (see git history): registerWorkbenchComposition() used to be
	// called with no arguments, so the chart tool group's own HTTP bars port
	// always pointed at DEV_API_BASE_URL regardless of the deployed
	// PUBLIC_API_BASE_URL -- this closure is what threads the real,
	// resolved backend address into it, the same address fetchPanelStatus
	// below already uses.
	const compositionGuard = createWorkbenchCompositionGuard(() =>
		registerWorkbenchComposition({ chartBaseUrl: apiBaseUrl })
	);
</script>

<script lang="ts">
	// T-1015-3: the main route migrated off the legacy workspace model
	// (workspace/store.ts, workspace/apiEngine.ts, webmcp/tools.ts) onto the
	// same panel/workspace composition root EPIC-0020 originally wired for
	// the interim /workbench route -- registerWorkbenchComposition(), reused
	// here rather than a second composition (AC1, AC8). T-1015-9 retired
	// /workbench (AC3), so this is now that composition's only call site.
	//
	// T-1015-9 AC2: the header markup that used to live inline here moved
	// into WorkbenchShell.svelte, a genuinely new component (AC1) -- this
	// route now only owns data fetching/bridge wiring and wraps
	// PanelContainer in that shell.
	import { onMount } from 'svelte';
	import type { PanelShellRuntime } from '$lib/panels/shell/registerPanelTools';
	import PanelContainer from '$lib/panels/shell/PanelContainer.svelte';
	import WorkbenchShell from '$lib/panels/shell/WorkbenchShell.svelte';
	import { fetchPanelStatus, type PanelStatus } from '$lib/workspace/panelStatus';
	import { connectNewSurfaceBridge } from '$lib/webmcp/newSurfaceSession';
	import type { WebmcpBridgeState, WebmcpStatus } from '$lib/webmcp/status';

	const apiConfig = { baseUrl: apiBaseUrl };

	// The composed panel/workspace runtime PanelContainer needs. Null until
	// the composition guard's promise settles (AC1) -- there is no partial
	// state to render before then.
	let runtime = $state<PanelShellRuntime | null>(null);

	// AC2: the status header's two counts and bridge state, now fed by the
	// new tool surface's own document.modelContext.getTools() rather than
	// the legacy buildTools(engine) list -- see newSurfaceSession.ts for why
	// session.ts/register.ts (built around per-tool progressive availability,
	// a confirmed structural drop for this surface) could not be reused
	// as-is. There is no separate "available" count left to track once
	// connected: every flag-enabled tool group registers unconditionally in
	// one pass, so "defined" and "available" agree the moment the bridge
	// reports connected. WorkbenchShell derives the two counts from these.
	let webmcpStatus = $state<WebmcpStatus | null>(null);
	let bridgeState = $state<WebmcpBridgeState>('connecting');

	// T-0001-9 AC4: how current the backend's price panel is. Independent of
	// the panel/workspace composition -- a plain backend freshness fetch, not
	// legacy workspace state (parity matrix: "Backend address resolution...
	// Match, exact, shared code").
	let panelStatus = $state<PanelStatus | null>(null);

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
</script>

<svelte:head>
	<title>MarketPane</title>
</svelte:head>

<WorkbenchShell
	{panelStatus}
	{webmcpStatus}
	{bridgeState}
	historyDeps={runtime
		? { history: runtime.deps.history, workspaceId: runtime.deps.workspaceId }
		: null}
	observer={runtime?.observer ?? null}
>
	<div class="panel-viewport">
		{#if runtime}
			<PanelContainer deps={runtime.deps} observer={runtime.observer} />
		{:else}
			<p class="loading">Preparing workspace…</p>
		{/if}
	</div>
</WorkbenchShell>

<style>
	/* `contain: layout` makes this box the containing block for
	   PanelContainer's own `position: fixed; inset: 0` -- so the panel grid
	   fills this region below the shell's header instead of the true
	   viewport, without any change to PanelContainer.svelte itself (AC5). */
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
</style>
