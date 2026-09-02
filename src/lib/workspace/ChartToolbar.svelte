<script lang="ts">
	import type { Writable } from 'svelte/store';
	import type { ResearchEngine } from '../webmcp/types';
	import { ok, fail } from '../webmcp/tools';
	import { recordAction, type AgentActivityEvent } from './activity';
	import { parseTickers } from './tickerSearch';

	// `tickers` moved to the header's collapsed search control
	// (hotfix/marketpane-rebrand); this toolbar now reads it as a prop
	// instead of owning the field, so "Show monthly" still acts on whatever
	// the researcher last committed there.
	let {
		engine,
		activity,
		tickers,
		onclear
	}: {
		engine: ResearchEngine;
		activity: Writable<AgentActivityEvent[]>;
		tickers: string;
		onclear?: () => void;
	} = $props();

	let date = $state('2025-12-31');
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function clearPanels(): Promise<void> {
		busy = true;
		error = null;
		try {
			const result = await engine.clearPanels();
			recordAction(activity, 'human', 'clearPanels', undefined, ok(result));
			onclear?.();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			recordAction(activity, 'human', 'clearPanels', undefined, fail(message));
			error = message;
		} finally {
			busy = false;
		}
	}

	async function showMonthly(): Promise<void> {
		busy = true;
		error = null;
		const input = {
			tickers: parseTickers(tickers),
			date,
			window: [-20, 0] as [number, number],
			title: 'Monthly charts'
		};
		try {
			const result = await engine.showTickerCharts(input);
			recordAction(activity, 'human', 'showTickerCharts', input, ok(result));
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			recordAction(activity, 'human', 'showTickerCharts', input, fail(message));
			error = message;
		} finally {
			busy = false;
		}
	}
</script>

<section class="chart-toolbar panel-card" aria-label="Chart controls">
	<label>
		<span>End date</span>
		<input class="field" type="date" bind:value={date} disabled={busy} />
	</label>
	<div class="actions">
		<button type="button" class="control" onclick={clearPanels} disabled={busy}>Clear panels</button
		>
		<button type="button" class="control" onclick={showMonthly} disabled={busy}>Show monthly</button
		>
	</div>
	{#if error}
		<p class="error">{error}</p>
	{/if}
</section>

<style>
	.chart-toolbar {
		display: grid;
		grid-template-columns: minmax(150px, auto) auto;
		gap: var(--space-md);
		align-items: end;
		margin: 0 0 var(--space-lg);
	}
	label {
		display: grid;
		gap: var(--space-xs);
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-muted);
	}
	input {
		box-sizing: border-box;
		width: 100%;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.actions {
		display: flex;
		gap: var(--space-sm);
	}
	.error {
		grid-column: 1 / -1;
		margin: 0;
		color: var(--error);
		background: var(--error-bg);
		border: 1px solid var(--error);
		border-radius: var(--radius-sm);
		padding: var(--space-xs) var(--space-sm);
	}

	@media (max-width: 680px) {
		.chart-toolbar {
			grid-template-columns: 1fr;
		}
		.actions {
			justify-content: flex-start;
		}
	}
</style>
