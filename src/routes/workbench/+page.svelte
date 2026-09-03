<script module lang="ts">
	// T-0020-9: module-scoped, not component-scoped -- this survives across
	// remounts of this same route module (SPA back/forward navigation
	// without a full reload, a future in-app link into /workbench, an
	// HMR-adjacent remount), so a second mount's onMount reuses the first
	// mount's composition instead of silently building a second, orphaned
	// one. See workbenchCompositionGuard.ts.
	import { createWorkbenchCompositionGuard } from '$lib/workbench/composition/workbenchCompositionGuard';

	const compositionGuard = createWorkbenchCompositionGuard();
</script>

<script lang="ts">
	// The panel system's own surface (EPIC-1007) -- separate from
	// src/routes/+page.svelte's existing 11-tool pattern-research surface,
	// which stays untouched (T-1007-6 AC10). Workspace init and default-layout
	// seeding both happen synchronously inside the shared composition root
	// before this component's script finishes running, so the only visible
	// gap is the brief moment while all the route's tools finish registering
	// against the bridge -- never a blank, unseeded workspace.
	//
	// T-0020-1: registerWorkbenchComposition() (called through the module's
	// compositionGuard above, T-0020-9) replaces the bare
	// registerPanelTools() call -- it builds one shared repository/revisions/
	// history/idempotency/PinnedRunStore and threads it into panel,
	// workbench-core, and screener tools alike, then returns the same
	// PanelShellRuntime this component still needs for PanelContainer.
	import { onMount } from 'svelte';
	import type { PanelShellRuntime } from '$lib/panels/shell/registerPanelTools';
	import PanelContainer from '$lib/panels/shell/PanelContainer.svelte';

	let runtime = $state<PanelShellRuntime | null>(null);

	onMount(() => {
		compositionGuard.ensure().then((result) => {
			runtime = result;
		});
	});
</script>

<svelte:head>
	<title>Workbench</title>
</svelte:head>

{#if runtime}
	<PanelContainer deps={runtime.deps} observer={runtime.observer} />
{:else}
	<p class="loading">Preparing workspace…</p>
{/if}

<style>
	.loading {
		padding: var(--space-lg);
		color: var(--text-muted);
		font-style: italic;
	}
</style>
