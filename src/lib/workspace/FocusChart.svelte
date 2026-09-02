<script lang="ts">
	import { alignInstanceWindow, sliceBarsForRange, type ChartRange } from './visualization';
	import PriceChart from './PriceChart.svelte';
	import type { InstanceWindowView } from './apiEngine';

	// AC2: a single instance selected from the grid (GridPanel's onselect),
	// rendered larger and with more detail than a grid cell. Takes the
	// InstanceWindowView the grid already fetched rather than re-fetching --
	// the backend's instance-windows endpoint samples by strategy, not by an
	// explicit (ticker, date), so there's no request that would fetch just
	// this one instance's window on its own.
	let { view }: { view: InstanceWindowView } = $props();

	// Sized for the shell's full-width work area: the SVG is stretched to the
	// container, so a viewBox near the rendered pixel width keeps axis labels
	// and stroke widths at their intended scale.
	const CHART_WIDTH = 960;
	const CHART_HEIGHT = 320;

	const RANGES: { key: ChartRange; label: string }[] = [
		{ key: '5d', label: '5D' },
		{ key: '1m', label: '1M' },
		{ key: 'max', label: 'Max' }
	];

	const aligned = $derived(alignInstanceWindow(view));

	// A client-side slice of what's already fetched -- see
	// visualization.ts's sliceBarsForRange for why this is exact for the
	// common trailing-window case and an approximation otherwise.
	let range = $state<ChartRange>('max');
	const rangeBars = $derived(sliceBarsForRange(aligned.bars, range));
	// The anchor may fall before the slice's start (a window with bars past
	// the anchor, sliced narrower than the distance from the anchor to the
	// window's end) -- clamp to the slice's left edge rather than passing a
	// negative index to PriceChart.
	const rangeAnchorIndex = $derived(
		Math.max(0, aligned.anchorIndex - (aligned.bars.length - rangeBars.length))
	);
</script>

<section class="focus-chart">
	<h2>
		{aligned.ticker} — {aligned.date}
		{#if aligned.isPartial}<span class="partial-tag">partial match</span>{/if}
	</h2>
	{#if aligned.bars.length === 0}
		<p class="empty">No price data available for this instance.</p>
	{:else}
		<div class="range-tabs" role="tablist" aria-label="Chart range">
			{#each RANGES as { key, label } (key)}
				<button
					type="button"
					role="tab"
					aria-selected={range === key}
					class:active={range === key}
					onclick={() => (range = key)}
				>
					{label}
				</button>
			{/each}
		</div>
		<PriceChart
			bars={rangeBars}
			anchorIndex={rangeAnchorIndex}
			width={CHART_WIDTH}
			height={CHART_HEIGHT}
			variant="detail"
		/>
		<p class="range">
			{aligned.bars[0]!.date} → {aligned.bars[aligned.bars.length - 1]!.date} ({aligned.bars.length} bars)
		</p>
	{/if}
</section>

<style>
	.focus-chart {
		margin-bottom: var(--space-lg);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--bg-panel);
		padding: var(--space-md);
	}
	h2 {
		margin: 0 0 var(--space-sm);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--font-size-lg);
		color: var(--text-primary);
	}
	.partial-tag {
		font-family: var(--font-ui);
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--warning);
		border: 1px solid var(--warning);
		border-radius: var(--radius-sm);
		padding: 0.1rem 0.4rem;
		margin-left: var(--space-sm);
		vertical-align: middle;
	}
	.range-tabs {
		display: flex;
		gap: var(--space-md);
		margin-bottom: var(--space-sm);
		border-bottom: 1px solid var(--separator);
	}
	.range-tabs button {
		border: none;
		background: none;
		font: inherit;
		font-size: var(--font-size-sm);
		letter-spacing: var(--tracking-label);
		color: var(--text-muted);
		padding: var(--space-xs) var(--space-xs) var(--space-sm);
		cursor: pointer;
	}
	.range-tabs button:hover {
		color: var(--text-primary);
	}
	.range-tabs button.active {
		color: var(--accent);
		font-weight: 600;
		box-shadow: inset 0 -2px 0 0 var(--accent);
	}
	.empty {
		color: var(--text-muted);
		font-style: italic;
	}
	.range {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--font-size-xs);
		color: var(--text-muted);
		margin: var(--space-xs) 0 0;
	}
</style>
