<script lang="ts">
	import { alignInstanceWindow } from './visualization';
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

	const aligned = $derived(alignInstanceWindow(view));

	function linePath(bars: InstanceWindowView['bars']): string {
		const closes = bars.map((b) => b.close);
		if (closes.length === 0) {
			return '';
		}
		const min = Math.min(...closes);
		const max = Math.max(...closes);
		const range = max - min || 1;
		const lastIndex = Math.max(1, closes.length - 1);
		return closes
			.map((close, i) => {
				const x = (i / lastIndex) * CHART_WIDTH;
				const y = CHART_HEIGHT - ((close - min) / range) * CHART_HEIGHT;
				return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	}

	const anchorX = $derived(
		(aligned.anchorIndex / Math.max(1, aligned.bars.length - 1)) * CHART_WIDTH
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
		<svg viewBox="0 0 {CHART_WIDTH} {CHART_HEIGHT}" preserveAspectRatio="none">
			<line x1={anchorX} y1="0" x2={anchorX} y2={CHART_HEIGHT} class="anchor" />
			<path d={linePath(aligned.bars)} class="line" />
		</svg>
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
	.empty {
		color: #888;
		font-style: italic;
	}
	svg {
		width: 100%;
		height: 220px;
		background: #fafafa;
	}
	.line {
		fill: none;
		stroke: #2a6;
		stroke-width: 2;
	}
	.anchor {
		stroke: #999;
		stroke-width: 1;
		stroke-dasharray: 3 3;
	}
	.range {
		font-size: 0.8rem;
		color: #666;
		margin-top: 0.25rem;
	}
</style>
