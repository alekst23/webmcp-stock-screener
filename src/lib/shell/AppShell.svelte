<script lang="ts">
	import type { Snippet } from 'svelte';

	// Layout only -- no store access, no fetching, no business logic. The
	// three regions come from docs/design/terminal-ui-theme/spec.md's
	// "A persistent shell"; `log` is a distinct region rather than just the
	// last child so the "log stays at the bottom" guarantee is structural
	// instead of incidental.
	let {
		topBar,
		children,
		log
	}: {
		topBar: Snippet;
		children: Snippet;
		log: Snippet;
	} = $props();
</script>

<div class="app-shell">
	<header class="top-bar">{@render topBar()}</header>
	<main class="work-area">{@render children()}</main>
	<footer class="log-region">{@render log()}</footer>
</div>

<style>
	.app-shell {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		min-height: 100vh;
		background: var(--bg-app);
	}

	/* Sticky rather than a fixed-height frame: identity and session status
	   stay in view while the work area scrolls, without trapping the page in
	   an inner scroller at small heights. */
	.top-bar {
		position: sticky;
		top: 0;
		/* Menus anchored inside the top bar stack above this (+page.svelte's
		   .tool-menu uses 20); lowering it would clip them behind the header. */
		z-index: 10;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm) var(--space-lg);
		min-height: 2.75rem;
		padding: var(--space-xs) var(--space-lg);
		background: var(--bg-panel);
		border-bottom: 1px solid var(--border);
	}

	.work-area {
		min-width: 0;
		padding: var(--space-lg);
	}

	.log-region {
		min-width: 0;
		padding: var(--space-md) var(--space-lg) var(--space-lg);
		background: var(--bg-panel);
		border-top: 1px solid var(--border);
	}

	@media (max-width: 680px) {
		.top-bar,
		.work-area,
		.log-region {
			padding-left: var(--space-md);
			padding-right: var(--space-md);
		}
	}
</style>
