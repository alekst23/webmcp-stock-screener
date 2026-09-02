<script lang="ts">
	// The `chart` panel kind: what a chart panel looks like on screen.
	//
	// It renders from chart state plus the same bounded read `get_chart_data`
	// answers with, so a human watching the panel and an agent reading the tool
	// are looking at the same bars, the same study values and the same
	// provenance. Nothing here fetches: the panel is handed its data, which
	// keeps it a pure function of props and leaves the fetch policy to whoever
	// owns the panel's lifecycle.
	//
	// All layout decisions live in `chartPanelModel`; this file is markup.
	import type { WorkspaceDocument } from '../../domain/workspace';
	import type { ResourceId } from '../../domain/ids';
	import { readChartState } from '../domain/chartState';
	import { readChartAnnotationsView } from '../application/chartAnnotations';
	import type { ChartDataResult } from '../application/chartData';
	import {
		buildChartPanelModel,
		DEFAULT_PANEL_WIDTH,
		DEFAULT_PRICE_HEIGHT,
		DEFAULT_SUB_PANE_HEIGHT,
		type ComparisonBars
	} from './chartPanelModel';

	let {
		workspace,
		panelId,
		data = null,
		comparisons = [],
		width = DEFAULT_PANEL_WIDTH,
		priceHeight = DEFAULT_PRICE_HEIGHT,
		subPaneHeight = DEFAULT_SUB_PANE_HEIGHT
	}: {
		workspace: WorkspaceDocument;
		panelId: ResourceId;
		data?: ChartDataResult | null;
		comparisons?: ComparisonBars[];
		width?: number;
		priceHeight?: number;
		subPaneHeight?: number;
	} = $props();

	// Read through the chart-state door and the annotations view rather than off
	// `extensions`: staleness in particular is computed in exactly one place,
	// and a second computation here could contradict what the tools reported.
	const state = $derived(readChartState(workspace, panelId));
	const annotationsView = $derived(readChartAnnotationsView(workspace, panelId));
	const model = $derived(
		buildChartPanelModel({
			state,
			annotations: annotationsView,
			data,
			comparisons,
			width,
			priceHeight,
			subPaneHeight
		})
	);

	const EMPTY_REASONS: Record<string, string> = {
		no_instrument: 'This chart is not pointed at an instrument yet.',
		no_data: 'No data has been read for this chart yet.',
		no_bars: 'The configured range contains no bars.'
	};

	function livenessText(): string {
		const provenance = model.provenance;
		if (!provenance) {
			return 'no data source';
		}
		return provenance.liveness === 'delayed'
			? `delayed by ${provenance.delaySeconds ?? 0}s`
			: provenance.liveness;
	}

	// The chart's own three-value policy is finer than provenance's, so both are
	// stated: "adjusted" in provenance cannot distinguish split-adjusted prices.
	function adjustmentText(): string {
		const { chartPolicy, applied } = model.priceAdjustment;
		if (applied === null) {
			return `${chartPolicy} requested; source states no basis`;
		}
		return applied === chartPolicy ? chartPolicy : `${chartPolicy} requested; ${applied} applied`;
	}
</script>

