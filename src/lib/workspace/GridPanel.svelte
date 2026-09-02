<script lang="ts">
	import type { Writable } from 'svelte/store';
	import { alignInstanceWindows, type AlignedWindow } from './visualization';
	import PriceChart from './PriceChart.svelte';
	import {
		fetchInstanceWindows,
		resolveBackendInstanceSet,
		type InstanceWindowView
	} from './apiEngine';
	import { removePanel, selectInstance } from './store';
	import type {
		ApiClientConfig,
		PanelSummary,
		ResearchEngine,
		WorkspaceState
	} from '../webmcp/types';

	// AC1's small-multiples grid: one mini-chart per instance, aligned to its
	// own anchor date. showGrid only returns a PanelSummary handle to the
	// agent (correct for the WebMCP tool contract -- see apiEngine.ts), so
	// this component fetches the bar data itself via fetchInstanceWindows,
	// independent of the tool call that created the panel.
	let {
		panel,
		engine,
		config,
		store,
		onselect
	}: {
		panel: PanelSummary;
		engine: ResearchEngine;
		config: ApiClientConfig;
		store: Writable<WorkspaceState>;
		onselect?: (view: InstanceWindowView) => void;
	} = $props();

	const CHART_WIDTH = 120;
	const CHART_HEIGHT = 60;

	let rawViews = $state<InstanceWindowView[]>([]);
	let windows = $state<AlignedWindow[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let missingData = $state(false);

	$effect(() => {
		const instanceSetId = panel.instanceSetId;
		if (!instanceSetId) {
			return;
		}
		loading = true;
		error = null;
		missingData = false;
		resolveBackendInstanceSet(engine, instanceSetId)
			.then((instanceSet) => {
				if (!instanceSet) {
					rawViews = [];
					windows = [];
					missingData = true;
					return [];
				}
				return fetchInstanceWindows(config, instanceSet, panel.n, panel.strategy, panel.window);
			})
			.then((views) => {
				rawViews = views;
				windows = alignInstanceWindows(views);
			})
			.catch((e: unknown) => {
				error = e instanceof Error ? e.message : String(e);
			})
			.finally(() => {
				loading = false;
			});
	});

	function handleSelect(win: AlignedWindow, index: number): void {
		selectInstance(store, panel.id, {
			ticker: win.ticker,
			date: win.date,
			completeness: win.completeness
		});
		onselect?.(rawViews[index]!);
	}

	// AC1/AC2: closes just this panel, leaving every other open panel
	// untouched -- see store.ts's removePanel for the focus-reset rule (AC3).
	function handleClose(): void {
		removePanel(store, panel.id);
	}
</script>

{#if !missingData}
	<section class="grid-panel panel-card">
		<div class="panel-header">
			<h3>{panel.title ?? 'Grid'} <code>{panel.id}</code> ({windows.length} instances)</h3>
			<button
				type="button"
				class="close control"
				onclick={handleClose}
				aria-label="Close panel {panel.id}"
			>
				Close
			</button>
		</div>
		{#if loading}
			<p class="empty">Loading…</p>
		{/if}
		{#if error}
			<p class="error">{error}</p>
		{/if}
		<div class="cells">
			{#each windows as win, i (win.ticker + win.date)}
				<button
					type="button"
					class="cell"
					class:partial={win.isPartial}
					onclick={() => handleSelect(win, i)}
				>
					<PriceChart
						bars={win.bars}
						anchorIndex={win.anchorIndex}
						width={CHART_WIDTH}
						height={CHART_HEIGHT}
						variant="mini"
					/>
					<span class="label"
						>{win.ticker} — {win.date}{#if win.isPartial}
							(partial){/if}</span
					>
				</button>
			{/each}
		</div>
	</section>
{/if}

<style>
	.grid-panel {
		margin-bottom: var(--space-lg);
	}
	.panel-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-sm);
		margin-bottom: var(--space-sm);
		padding-bottom: var(--space-sm);
		border-bottom: 1px solid var(--separator);
	}
	h3 {
		margin: 0;
		font-size: var(--font-size-sm);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}
	h3 code {
		text-transform: none;
		letter-spacing: 0;
		color: var(--text-muted);
	}
	.close {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
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
	.cells {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		gap: var(--space-sm);
	}
	.cell {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: var(--space-xs);
		background: var(--bg-elevated);
		cursor: pointer;
		font: inherit;
	}
	.cell:hover {
		background: var(--bg-hover);
		border-color: var(--border-strong);
	}
	.cell.partial {
		border-style: dashed;
		border-color: var(--warning);
	}
	.label {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--font-size-xs);
		text-align: center;
		margin-top: var(--space-xs);
		color: var(--text-secondary);
	}
</style>
