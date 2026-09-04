<script lang="ts">
	// Renders the grid (T-1007-6 AC1, AC4; T-1007-8 AC4). Contains no
	// knowledge of any specific panel kind or renderer (AC2) -- it only reads
	// `panel.kind` as an opaque string to look up a registry entry, and hands
	// the resolved kind definition down to PanelFrame. Rendering derives
	// entirely from a fresh readSnapshot() on every observer notification, so
	// an agent-driven tool call and a human click on the collapse affordance
	// take the exact same re-render path (AC5).
	import { onMount, untrack } from 'svelte';
	import { containerGridStyle, emptyCellBorderStyle, panelFrameStyle } from './gridStyle';
	import {
		propagateLinkedValue,
		readSnapshot,
		removePanelByHuman,
		togglePanelCollapsed,
		type LinkedValues,
		type PanelSnapshot,
		type PanelWorkspaceObserver
	} from './panelController';
	import { computeEmptyCells } from '../domain/layout';
	import type { PanelToolDeps } from '../tools/panelTools';
	import type { PanelLinkChannel } from '../domain/channels';
	import PanelFrame from './PanelFrame.svelte';

	let {
		deps,
		observer
	}: {
		deps: PanelToolDeps;
		observer: PanelWorkspaceObserver;
	} = $props();

	// `deps` never changes identity for a mounted container -- captured once,
	// explicitly opted out of reactive tracking, and refreshed imperatively by
	// refresh() thereafter rather than left to a $derived recomputation.
	let snapshot = $state<PanelSnapshot>(untrack(() => readSnapshot(deps, deps.maximized.get())));
	// Client-render state only, scoped to this mounted container -- never a
	// workspace mutation (AC6; see propagateLinkedValue's own comment).
	let linkedValues = $state<LinkedValues>({});
	// The empty-grid illustration (hotfix/empty-grid-canvas): recomputed from
	// the same occupied rects the panel frames render from, so it always
	// matches current occupancy with no stale outlines left behind.
	let emptyCells = $derived(computeEmptyCells(snapshot.rects));

	function refresh(): void {
		snapshot = readSnapshot(deps, deps.maximized.get());
	}

	onMount(() => observer.subscribe(refresh));

	function handleToggleCollapse(panelId: string, collapsed: boolean): void {
		togglePanelCollapsed(deps, panelId, collapsed);
		refresh();
	}

	function handleRemove(panelId: string): void {
		removePanelByHuman(deps, panelId);
		refresh();
	}

	// Returns whether the broadcast actually reached anyone (bug fix, see git
	// history): propagateLinkedValue's `targets` used to be discarded here, so
	// a placeholder body broadcasting on a channel with zero linked panels
	// looked identical to a successful send -- the input cleared either way.
	function handleBroadcast(sourcePanelId: string) {
		return (channel: PanelLinkChannel, value: string): boolean => {
			const { next, targets } = propagateLinkedValue(
				snapshot.state.links,
				channel,
				sourcePanelId,
				value,
				linkedValues
			);
			linkedValues = next;
			return targets.length > 0;
		};
	}
</script>

<div class="panel-container" style={containerGridStyle()}>
	{#each snapshot.rects as occupied (occupied.panelId)}
		{@const panel = snapshot.state.panels.find((p) => p.id === occupied.panelId)}
		{#if panel}
			<PanelFrame
				{panel}
				rect={occupied.rect}
				kindDefinition={deps.kinds.get(panel.kind)}
				linkedValue={linkedValues[panel.id]}
				onToggleCollapse={handleToggleCollapse}
				onRemove={handleRemove}
				onBroadcast={handleBroadcast(panel.id)}
			/>
		{/if}
	{/each}
	{#each emptyCells as cell (`${cell.col},${cell.row}`)}
		<div
			class="empty-cell"
			style={`${panelFrameStyle(cell)} ${emptyCellBorderStyle()} pointer-events: none;`}
			data-testid="empty-cell"
		></div>
	{/each}
</div>

<style>
	.panel-container {
		position: fixed;
		inset: 0;
		background: var(--bg-app);
	}

	.empty-cell {
		pointer-events: none;
	}
</style>
