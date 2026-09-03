<script lang="ts">
	// The real `chart` panel kind's body (bug fix, see git history): fetches
	// this panel's bounded slice of bars/studies through the real,
	// already-built chart engine (readChartData) and hands the result to
	// ChartPanel.svelte, which itself stays a pure function of props (its own
	// header comment) -- this wrapper is where the fetch policy lives.
	//
	// ChartPanel.svelte needs `workspace: WorkspaceDocument` and
	// `data: ChartDataResult | null` as props; PanelBodyProps only ever gives
	// a real body `panel`/`linkedValue`/`onBroadcast` (panelController.ts),
	// so both are read here off the runtime-deps singleton
	// (chart/registry/chartPanelContext.ts) the same way ResultsTablePanel.svelte
	// and WatchlistPanel.svelte already read theirs.
	//
	// When readChartData refuses (no instrument bound yet, workspace/panel
	// gone, window issues, ...), its own `refusal.message` is shown verbatim
	// rather than a second, hand-written copy -- that message already says
	// "Chart panel ... has no instrument, so it has no bars to read" for the
	// common "nothing bound yet" case, which is what PlaceholderPanelBody's
	// generic (and, for chart, misleading) "no screener run yet" text is
	// being replaced with.
	import type { PanelBodyProps } from '../../../panels/shell/panelController';
	import { readChartData, type ChartDataOutcome } from '../application/chartData';
	import {
		getChartPanelRuntimeDeps,
		type ChartPanelRuntimeDeps
	} from '../registry/chartPanelContext';
	import ChartPanel from '../components/ChartPanel.svelte';

	// `deps` is not part of PanelBodyProps (PanelFrame never passes it) -- it
	// exists purely so a test can mount this component with an explicit,
	// isolated dependency set instead of the module-global registration
	// singleton, mirroring ResultsTablePanel.svelte's and WatchlistPanel.svelte's
	// own test seam.
	let { panel, deps: depsOverride }: PanelBodyProps & { deps?: ChartPanelRuntimeDeps } = $props();

	// Deliberately a one-time snapshot, not a reactive read: a panel's
	// runtime dependency set does not change for the lifetime of a mounted
	// panel instance.
	// svelte-ignore state_referenced_locally
	const deps = depsOverride ?? getChartPanelRuntimeDeps();

	let outcome = $state<ChartDataOutcome | null>(null);
	let loadFailed = $state<string | null>(null);

	// Guards a stale response from landing after a newer request started
	// (the panel's bound source/config changed while the previous read was
	// still in flight) -- only the result of the most recently started read
	// is ever applied.
	let requestId = 0;

	$effect(() => {
		// Re-run whenever what the read depends on changes: which panel, and
		// what it's bound to / configured as (both live outside this
		// component's own state, on the workspace document).
		const panelId = panel.id;
		const workspaceId = deps.useCaseDeps.workspaceId;
		// Establishes the dependency on source/config for $effect's own
		// tracking; the values themselves aren't used beyond that.
		void JSON.stringify(panel.source);
		void JSON.stringify(panel.config);

		const thisRequest = ++requestId;
		loadFailed = null;

		readChartData(
			{
				repository: deps.useCaseDeps.repository,
				series: deps.series,
				clock: deps.useCaseDeps.clock,
				...(deps.catalog !== undefined ? { registry: deps.catalog } : {})
			},
			{ panelId, workspaceId }
		)
			.then((result) => {
				if (thisRequest === requestId) {
					outcome = result;
				}
			})
			.catch((err: unknown) => {
				if (thisRequest === requestId) {
					loadFailed = err instanceof Error ? err.message : String(err);
				}
			});
	});

	const workspace = $derived(deps.useCaseDeps.repository.get(deps.useCaseDeps.workspaceId));
	const data = $derived(outcome?.ok ? outcome.data : null);
</script>

<div class="chart-panel-body">
	{#if !workspace}
		<p class="empty" data-state="no-workspace">
			The workspace this chart belongs to could not be found.
		</p>
	{:else if loadFailed}
		<p class="error" data-state="load-failed">{loadFailed}</p>
	{:else if outcome && !outcome.ok}
		<p class="empty" data-state={outcome.refusal.reason}>{outcome.refusal.message}</p>
	{:else}
		<ChartPanel {workspace} panelId={panel.id} {data} />
	{/if}
</div>

<style>
	.chart-panel-body {
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.empty {
		color: var(--text-muted);
		font-style: italic;
		margin: 0;
		padding: var(--space-sm);
	}

	.error {
		color: var(--error);
		background: var(--error-bg);
		border: 1px solid var(--error);
		border-radius: var(--radius-sm);
		margin: 0;
		padding: var(--space-xs) var(--space-sm);
	}
</style>
