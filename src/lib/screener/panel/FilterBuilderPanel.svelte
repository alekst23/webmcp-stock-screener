<script lang="ts">
	// The real filter_builder panel body (T-0027-1): a read-only mirror of
	// the workspace's current screener (WorkspaceDocument.screenerId), using
	// the same document-read + observer-notify pattern every other panel
	// body already uses (PanelContainer.svelte's own refresh() re-mounts
	// every body with fresh `panel` prop data on each notify -- see
	// ResultsTablePanel.svelte for the established precedent this follows).
	// No controls that mutate the screener DEFINITION (AC4 of T-0027-1):
	// redefinition stays agent-driven only for MVP (docs/design/screener-core/
	// spec.md's amendment, "Non-Goal (added)"). T-0020-11's "Run" control
	// below is exempt from that non-goal by design -- it's scoped to
	// *running* the existing definition, not editing it (see that ticket's
	// own Goal section).
	import type { PanelBodyProps } from '../../panels/shell/panelController';
	import { runScreenerByHuman } from '../../panels/shell/panelController';
	import { readScreener } from '../state';
	import { summarizeFilterTree, summarizeRanking, summarizeUniverse } from './filterTreeSummary';
	import {
		getFilterBuilderPanelRuntimeDeps,
		type FilterBuilderPanelRuntimeDeps
	} from './filterBuilderPanelContext';

	// `deps` is not part of PanelBodyProps (PanelFrame never passes it) --
	// it exists purely so a test can mount this component with an explicit,
	// isolated dependency set instead of the module-global registration
	// singleton, mirroring ResultsTablePanel.svelte's own `deps` override.
	let { deps: depsOverride }: PanelBodyProps & { deps?: FilterBuilderPanelRuntimeDeps } = $props();

	// Deliberately a one-time snapshot, not a reactive read: a panel's
	// runtime dependency set does not change for the lifetime of a mounted
	// panel instance (see ResultsTablePanel.svelte's identical comment).
	// svelte-ignore state_referenced_locally
	const deps = depsOverride ?? getFilterBuilderPanelRuntimeDeps();

	// A fresh read on every mount -- PanelContainer.svelte re-mounts every
	// panel body from a fresh readSnapshot() on each observer notification
	// (AC3: "the panel's content updates on the next observer notify -- no
	// manual refresh, no stale content"), so a plain top-level read here is
	// enough; no subscription of its own is needed.
	const doc = deps.useCaseDeps.repository.get(deps.useCaseDeps.workspaceId);
	const screener = doc && doc.screenerId ? readScreener(doc, doc.screenerId) : null;

	let universeLines = $derived(screener ? summarizeUniverse(screener.universe) : []);
	let filterLines = $derived(screener ? summarizeFilterTree(screener.filterTree) : []);
	let rankingLine = $derived(screener ? summarizeRanking(screener.ranking) : '');

	// T-0020-11: local-only UI state, never a workspace mutation -- mirrors
	// this codebase's existing "local component state" convention for
	// non-persistent UI affordances (PanelContainer.svelte's own
	// `linkedValues`). The actual guard against a second concurrent run is
	// panelController.ts's own single-flight promise cache (runScreenerByHuman
	// is safe to call twice regardless); this flag only drives the
	// disabled/spinner affordance the AC also asks for.
	let running = $state(false);

	// Explains why the control is disabled, or null when it's enabled --
	// covers both AC states (no screener defined; a run is already in
	// flight) with one derived value the markup below reads for both the
	// `disabled` attribute and the tooltip.
	let disabledReason = $derived(
		!screener
			? 'Define a screener before it can be run.'
			: running
				? 'A run is already in progress.'
				: null
	);

	async function handleRun(): Promise<void> {
		if (disabledReason || !deps.run) {
			return;
		}
		const run = deps.run;
		running = true;
		try {
			await runScreenerByHuman({
				useCaseDeps: deps.useCaseDeps,
				evaluationPort: run.evaluationPort,
				runStore: run.runStore
			});
		} finally {
			running = false;
			// Notified regardless of outcome (success, refusal, or an
			// evaluation-port error): mirrors PanelContainer.svelte's own
			// handlers, which always refresh() after calling a human action --
			// rendering derives entirely from a fresh read, so a no-op mutation
			// (e.g. a refusal that stored nothing) just re-renders unchanged
			// state.
			run.observer.notify();
		}
	}
</script>

<div class="filter-builder-panel">
	<div class="toolbar">
		<button
			type="button"
			class="run-button"
			disabled={disabledReason !== null || !deps.run}
			title={disabledReason ?? undefined}
			onclick={handleRun}
		>
			{running ? 'Running…' : 'Run'}
		</button>
	</div>
	{#if screener === null}
		<p class="empty">No screener yet.</p>
	{:else}
		<section>
			<h4>Universe</h4>
			<ul>
				{#each universeLines as line (line)}
					<li>{line}</li>
				{/each}
			</ul>
		</section>
		<section>
			<h4>Filters</h4>
			<ul class="filter-tree">
				{#each filterLines as line, index (index)}
					<li style={`padding-left: calc(${line.depth} * var(--space-sm));`}>{line.text}</li>
				{/each}
			</ul>
		</section>
		<section>
			<h4>Ranking &amp; limit</h4>
			<p>{rankingLine}</p>
		</section>
	{/if}
</div>

<style>
	.filter-builder-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		height: 100%;
		min-height: 0;
		overflow: auto;
	}

	.toolbar {
		display: flex;
		justify-content: flex-end;
		flex: 0 0 auto;
	}

	.run-button {
		flex: 0 0 auto;
	}

	h4 {
		margin: 0 0 var(--space-xs) 0;
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.filter-tree li {
		font-variant-numeric: tabular-nums;
	}

	p {
		margin: 0;
	}

	.empty {
		color: var(--text-muted);
		font-style: italic;
	}
</style>
