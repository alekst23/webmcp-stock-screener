<script lang="ts">
	// T-1015-9 AC1: the new surface's own shell -- product identity, a
	// data-freshness indicator, and WebMCP status, following the same
	// dark/dense visual language docs/design/terminal-ui-theme/spec.md
	// established for the legacy header (src/lib/shell/AppShell.svelte). Not
	// a reuse of AppShell.svelte: this component owns its own markup and
	// styles rather than importing the legacy shell (AC1 explicitly rules
	// that out), because AppShell.svelte's three-region Snippet contract
	// (topBar/children/log) is shaped around the legacy page's
	// always-visible action log, not this surface's own compact,
	// expand-on-demand one (T-1015-10, added below).
	//
	// Markup and behavior here were lifted verbatim out of
	// src/routes/+page.svelte (T-1015-3's inline header) rather than
	// rewritten, so panel rendering underneath is unaffected (AC5) -- only
	// the header became an importable, independently testable component.
	//
	// T-1015-10 AC3: this shell also owns the action-log icon and its
	// expand/collapse state -- a compact affordance, not the legacy page's
	// always-visible log. `historyDeps`/`observer` are null until the
	// composition root's workspace runtime is ready (see +page.svelte), so
	// the icon stays disabled and the log stays empty until then.
	import type { Snippet } from 'svelte';
	import type { ChangeRecord } from '../../workbench/application/changeHistory';
	import {
		formatFreshness,
		formatPanelStatus,
		type PanelStatus
	} from '../../workspace/panelStatus';
	import {
		formatAgentToolsContext,
		formatAvailableStatus,
		formatBridgeStatus,
		formatDefinedStatus,
		type WebmcpBridgeState,
		type WebmcpStatus
	} from '../../webmcp/status';
	import { readActionLog, resetLayoutByHuman, type PanelWorkspaceObserver } from './panelController';
	import type { PanelUseCaseDeps } from '../application';
	import ActionLogPanel from './ActionLogPanel.svelte';

	let {
		panelStatus,
		webmcpStatus,
		bridgeState,
		historyDeps,
		resetLayoutDeps,
		observer,
		children
	}: {
		panelStatus: PanelStatus | null;
		webmcpStatus: WebmcpStatus | null;
		bridgeState: WebmcpBridgeState;
		historyDeps: Pick<PanelUseCaseDeps, 'history' | 'workspaceId'> | null;
		resetLayoutDeps: PanelUseCaseDeps | null;
		observer: PanelWorkspaceObserver | null;
		children: Snippet;
	} = $props();

	// AC1: no separate "available" count survives connection -- every
	// flag-enabled tool group registers unconditionally in one pass, so
	// "defined" and "available" agree the moment the bridge reports
	// connected (spec.md Open Question 4: progressive availability is a
	// confirmed drop for this surface).
	let availableCount = $derived(bridgeState === 'connected' ? (webmcpStatus?.toolCount ?? 0) : 0);
	let availableNames = $derived(bridgeState === 'connected' ? (webmcpStatus?.toolNames ?? []) : []);
	let freshness = $derived(formatFreshness(panelStatus));

	// Same dismiss-on-outside-click/Escape affordance the legacy header used
	// for its two tool-name disclosures -- purely DOM-local, scoped to this
	// component's own header now that it owns that markup.
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

	// T-1015-10 AC3: starts collapsed -- scoped down from the legacy page's
	// always-visible log, per the ticket's own direction.
	let logExpanded = $state(false);
	let logRecords = $state<ChangeRecord[]>([]);

	function refreshLog(): void {
		logRecords = historyDeps ? readActionLog(historyDeps) : [];
	}

	// Keeps the log current while it's open by re-reading on every workspace
	// mutation, agent- or human-triggered alike -- the same observer
	// PanelContainer already subscribes to for its own re-render.
	$effect(() => {
		if (!observer || !logExpanded) {
			return;
		}
		return observer.subscribe(refreshLog);
	});

	function toggleLog(): void {
		logExpanded = !logExpanded;
		if (logExpanded) {
			refreshLog();
		}
	}

	// spec.md "Reset the workspace layout to the default seed": a confirm
	// dialog gates the action (declined confirmation changes nothing), then
	// calls the same use case the agent-invokable reset_layout tool calls,
	// tagged actor: 'human' -- mirrors PanelContainer.svelte's handleRemove
	// (use case call + refresh) so the header updates immediately.
	function handleResetLayout(): void {
		if (!resetLayoutDeps) {
			return;
		}
		if (!window.confirm('Reset the workspace layout to its default arrangement?')) {
			return;
		}
		resetLayoutByHuman(resetLayoutDeps);
		observer?.notify();
	}
</script>

<svelte:window onpointerdown={dismissToolMenus} onkeydown={dismissToolMenusOnEscape} />

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
		<button
			type="button"
			class="log-toggle"
			aria-expanded={logExpanded}
			aria-label={logExpanded ? 'Hide action log' : 'Show action log'}
			disabled={!historyDeps}
			onclick={toggleLog}
		>
			Log
		</button>
		<button
			type="button"
			class="reset-layout"
			disabled={!resetLayoutDeps}
			onclick={handleResetLayout}
		>
			Reset
		</button>
	</header>

	{#if logExpanded}
		<ActionLogPanel records={logRecords} />
	{/if}

	{@render children()}
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

	.log-toggle {
		flex: 0 0 auto;
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		padding: var(--space-xs) var(--space-sm);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.log-toggle[aria-expanded='true'] {
		border-color: var(--border-strong);
		color: var(--text-primary);
	}

	.log-toggle:disabled {
		color: var(--text-muted);
		cursor: not-allowed;
	}

	.reset-layout {
		flex: 0 0 auto;
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		padding: var(--space-xs) var(--space-sm);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.reset-layout:disabled {
		color: var(--text-muted);
		cursor: not-allowed;
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
