<script lang="ts">
	import type { Writable } from 'svelte/store';
	import type { ResearchEngine } from '../webmcp/types';
	import { ok, fail } from '../webmcp/tools';
	import { recordAction, type AgentActivityEvent } from './activity';

	let {
		engine,
		activity,
		onclear
	}: {
		engine: ResearchEngine;
		activity: Writable<AgentActivityEvent[]>;
		onclear?: () => void;
	} = $props();

	let tickers = $state('MOCK02, MOCK03');
	let date = $state('2025-12-31');
	let busy = $state(false);
	let error = $state<string | null>(null);

	function parseTickers(): string[] {
		return tickers
			.split(/[\s,]+/)
			.map((ticker) => ticker.trim().toUpperCase())
			.filter(Boolean);
	}

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
			tickers: parseTickers(),
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

<section class="chart-toolbar" aria-label="Chart controls">
	<label>
		<span>Tickers</span>
		<input bind:value={tickers} disabled={busy} />
	</label>
	<label>
		<span>End date</span>
		<input type="date" bind:value={date} disabled={busy} />
	</label>
	<div class="actions">
		<button type="button" onclick={clearPanels} disabled={busy}>Clear panels</button>
		<button type="button" onclick={showMonthly} disabled={busy}>Show monthly</button>
	</div>
	{#if error}
		<p class="error">{error}</p>
	{/if}
</section>

<style>
	.chart-toolbar {
		display: grid;
		grid-template-columns: minmax(180px, 1fr) minmax(150px, auto) auto;
		gap: 0.75rem;
		align-items: end;
		margin: 1rem 0 1.5rem;
		padding: 0.75rem 0;
		border-top: 1px solid #ddd;
		border-bottom: 1px solid #ddd;
	}
	label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: #555;
	}
	input {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #bbb;
		border-radius: 4px;
		padding: 0.45rem 0.55rem;
		font: inherit;
		color: #111;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	button {
		border: 1px solid #999;
		border-radius: 4px;
		padding: 0.45rem 0.65rem;
		background: #fff;
		color: #111;
		font: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	button:disabled,
	input:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.error {
		grid-column: 1 / -1;
		margin: 0;
		color: #b00;
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
