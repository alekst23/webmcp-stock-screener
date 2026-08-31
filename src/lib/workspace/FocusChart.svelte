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

	const CHART_WIDTH = 480;
	const CHART_HEIGHT = 220;

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
		margin-bottom: 1.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		padding: 0.75rem;
	}
	h2 {
		font-size: 1.1rem;
		margin-bottom: 0.5rem;
	}
	.partial-tag {
		font-size: 0.75rem;
		color: #c90;
		border: 1px solid #c90;
		border-radius: 3px;
		padding: 0.1rem 0.4rem;
		margin-left: 0.5rem;
	}
	.range-tabs {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
		border-bottom: 1px solid #eee;
	}
	.range-tabs button {
		border: none;
		background: none;
		font: inherit;
		font-size: 0.85rem;
		color: #666;
		padding: 0.3rem 0.1rem 0.5rem;
		cursor: pointer;
	}
	.range-tabs button.active {
		color: #06c;
		font-weight: 600;
		border-bottom: 2px solid #06c;
	}
	.empty {
		color: #888;
		font-style: italic;
	}
	.range {
		font-size: 0.8rem;
		color: #666;
		margin-top: 0.25rem;
	}
</style>
