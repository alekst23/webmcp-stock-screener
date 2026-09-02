<script lang="ts">
	// The fallback body for every EPIC-1007 placeholder kind (T-1007-6 AC2,
	// AC9; T-1007-9 AC2's "no screener run yet" empty state). A sibling epic
	// that registers a real component for its kind never reaches this file --
	// PanelFrame only mounts it when resolvePanelBody reports 'placeholder'.
	//
	// This component is deliberately generic across all eight kinds -- it
	// reads only the fields every PanelKindDefinition has (kind, renderer,
	// linkChannels, bindingTypes) plus the panel's own source/config, never
	// branching on a specific kind name. That genericity is what lets the
	// container stay kind-agnostic while still letting "the receiving panel's
	// kind decide how to apply a linked value" (AC6): every placeholder kind
	// decides the same way -- display what arrived -- until a sibling epic
	// gives its kind a real, kind-specific body.
	import { untrack } from 'svelte';
	import type { Panel } from '../domain/panel';
	import type { PanelKindDefinition } from '../registry/panelKindRegistry';
	import type { PanelLinkChannel } from '../domain/channels';
	import type { LinkedValueEntry } from './panelController';

	let {
		panel,
		kindDefinition,
		linkedValue,
		onBroadcast
	}: {
		panel: Panel;
		kindDefinition: PanelKindDefinition;
		linkedValue?: LinkedValueEntry;
		onBroadcast: (channel: PanelLinkChannel, value: string) => void;
	} = $props();

	// The draft form's starting channel is seeded once from the panel's kind
	// and edited locally thereafter -- not meant to track kindDefinition
	// (which does not change for a mounted panel anyway).
	let draftChannel = $state<PanelLinkChannel | null>(
		untrack(() => kindDefinition.linkChannels[0] ?? null)
	);
	let draftValue = $state('');

	function submitBroadcast(): void {
		if (draftChannel === null || draftValue.trim() === '') {
			return;
		}
		onBroadcast(draftChannel, draftValue);
		draftValue = '';
	}
</script>

<div class="placeholder-body">
	<dl>
		<dt>Kind</dt>
		<dd><code>{panel.kind}</code></dd>
		<dt>Renderer</dt>
		<dd>{panel.renderer ?? 'none yet'}</dd>
		<dt>Source</dt>
		<dd>
			{#if panel.source}
				bound to <code>{panel.source.type}</code>
			{:else if kindDefinition.bindingTypes.length > 0}
				no screener run yet — bind a source to see data here
			{:else}
				this panel kind is not data-bound
			{/if}
		</dd>
	</dl>

	{#if linkedValue}
		<p class="linked">
			received on <code>{linkedValue.channel}</code>: <strong>{String(linkedValue.value)}</strong>
		</p>
	{/if}

	{#if kindDefinition.linkChannels.length > 0}
		<form class="broadcast" onsubmit={(e) => (e.preventDefault(), submitBroadcast())}>
			<select class="field" bind:value={draftChannel} aria-label="Channel">
				{#each kindDefinition.linkChannels as channel (channel)}
					<option value={channel}>{channel}</option>
				{/each}
			</select>
			<input class="field" type="text" placeholder="value" bind:value={draftValue} />
			<button type="submit" class="control">Broadcast</button>
		</form>
	{/if}
</div>

<style>
	.placeholder-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		height: 100%;
		overflow: auto;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-xs) var(--space-sm);
		margin: 0;
	}

	dt {
		color: var(--text-muted);
		text-transform: uppercase;
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
	}

	dd {
		margin: 0;
	}

	.linked {
		margin: 0;
		padding: var(--space-xs) var(--space-sm);
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.broadcast {
		display: flex;
		gap: var(--space-xs);
		margin-top: auto;
	}

	.broadcast .field {
		min-width: 0;
		flex: 1;
	}
</style>
