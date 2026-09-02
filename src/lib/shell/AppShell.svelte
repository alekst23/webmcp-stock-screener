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
