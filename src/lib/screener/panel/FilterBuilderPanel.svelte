<script lang="ts">
	// The real filter_builder panel body (T-0027-1): a read-only mirror of
	// the workspace's current screener (WorkspaceDocument.screenerId), using
	// the same document-read + observer-notify pattern every other panel
	// body already uses (PanelContainer.svelte's own refresh() re-mounts
	// every body with fresh `panel` prop data on each notify -- see
	// ResultsTablePanel.svelte for the established precedent this follows).
	// No controls that mutate the screener (AC4): redefinition stays
	// agent-driven only for MVP (docs/design/screener-core/spec.md's
	// amendment, "Non-Goal (added)").
	import type { PanelBodyProps } from '../../panels/shell/panelController';
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
</script>

{#if screener === null}
	<p class="empty">No screener yet.</p>
{:else}
	<div class="filter-builder-panel">
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
	</div>
{/if}

<style>
	.filter-builder-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		height: 100%;
		min-height: 0;
		overflow: auto;
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
