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
		bindPanelSourceFromDrop,
		createChartFromDrop,
		propagateLinkedValue,
		readSnapshot,
		removePanelByHuman,
		togglePanelCollapsed,
		type LinkedValues,
		type PanelSnapshot,
		type PanelWorkspaceObserver
	} from './panelController';
	import { resolveDropCell } from './dropGeometry';
	import { computeEmptyCells } from '../domain/layout';
	import { PanelOperationError } from '../application';
	import { PANEL_SOURCE_DRAG_MIME, parsePanelSourceDrag } from '../domain/dragSource';
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
	// The container element itself, not any one grid cell -- T-0027-2's drop
	// target, since the empty-cell outlines above are deliberately
	// pointer-events: none (they're an illustration, not a hit target; see
	// their own style below) and never receive a dragover/drop of their own.
	let containerEl = $state<HTMLDivElement | undefined>();

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

	// T-0027-2: which panel (if any) a drag point sits over, resolved by DOM
	// lookup on `data-panel-id` (PanelFrame.svelte's own root element) rather
	// than grid math -- a panel-frame's rendered box, not its logical rect,
	// is what the human sees themselves dropping onto, and covers its full
	// visual footprint (header, controls, body padding) with none of the
	// empty-cell outlines' pointer-events: none exclusion.
	function panelIdAt(target: EventTarget | null): string | null {
		if (!(target instanceof Element)) {
			return null;
		}
		return target.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId ?? null;
	}

	function acceptsInstrumentDrop(panelId: string): boolean {
		const panel = snapshot.state.panels.find((p) => p.id === panelId);
		const kindDefinition = panel ? deps.kinds.get(panel.kind) : undefined;
		return kindDefinition?.bindingTypes.includes('instrument') ?? false;
	}

	// Sets the drop cursor: 'copy' over an empty cell or a panel that accepts
	// an instrument source, 'none' (AC3's "shown as a not-allowed drop
	// target") over one that doesn't. Only ever inspects `bindingTypes` --
	// the same generic acceptance check `validateSource` performs -- never a
	// hardcoded panel kind, so a future instrument-accepting kind is
	// recognized automatically.
	function handleDragOver(event: DragEvent): void {
		if (!event.dataTransfer?.types.includes(PANEL_SOURCE_DRAG_MIME)) {
			return;
		}
		event.preventDefault();
		const panelId = panelIdAt(event.target);
		event.dataTransfer.dropEffect = panelId && !acceptsInstrumentDrop(panelId) ? 'none' : 'copy';
	}

	// The drop itself: rebind the panel dropped onto (AC2, AC3, AC5), or
	// create a chart at the dropped-on empty cell (AC1, AC4) -- both calls
	// go through panelController.ts's own createChartFromDrop/
	// bindPanelSourceFromDrop, which call the exact createPanel/
	// bindPanelSource use cases the agent's tools call. A rejection
	// (incompatible target, grid full) throws the identical
	// PanelOperationError an agent's rejected tool call would; caught here
	// and swallowed so "nothing changes" (AC3, AC4) never surfaces as an
	// uncaught error in the UI.
	function handleDrop(event: DragEvent): void {
		if (!event.dataTransfer?.types.includes(PANEL_SOURCE_DRAG_MIME)) {
			return;
		}
		event.preventDefault();
		const source = parsePanelSourceDrag(event.dataTransfer.getData(PANEL_SOURCE_DRAG_MIME));
		if (!source || !containerEl) {
			return;
		}
		const panelId = panelIdAt(event.target);
		try {
			if (panelId) {
				bindPanelSourceFromDrop(deps, panelId, source);
			} else {
				const cell = resolveDropCell(event, containerEl.getBoundingClientRect());
				if (!cell) {
					return;
				}
				createChartFromDrop(deps, source, cell, snapshot.rects);
			}
			refresh();
		} catch (err) {
			if (!(err instanceof PanelOperationError)) {
				throw err;
			}
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -- drag-and-drop is a
     pointer-only progressive enhancement over the agent-facing
     create_panel/bind_panel_source tools (T-0027-2); every drop-driven
     mutation remains fully reachable without it. -->
<div
	class="panel-container"
	style={containerGridStyle()}
	bind:this={containerEl}
	ondragover={handleDragOver}
	ondrop={handleDrop}
>
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
