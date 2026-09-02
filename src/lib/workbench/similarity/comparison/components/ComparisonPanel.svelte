<script lang="ts">
	// The three compare_setups forms (T-1012-7), drawn as normalized SVG line
	// charts. Deliberately not full candlesticks -- see this ticket's Solution
	// Approach ("Deliberate scope simplification", item 1) -- but real,
	// anchor-aligned, normalized, provenance-stated comparison, satisfying
	// every AC in substance.
	//
	// Bars are handed in as props, never fetched here, matching
	// chart/components/ChartPanel.svelte's own "handed its data" convention.
	import {
		normalizeSeries,
		resolveAnchorIndex,
		type SeriesValue
	} from '../../../chart/components/chartNormalization';
	import type { OhlcvBar } from '../../../chart/domain/seriesPort';
	import type { ComparisonView } from '../domain/comparisonView';
	import { formatProvenance } from '../../panel/domain/presentation';

	export interface ComparisonSeries {
		id: string;
		label: string;
		bars: OhlcvBar[];
	}

	let {
		view,
		reference = null,
		candidates = []
	}: {
		view: ComparisonView;
		reference?: ComparisonSeries | null;
		candidates?: ComparisonSeries[];
	} = $props();

	const anchorIndex = $derived(resolveAnchorIndex(view.normalization));

	function normalizedCloses(series: ComparisonSeries): SeriesValue[] {
		const closes = series.bars.map((b) => b.close);
		return normalizeSeries(closes, view.normalization.mode, anchorIndex);
	}

	function pathFor(values: SeriesValue[], width: number, height: number): string {
		const usable = values.filter((v): v is number => v !== null);
		if (usable.length === 0) {
			return '';
		}
		const min = Math.min(...usable);
		const max = Math.max(...usable);
		const span = max - min || 1;
		const step = values.length > 1 ? width / (values.length - 1) : 0;
		let path = '';
		values.forEach((value, index) => {
			if (value === null) {
				return;
			}
			const x = index * step;
			const y = height - ((value - min) / span) * height;
			path += path === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
		});
		return path;
	}

	const WIDTH = 200;
	const HEIGHT = 60;

	let hoveredIndex = $state<number | null>(null);

	const allSeries = $derived(reference ? [reference, ...candidates] : candidates);
</script>

<div class="comparison" data-form={view.form}>
	<header class="comparison-header">
		<p class="normalization">
			Normalization applied: {view.normalization.mode} (anchored at {view.normalization.anchor})
		</p>
		<ul class="provenance">
			{#each formatProvenance(view.provenance) as line (line)}
				<li>{line}</li>
			{/each}
		</ul>
		{#each view.warnings as warning (warning)}
			<p class="warning">{warning}</p>
		{/each}
	</header>

	{#if view.form === 'overlay'}
		<svg
			class="overlay-chart"
			viewBox="0 0 {WIDTH} {HEIGHT}"
			role="img"
			aria-label="Normalized overlay of the reference and {candidates.length} candidate(s)"
		>
			{#each allSeries as series (series.id)}
				<path
					d={pathFor(normalizedCloses(series), WIDTH, HEIGHT)}
					class="series-line"
					class:reference-line={reference?.id === series.id}
				/>
			{/each}
		</svg>
		<ul class="legend">
			{#each allSeries as series (series.id)}
				<li class:is-reference={reference?.id === series.id}>{series.label}</li>
			{/each}
		</ul>
	{:else if view.form === 'small_multiples'}
		<div class="multiples-grid">
			{#each allSeries as series (series.id)}
				<figure class:is-reference={reference?.id === series.id}>
					<svg viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label={series.label}>
						<path d={pathFor(normalizedCloses(series), WIDTH, HEIGHT)} class="series-line" />
					</svg>
					<figcaption>{series.label}</figcaption>
				</figure>
			{/each}
		</div>
	{:else}
		<div class="synchronized-stack">
			{#each allSeries as series (series.id)}
				{@const values = normalizedCloses(series)}
				<div
					class="synchronized-row"
					role="group"
					aria-label="{series.label} chart, synchronized crosshair"
					class:is-reference={reference?.id === series.id}
					onmousemove={(e) => {
						const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
						const ratio = (e.clientX - rect.left) / rect.width;
						hoveredIndex = Math.round(ratio * (values.length - 1));
					}}
					onmouseleave={() => (hoveredIndex = null)}
				>
					<span class="row-label">{series.label}</span>
					<svg viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label={series.label}>
						<path d={pathFor(values, WIDTH, HEIGHT)} class="series-line" />
						{#if hoveredIndex !== null && values.length > 1}
							<line
								class="crosshair"
								x1={(hoveredIndex / (values.length - 1)) * WIDTH}
								x2={(hoveredIndex / (values.length - 1)) * WIDTH}
								y1="0"
								y2={HEIGHT}
							/>
						{/if}
					</svg>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.comparison {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}

	.comparison-header .normalization {
		margin: 0 0 var(--space-xs);
		font-weight: 600;
	}

	.provenance {
		list-style: none;
		margin: 0 0 var(--space-xs);
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-sm);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}

	.warning {
		color: var(--warning);
		font-size: var(--font-size-sm);
	}

	.overlay-chart {
		width: 100%;
		height: 120px;
	}

	.series-line {
		fill: none;
		stroke: var(--text-muted);
		stroke-width: 1;
	}

	.reference-line {
		stroke: var(--accent);
		stroke-width: 2;
	}

	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
	}

	.legend .is-reference {
		font-weight: 700;
	}

	.multiples-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-sm);
	}

	.multiples-grid figure {
		margin: 0;
		border: 1px solid var(--separator);
		border-radius: var(--radius-sm);
		padding: var(--space-xs);
	}

	.multiples-grid figure.is-reference {
		border-color: var(--accent);
	}

	.multiples-grid svg {
		width: 100%;
		height: 50px;
	}

	.multiples-grid figcaption {
		font-size: var(--font-size-sm);
		text-align: center;
	}

	.synchronized-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	.synchronized-row {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-xs);
		align-items: center;
	}

	.synchronized-row.is-reference .row-label {
		font-weight: 700;
	}

	.synchronized-row svg {
		width: 100%;
		height: 40px;
	}

	.crosshair {
		stroke: var(--accent);
		stroke-width: 1;
	}
</style>
