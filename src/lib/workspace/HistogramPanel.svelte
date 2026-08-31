<script lang="ts">
	import { buildHistogram, computeForwardReturns, type HistogramBucket } from './visualization';
	import { fetchInstanceWindows, resolveBackendInstanceSet } from './apiEngine';
	import type { ApiClientConfig, ResearchEngine } from '../webmcp/types';

	// AC3: distribution of a measured outcome across a result set. measure()
	// only returns an aggregate (median/mean/hit_rate) -- no per-instance
	// values, so a distribution isn't available from that tool's result at
	// all. Computed here instead from the same InstanceWindow bars the grid
	// renders (see visualization.ts's computeForwardReturns): fetch a wide
	// window reaching horizonDays past t=0, then derive each instance's own
	// forward return client-side.
	let {
		instanceSetId,
		engine,
		config,
		horizonDays = 10
	}: {
		instanceSetId: string;
		engine: ResearchEngine;
		config: ApiClientConfig;
		horizonDays?: number;
	} = $props();

	let expanded = $state(false);
	let buckets = $state<HistogramBucket[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let missingData = $state(false);
	let loaded = $state(false);

	async function toggle(): Promise<void> {
		expanded = !expanded;
		if (!expanded || loaded) {
			return;
		}
		const instanceSet = await resolveBackendInstanceSet(engine, instanceSetId);
		if (!instanceSet) {
			missingData = true;
			return;
		}
		loading = true;
		error = null;
		missingData = false;
		try {
			// n=50: wide enough for a real distribution shape without pulling
			// the whole set for large instance sets. window=[0, horizonDays]:
			// just enough bars past anchor for computeForwardReturns to work.
			const views = await fetchInstanceWindows(config, instanceSet, 50, 'recent', [0, horizonDays]);
			buckets = buildHistogram(computeForwardReturns(views, horizonDays));
			loaded = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	const maxCount = $derived(Math.max(1, ...buckets.map((b) => b.count)));
</script>

<section class="histogram-panel">
	<button type="button" onclick={toggle}>
		{expanded ? 'Hide' : 'Show'} histogram ({horizonDays}d forward return)
	</button>
	{#if expanded}
		{#if loading}
			<p class="empty">Loading…</p>
		{/if}
		{#if error}
			<p class="error">{error}</p>
		{/if}
		{#if missingData}
			<p class="empty">Outcome data unavailable after reload.</p>
		{/if}
		{#if !loading && !error && !missingData && buckets.length === 0}
			<p class="empty">No resolved outcomes yet for this set.</p>
		{/if}
		{#if buckets.length > 0}
			<div class="bars">
				{#each buckets as bucket (bucket.rangeStart)}
					<div
						class="bar-col"
						title="{(bucket.rangeStart * 100).toFixed(1)}% to {(bucket.rangeEnd * 100).toFixed(
							1
						)}%: {bucket.count}"
					>
						<div class="bar" style:height="{(bucket.count / maxCount) * 100}%"></div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</section>

<style>
	.histogram-panel {
		margin-bottom: 1rem;
	}
	.empty {
		color: #888;
		font-style: italic;
	}
	.error {
		color: #b00;
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 100px;
		margin-top: 0.5rem;
	}
	.bar-col {
		flex: 1;
		height: 100%;
		display: flex;
		align-items: flex-end;
	}
	.bar {
		width: 100%;
		background: #2a6;
		min-height: 2px;
	}
</style>
