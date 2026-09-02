<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { themeCss } from '$lib/theme/tokens';

	let { children } = $props();

	// Emitted from the same constants the contrast tests measure, so the
	// asserted palette and the painted palette cannot drift apart. This is the
	// only shared ancestor of every route, so injecting here is what makes the
	// treatment global without each route opting in.
	const rootVars = `<style>${themeCss()}</style>`;
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	{@html rootVars}
</svelte:head>

{@render children()}

<style>
	/* color-scheme is declared in app.html instead: it has to apply before
	   any JS runs, and repeating it here would be a second place to forget. */
	:global(html) {
		background: var(--bg-app);
	}

	:global(body) {
		margin: 0;
		background: var(--bg-app);
		color: var(--text-primary);
		font-family: var(--font-ui);
		font-size: var(--font-size-md);
		line-height: 1.45;
		-webkit-font-smoothing: antialiased;
	}

	:global(h1, h2, h3, h4) {
		color: var(--text-primary);
		font-weight: 600;
		letter-spacing: var(--tracking-heading);
	}

	:global(a) {
		color: var(--accent);
		text-decoration: none;
	}

	:global(a:hover) {
		color: var(--accent-hover);
		text-decoration: underline;
	}

	/* Numerics are the point of this interface: monospaced and tabular so
	   digits line up column-wise across rows. */
	:global(code, pre, time) {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	:global(code) {
		color: var(--text-secondary);
	}

	:global(input, button, textarea, select) {
		font-family: inherit;
	}

	/* Two idioms the components had been copying by hand -- the panel card in
	   seven style blocks, the outlined control in six with four different
	   ad-hoc paddings -- and had already started to diverge. They live here
	   because shared element styling is what this block already owns. */
	:global(.panel-card) {
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--space-md);
	}

	:global(.control),
	:global(.field) {
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-xs) var(--space-sm);
		background: var(--bg-elevated);
		color: var(--text-primary);
		font: inherit;
	}

	:global(.control) {
		cursor: pointer;
		white-space: nowrap;
	}

	/* One hover treatment for every control: the sites had split between
	   brightening the boundary and recolouring the text, so the same gesture
	   meant two different things depending on which component you were in. */
	:global(.control:hover:not(:disabled)) {
		background: var(--bg-hover);
		border-color: var(--accent);
		color: var(--text-primary);
	}

	:global(.field:hover:not(:disabled)) {
		border-color: var(--accent);
	}

	:global(.control:disabled),
	:global(.field:disabled) {
		opacity: 0.6;
		cursor: default;
	}

	/* Density must not cost reachability: one visible focus treatment for
	   every control, everywhere. */
	:global(:focus-visible) {
		outline: 2px solid var(--focus-ring);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	:global(::selection) {
		background: var(--accent);
		color: var(--text-on-accent);
	}

	:global(::-webkit-scrollbar) {
		width: 10px;
		height: 10px;
	}

	:global(::-webkit-scrollbar-track) {
		background: var(--bg-app);
	}

	:global(::-webkit-scrollbar-thumb) {
		background: var(--border);
		border-radius: var(--radius-sm);
	}

	:global(::-webkit-scrollbar-thumb:hover) {
		background: var(--border-strong);
	}
</style>
