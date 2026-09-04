<script lang="ts">
	// One panel's chrome: title, collapse affordance, and the body slot with
	// per-frame loading and error states (T-1007-6 AC3, AC9). Thin wiring --
	// the resolution logic it calls lives in panelController.ts.
	import type { Component } from 'svelte';
	import type { GridRect } from '../domain/grid';
	import type { Panel } from '../domain/panel';
	import type { PanelKindDefinition } from '../registry/panelKindRegistry';
	import type { PanelLinkChannel } from '../domain/channels';
	import { panelFrameStyle } from './gridStyle';
	import {
		resolvePanelBody,
		type LinkedValueEntry,
		type PanelBodyProps,
		type ResolvedPanelBody
	} from './panelController';
	import PlaceholderPanelBody from './PlaceholderPanelBody.svelte';

	let {
		panel,
		rect,
		kindDefinition,
		linkedValue,
		onToggleCollapse,
		onRemove,
		onBroadcast
	}: {
		panel: Panel;
		rect: GridRect;
		kindDefinition: PanelKindDefinition | undefined;
		linkedValue?: LinkedValueEntry;
		onToggleCollapse: (panelId: string, collapsed: boolean) => void;
		onRemove: (panelId: string) => void;
		onBroadcast: (channel: PanelLinkChannel, value: string) => boolean;
	} = $props();

	type BodyLoadState = ResolvedPanelBody | { kind: 'loading' };

	let bodyState = $state<BodyLoadState>({ kind: 'loading' });
	// <svelte:boundary> catches a throw during the body's own render/mount
	// (a real, sibling-epic-supplied component); resolvePanelBody's own
	// try/catch (below) covers a throw or rejection while *loading* it. Either
	// way the failure is contained to this frame -- neither blanks the page.
	let renderError = $state<string | null>(null);

	$effect(() => {
		const definition = kindDefinition;
		bodyState = { kind: 'loading' };
		if (!definition) {
			bodyState = { kind: 'error', message: `Unknown panel kind "${panel.kind}".` };
			return;
		}
		let cancelled = false;
		resolvePanelBody(definition).then((result) => {
			if (!cancelled) {
				bodyState = result;
			}
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<section
	class="panel-frame panel-card"
	style={panelFrameStyle(rect)}
	data-panel-id={panel.id}
	data-panel-kind={panel.kind}
>
	<header class="panel-header">
		<h3>{panel.title}</h3>
		<div class="controls">
			<button
				type="button"
				class="control collapse"
				aria-expanded={!panel.collapsed}
				aria-label={panel.collapsed ? `Expand ${panel.title}` : `Collapse ${panel.title}`}
				onclick={() => onToggleCollapse(panel.id, !panel.collapsed)}
			>
				{panel.collapsed ? '▸' : '▾'}
			</button>
			<button
				type="button"
				class="control remove"
				aria-label={`Close ${panel.title}`}
				onclick={() => onRemove(panel.id)}
			>
				✕
			</button>
		</div>
	</header>

	{#if !panel.collapsed}
		<div class="panel-body">
			{#if renderError}
				<p class="error">Panel failed to render: {renderError}</p>
			{:else}
				<svelte:boundary
					onerror={(e) => (renderError = e instanceof Error ? e.message : String(e))}
				>
					{#if bodyState.kind === 'loading'}
						<p class="empty">Loading…</p>
					{:else if bodyState.kind === 'error'}
						<p class="error">{bodyState.message}</p>
					{:else if bodyState.kind === 'component'}
						{@const Body = bodyState.component as unknown as Component<PanelBodyProps>}
						<Body {panel} {linkedValue} {onBroadcast} />
					{:else if kindDefinition}
						<PlaceholderPanelBody {panel} {kindDefinition} {linkedValue} {onBroadcast} />
					{/if}
				</svelte:boundary>
			{/if}
		</div>
	{/if}
</section>

<style>
	.panel-frame {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		padding: var(--space-sm);
		overflow: hidden;
	}

	.panel-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-sm);
		padding-bottom: var(--space-xs);
		margin-bottom: var(--space-xs);
		border-bottom: 1px solid var(--separator);
		flex: 0 0 auto;
	}

	h3 {
		margin: 0;
		font-size: var(--font-size-sm);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		flex: 0 0 auto;
	}

	.collapse,
	.remove {
		flex: 0 0 auto;
		line-height: 1;
		padding: 0 var(--space-xs);
	}

	.panel-body {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
	}

	.empty {
		color: var(--text-muted);
		font-style: italic;
	}

	.error {
		color: var(--error);
		background: var(--error-bg);
		border: 1px solid var(--error);
		border-radius: var(--radius-sm);
		padding: var(--space-xs) var(--space-sm);
	}
</style>
