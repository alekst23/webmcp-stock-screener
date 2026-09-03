<script lang="ts">
	// The real watchlist panel body (T-1015-12): renders the static/dynamic
	// watchlist membership EPIC-1014's watchlist tools already produce
	// (workbench/watchlist/domain/watchlist.ts), read off whichever watchlist
	// this panel is bound to via its `source` ref (source type 'watchlist',
	// { watchlist_id }). A panel with no source bound yet (e.g. every seeded
	// default-layout watchlist panel, until a human or agent binds one) shows
	// an honest "not bound" state rather than fabricating membership -- the
	// same convention ResultsTablePanel.svelte uses for an unbound run.
	import type { PanelBodyProps } from '../../../panels/shell/panelController';
	import { readWatchlist } from '../domain/watchlist';
	import {
		getWatchlistPanelRuntimeDeps,
		type WatchlistPanelRuntimeDeps
	} from '../registry/watchlistPanelContext';

	// `deps` is not part of PanelBodyProps (PanelFrame never passes it) -- it
	// exists purely so a test can mount this component with an explicit,
	// isolated dependency set instead of the module-global registration
	// singleton, mirroring ResultsTablePanel.svelte's own test seam.
	let { panel, deps: depsOverride }: PanelBodyProps & { deps?: WatchlistPanelRuntimeDeps } =
		$props();

	// svelte-ignore state_referenced_locally
	const deps = depsOverride ?? getWatchlistPanelRuntimeDeps();

	function watchlistIdOf(): string | null {
		if (!panel.source || panel.source.type !== 'watchlist') {
			return null;
		}
		const watchlistId = panel.source.ref.watchlist_id;
		return typeof watchlistId === 'string' ? watchlistId : null;
	}

	let watchlistId = $derived(watchlistIdOf());
	let watchlist = $derived.by(() => {
		if (watchlistId === null) {
			return null;
		}
		const doc = deps.useCaseDeps.repository.get(deps.useCaseDeps.workspaceId);
		return doc ? readWatchlist(doc, watchlistId) : null;
	});
</script>

<div class="watchlist-panel">
	{#if watchlistId === null}
		<p class="empty" data-state="unbound">No watchlist is bound to this panel yet.</p>
	{:else if !watchlist}
		<p class="error" data-state="missing">Could not find watchlist "{watchlistId}".</p>
	{:else if watchlist.kind === 'dynamic'}
		<div class="dynamic" data-state="dynamic">
			<p class="dynamic-summary">
				"{watchlist.name}" follows screener {watchlist.screenerId} at revision {watchlist.screenerRevision}.
			</p>
			<p class="empty">
				Membership is defined by the screener's current results, not a fixed list.
			</p>
		</div>
	{:else if watchlist.members.length === 0}
		<p class="empty" data-state="empty">"{watchlist.name}" has no members yet.</p>
	{:else}
		<ul class="members">
			{#each watchlist.members as member (member.instrumentId)}
				<li class="member">
					<span class="instrument">{member.instrumentId}</span>
					<span class="source">{member.source.kind === 'run' ? 'from run' : 'manual'}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.watchlist-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		height: 100%;
		min-height: 0;
	}

	.members {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		overflow: auto;
		min-height: 0;
	}

	.member {
		display: flex;
		justify-content: space-between;
		gap: var(--space-sm);
		padding: var(--space-xs) var(--space-sm);
		border: 1px solid var(--separator);
		border-radius: var(--radius-sm);
		background: var(--surface);
	}

	.source {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}

	.empty {
		color: var(--text-muted);
		font-style: italic;
	}

	.error {
		color: var(--error);
		background: var(--error-bg);
		border: 1px solid var(--error);
		border-radius: var(--radius-sm);
		padding: var(--space-xs) var(--space-sm);
	}

	.dynamic-summary {
		margin: 0 0 var(--space-xs);
	}
</style>
