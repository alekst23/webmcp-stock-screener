<script lang="ts">
	// The panel system's own surface (EPIC-1007) -- separate from
	// src/routes/+page.svelte's existing 11-tool pattern-research surface,
	// which stays untouched (T-1007-6 AC10). Workspace init and default-layout
	// seeding both happen synchronously inside registerPanelTools before this
	// component's script finishes running, so the only visible gap is the
	// brief moment while the fourteen tools finish registering against the
	// bridge -- never a blank, unseeded workspace.
	import { onMount } from 'svelte';
	import { registerPanelTools, type PanelShellRuntime } from '$lib/panels/shell/registerPanelTools';
	import PanelContainer from '$lib/panels/shell/PanelContainer.svelte';

	let runtime = $state<PanelShellRuntime | null>(null);

	onMount(() => {
		registerPanelTools().then((result) => {
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