<section class="chart-panel" data-testid="chart-panel" data-panel-id={model.panelId}>
	<header class="chart-panel__head">
		{#if model.instrument}
			<span
				class="symbol"
				data-testid="chart-instrument"
				data-instrument-id={model.instrument.instrumentId}>{model.instrument.symbol}</span
			>
			<span class="exchange">{model.instrument.exchange}</span>
		{:else}
			<span class="symbol symbol--unbound">No instrument</span>
		{/if}
		<span class="meta">{model.timeframe}</span>
		<span class="meta">{model.candleType}</span>
		<span class="meta" data-testid="chart-scale">
			{model.effectiveScale}{model.effectiveScale !== model.requestedScale
				? ` (${model.requestedScale} not usable here)`
				: ''}
		</span>
		<span class="meta">{model.session}</span>
	</header>

	<p class="provenance" data-testid="chart-provenance">
		<span data-testid="chart-adjustment">Prices: {adjustmentText()}</span>
		<span data-testid="chart-liveness">Data: {livenessText()}</span>
		{#if model.provenance}
			<span data-testid="chart-as-of">As of {model.provenance.asOf}</span>
			<span>{model.provenance.sourceLabel}</span>
			<span>{model.provenance.timezone}</span>
		{/if}
	</p>

	{#if model.emptyReason}
		<p class="empty" data-testid="chart-empty">{EMPTY_REASONS[model.emptyReason]}</p>
	{/if}

	{#if model.pricePane}
		{@const pane = model.pricePane}
		<svg
			class="price-pane"
			viewBox="0 0 {model.width} {model.priceHeight}"
			preserveAspectRatio="none"
			role="img"
			aria-label="Price chart for {model.instrument?.symbol ?? 'no instrument'}"
		>
			{#each model.priceAxis as tick (tick.value)}
				<line x1="0" y1={tick.y} x2={model.width} y2={tick.y} class="grid" />
				<text x="2" y={tick.y - 2} class="axis-label">{tick.value.toFixed(2)}</text>
			{/each}

			<!-- Bands sit under the price marks so a highlighted window reads as
			     background rather than as something drawn over the bars. -->
			{#each model.annotations as mark (mark.annotationId)}
				{#if mark.geometry.shape === 'band'}
					<rect
						class="annotation annotation--{mark.kind}"
						class:annotation--stale={mark.stale}
						data-annotation-id={mark.annotationId}
						data-stale={mark.stale}
						x={mark.geometry.x}
						y="0"
						width={mark.geometry.width}
						height={model.priceHeight}
					/>
				{/if}
			{/each}

			{#if pane.style === 'area'}
				<path class="series-area" d={pane.areaPath} />
			{/if}
			{#if pane.style === 'line' || pane.style === 'area'}
				<path class="series-line" d={pane.linePath} />
			{/if}
			{#if pane.style === 'candle' || pane.style === 'bar'}
				{#each pane.marks as mark (mark.index)}
					<g class="candle candle--{mark.direction}" class:candle--hollow={pane.hollow}>
						<line x1={mark.x} y1={mark.highY} x2={mark.x} y2={mark.lowY} class="wick" />
						{#if pane.style === 'candle'}
							<rect
								class="body"
								x={mark.x - mark.halfWidth}
								y={Math.min(mark.openY, mark.closeY)}
								width={mark.halfWidth * 2}
								height={Math.max(1, Math.abs(mark.closeY - mark.openY))}
							/>
						{:else}
							<line
								x1={mark.x - mark.halfWidth}
								y1={mark.openY}
								x2={mark.x}
								y2={mark.openY}
								class="tick"
							/>
							<line
								x1={mark.x}
								y1={mark.closeY}
								x2={mark.x + mark.halfWidth}
								y2={mark.closeY}
								class="tick"
							/>
						{/if}
					</g>
				{/each}
			{/if}

			{#each model.comparisons as comparison (comparison.instrument.instrumentId)}
				{#if !comparison.missing}
					<path
						class="comparison"
						data-comparison-id={comparison.instrument.instrumentId}
						data-normalization={comparison.normalization.mode}
						d={comparison.path}
					/>
				{/if}
			{/each}

			{#each model.overlays as overlay (overlay.studyId)}
				{#each overlay.series as series (series.name)}
					<path
						class="study-overlay"
						data-study-id={overlay.studyId}
						data-output={series.name}
						d={series.path}
					/>
				{/each}
			{/each}

			{#each model.annotations as mark (mark.annotationId)}
				{#if mark.geometry.shape === 'trendline'}
					<line
						class="annotation annotation--trendline"
						class:annotation--stale={mark.stale}
						data-annotation-id={mark.annotationId}
						data-stale={mark.stale}
						x1={mark.geometry.x1}
						y1={mark.geometry.y1}
						x2={mark.geometry.x2}
						y2={mark.geometry.y2}
					/>
				{:else if mark.geometry.shape === 'price_level'}
					<line
						class="annotation annotation--price-level"
						class:annotation--stale={mark.stale}
						data-annotation-id={mark.annotationId}
						data-stale={mark.stale}
						x1="0"
						y1={mark.geometry.y}
						x2={model.width}
						y2={mark.geometry.y}
					/>
				{:else if mark.geometry.shape === 'label'}
					<text
						class="annotation annotation--label"
						class:annotation--stale={mark.stale}
						data-annotation-id={mark.annotationId}
						data-stale={mark.stale}
						x={mark.geometry.x}
						y={mark.geometry.y}>{mark.geometry.text}</text
					>
				{/if}
			{/each}

			{#each model.timeAxis as tick, position (tick.index)}
				<text
					x={tick.x}
					y={model.priceHeight - 3}
					class="axis-label"
					text-anchor={position === 0
						? 'start'
						: position === model.timeAxis.length - 1
							? 'end'
							: 'middle'}>{tick.label}</text
				>
			{/each}
		</svg>
	{/if}

	{#each model.subPanes as subPane (subPane.studyId)}
		<svg
			class="sub-pane"
			data-testid="chart-sub-pane"
			data-study-id={subPane.studyId}
			viewBox="0 0 {model.width} {subPane.height}"
			preserveAspectRatio="none"
			role="img"
			aria-label="{subPane.catalogItemId} sub-pane"
		>
			{#each subPane.axis as tick (tick.value)}
				<line x1="0" y1={tick.y} x2={model.width} y2={tick.y} class="grid" />
				<text x="2" y={tick.y - 2} class="axis-label">{tick.value.toFixed(2)}</text>
			{/each}
			{#each subPane.series as series (series.name)}
				<path class="study-sub-pane" data-output={series.name} d={series.path} />
			{/each}
		</svg>
	{/each}

	{#if model.studies.length > 0}
		<ul class="study-list" data-testid="chart-study-list">
			<!-- Every study, enabled or not: a toggled-off study keeps its place in
			     the list so turning it back on is visibly the same study. -->
			{#each model.studies as study (study.studyId)}
				<li
					class="study"
					class:study--off={!study.enabled}
					data-study-id={study.studyId}
					data-enabled={study.enabled}
					data-pane={study.pane}
				>
					{study.catalogItemId}
					<span class="study-pane">{study.pane === 'price_overlay' ? 'on price' : 'sub-pane'}</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if model.comparisons.length > 0}
		<ul class="comparison-list" data-testid="chart-comparison-list">
			{#each model.comparisons as comparison (comparison.instrument.instrumentId)}
				<li data-comparison-id={comparison.instrument.instrumentId}>
					{comparison.instrument.symbol}
					<span class="unit">{comparison.unitLabel}</span>
					{#if comparison.missing}<span class="unit">no data loaded</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if model.annotations.some((mark) => mark.stale)}
		<p class="stale-note" data-testid="chart-stale-note">
			Dashed drawings were made under a different price-adjustment policy and no longer sit at the
			price they were drawn at.
		</p>
	{/if}
</section>

<style>
	.chart-panel {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.chart-panel__head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.symbol {
		font-weight: 600;
	}
	.symbol--unbound,
	.exchange,
	.meta,
	.unit,
	.study-pane {
		color: var(--text-muted);
		font-size: var(--font-size-xs);
	}
	.provenance {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin: 0;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
	}
	.empty,
	.stale-note {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-xs);
	}
	svg {
		width: 100%;
		display: block;
		background: var(--bg-app);
		border-radius: var(--radius-sm);
	}
	.grid {
		stroke: var(--chart-grid);
		stroke-width: 1;
	}
	.axis-label {
		font-family: var(--font-mono);
		font-size: 9px;
		fill: var(--chart-axis);
	}
	.series-line,
	.study-overlay,
	.study-sub-pane,
	.comparison {
		fill: none;
		stroke: var(--chart-line);
		stroke-width: 1.5;
	}
	.series-area {
		fill: var(--chart-fill-from);
		stroke: none;
		opacity: 0.3;
	}
	.study-overlay,
	.study-sub-pane {
		stroke: var(--chart-anchor);
		stroke-width: 1;
	}
	.comparison {
		stroke: var(--chart-crosshair);
		stroke-width: 1;
		stroke-dasharray: 4 2;
	}
	.wick {
		stroke: var(--chart-line);
		stroke-width: 1;
	}
	.tick {
		stroke: var(--chart-line);
		stroke-width: 1.5;
	}
	.body {
		fill: var(--chart-line);
		stroke: var(--chart-line);
		stroke-width: 1;
	}
	/* Hollow candles keep the outline and drop the fill for up bars only --
	   a down bar stays solid, which is what makes the distinction readable. */
	.candle--hollow.candle--up .body {
		fill: none;
	}
	.annotation {
		stroke: var(--chart-anchor);
		stroke-width: 1.5;
		fill: none;
	}
	rect.annotation {
		fill: var(--chart-fill-from);
		stroke: none;
		opacity: 0.25;
	}
	text.annotation {
		fill: var(--chart-axis);
		stroke: none;
		font-size: 10px;
	}
	/* Stale drawings stay visible and become visibly different: hiding them
	   would lose the drawing, and leaving them identical would assert a price
	   that is no longer the price it was drawn at. */
	.annotation--stale {
		stroke-dasharray: 3 3;
		opacity: 0.55;
	}
	.study-list,
	.comparison-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-size: var(--font-size-xs);
	}
	.study--off {
		opacity: 0.45;
		text-decoration: line-through;
	}
</style>
