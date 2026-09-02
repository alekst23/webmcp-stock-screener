<script lang="ts">
	// The ticker/universe filter used to be a fixed-width field in
	// ChartToolbar (hotfix/terminal-ui-theme). The header has far less room to
	// spare, so it now lives here as a collapsed control that expands on
	// demand -- see docs/design/terminal-ui-theme/spec.md's "Expandable
	// header search". Parsing and its effect on the next "Show monthly" stay
	// in ChartToolbar/tickerSearch.ts; this component only owns where the
	// value is typed.
	let {
		value = $bindable(''),
		label = 'Tickers'
	}: {
		value?: string;
		label?: string;
	} = $props();

	let expanded = $state(false);
	let container = $state<HTMLElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	function expand(): void {
		expanded = true;
		// The input doesn't exist until the {#if} above renders it, so
		// focusing has to wait a tick rather than happening inline here.
		queueMicrotask(() => input?.focus());
	}

	function collapse(): void {
		expanded = false;
	}

	// Collapsing must never clear `value` -- a ticker list the researcher
	// already typed has to survive the control folding back up, whether that
	// happens by Escape or by focus simply moving elsewhere.
	function handleFocusOut(event: FocusEvent): void {
		const next = event.relatedTarget;
		if (next instanceof Node && container?.contains(next)) {
			return;
		}
		collapse();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') {
			return;
		}
		collapse();
		(event.currentTarget as HTMLElement).blur();
	}
</script>

<div class="ticker-search" class:expanded bind:this={container} onfocusout={handleFocusOut}>
	{#if expanded}
		<label class="expanded-field">
			<span class="visually-hidden">{label}</span>
			<input
				class="field"
				bind:value
				bind:this={input}
				onkeydown={handleKeydown}
				placeholder="e.g. MOCK02, MOCK03"
				aria-label={label}
			/>
		</label>
	{:else}
		<button
			type="button"
			class="control search-toggle"
			onclick={expand}
			aria-label={value ? `${label}: ${value}` : `Expand ${label} search`}
			aria-expanded="false"
		>
			<span class="icon" aria-hidden="true">⌕</span>
			{#if value}
				<span class="summary">{value}</span>
			{/if}
		</button>
	{/if}
</div>

<style>
	.ticker-search {
		display: inline-flex;
		align-items: center;
	}

	.search-toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xs);
		max-width: 16rem;
	}

	.icon {
		font-size: var(--font-size-md);
		line-height: 1;
	}

	.summary {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
	}

	.expanded-field {
		display: block;
	}

	.expanded-field input {
		width: 14rem;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
