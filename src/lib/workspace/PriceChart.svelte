<script lang="ts">
	import { axisTickIndices, axisTicks, computeChartGeometry, nearestBarIndex } from './visualization';
	import type { BackendPriceBar } from './apiEngine';

	// Shared chart body for both the grid's small-multiples cells and the
	// single-instance detail view -- gridlines/axis labels/hover tooltip
	// behave the same way at both sizes, just with fewer ticks and smaller
	// text in the 'mini' variant so a 120x60 grid cell doesn't get cluttered.
	let {
		bars,
		anchorIndex,
		width,
		height,
		variant = 'detail'
	}: {
		bars: BackendPriceBar[];
		anchorIndex: number;
		width: number;
		height: number;
		variant?: 'mini' | 'detail';
	} = $props();

	const geometry = $derived(computeChartGeometry(bars, width, height));
	const anchorXPos = $derived(geometry.x(anchorIndex));
	const yTickCount = $derived(variant === 'mini' ? 2 : 5);
	const xTickCount = $derived(variant === 'mini' ? 2 : 5);
	const yTickValues = $derived(axisTicks(geometry.min, geometry.max, yTickCount));
	const xTickIdx = $derived(axisTickIndices(bars.length, xTickCount));

	let svgEl: SVGSVGElement | undefined = $state();
	let hoverIndex = $state<number | null>(null);

	function handlePointerMove(event: PointerEvent): void {
		if (bars.length === 0 || !svgEl) {
			return;
		}
		const rect = svgEl.getBoundingClientRect();
		if (rect.width === 0) {
			return;
		}
		const viewBoxX = ((event.clientX - rect.left) / rect.width) * width;
		hoverIndex = nearestBarIndex(viewBoxX, bars.length, width);
	}

	function handlePointerLeave(): void {
		hoverIndex = null;
	}

	const hoverBar = $derived(hoverIndex !== null ? (bars[hoverIndex] ?? null) : null);
	const tooltipLeftPct = $derived(
		hoverIndex !== null ? (geometry.x(hoverIndex) / width) * 100 : 0
	);
</script>

<div class="price-chart price-chart--{variant}">
	<svg
		bind:this={svgEl}
		viewBox="0 0 {width} {height}"
		preserveAspectRatio="none"
		role="img"
		aria-label="Price chart"
		onpointermove={handlePointerMove}
		onpointerleave={handlePointerLeave}
	>
		<defs>
			<linearGradient id="price-chart-fill-{variant}" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="#2a6" stop-opacity="0.25" />
				<stop offset="100%" stop-color="#2a6" stop-opacity="0" />
			</linearGradient>
		</defs>
		{#each yTickValues as tick (tick)}
			<line x1="0" y1={geometry.y(tick)} x2={width} y2={geometry.y(tick)} class="grid" />
			{#if tick !== geometry.min}
				<!-- the bottom-most tick's label is skipped -- it would sit in the
				     same corner as the x-axis date labels below -->
				<text x="2" y={geometry.y(tick) - 2} class="axis-label">{tick.toFixed(2)}</text>
			{/if}
		{/each}
		{#if bars.length > 0}
			<path d={geometry.areaPath} class="area" fill="url(#price-chart-fill-{variant})" />
			<path d={geometry.linePath} class="line" />
			<line x1={anchorXPos} y1="0" x2={anchorXPos} y2={height} class="anchor" />
		{/if}
		{#each xTickIdx as i, tickPos (i)}
			<text
				x={geometry.x(i)}
				y={height - 3}
				class="axis-label"
				text-anchor={tickPos === 0 ? 'start' : tickPos === xTickIdx.length - 1 ? 'end' : 'middle'}
			>
				{bars[i]?.date}
			</text>
		{/each}
		{#if hoverBar && hoverIndex !== null}
			<line
				x1={geometry.x(hoverIndex)}
				y1="0"
				x2={geometry.x(hoverIndex)}
				y2={height}
				class="crosshair"
			/>
			<circle cx={geometry.x(hoverIndex)} cy={geometry.y(hoverBar.close)} r="3" class="dot" />
		{/if}
	</svg>
	{#if hoverBar}
		<div class="tooltip" style:left="{tooltipLeftPct}%">
			<strong>{hoverBar.close.toFixed(2)}</strong>
			<span>{hoverBar.date}</span>
		</div>
	{/if}
</div>

<style>
	.price-chart {
		position: relative;
	}
	svg {
		width: 100%;
		display: block;
		touch-action: none;
	}
	.price-chart--detail svg {
		background: #fafafa;
	}
	.line {
		fill: none;
		stroke: #2a6;
		stroke-width: 1.5;
	}
	.price-chart--detail .line {
		stroke-width: 2;
	}
	.area {
		stroke: none;
	}
	.anchor {
		stroke: #999;
		stroke-width: 1;
		stroke-dasharray: 2 2;
	}
	.grid {
		stroke: #e5e5e5;
		stroke-width: 1;
	}
	.axis-label {
		font-size: 6px;
		fill: #888;
	}
	.price-chart--detail .axis-label {
		font-size: 9px;
	}
	.crosshair {
		stroke: #666;
		stroke-width: 1;
		stroke-dasharray: 2 2;
	}
	.dot {
		fill: #2a6;
		stroke: #fff;
		stroke-width: 1;
	}
	.tooltip {
		position: absolute;
		top: 2px;
		transform: translateX(-50%);
		background: #222;
		color: #fff;
		border-radius: 3px;
		padding: 0.15rem 0.4rem;
		font-size: 0.65rem;
		line-height: 1.3;
		white-space: nowrap;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.price-chart--detail .tooltip {
		font-size: 0.75rem;
		padding: 0.25rem 0.5rem;
	}
</style>
