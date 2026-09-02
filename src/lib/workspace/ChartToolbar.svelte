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
		gap: var(--space-md);
		align-items: end;
		margin: 0 0 var(--space-lg);
		padding: var(--space-md);
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	label {
		display: grid;
		gap: var(--space-xs);
		font-size: var(--font-size-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	input {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: 0.45rem 0.55rem;
		font: inherit;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		background: var(--bg-elevated);
		color: var(--text-primary);
	}
	input:hover {
		border-color: var(--accent);
	}
	.actions {
		display: flex;
		gap: var(--space-sm);
	}
	button {
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: 0.45rem 0.65rem;
		background: var(--bg-elevated);
		color: var(--text-primary);
		font: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	button:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--accent);
	}
	button:disabled,
	input:disabled {
		opacity: 0.6;
		cursor: default;
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
