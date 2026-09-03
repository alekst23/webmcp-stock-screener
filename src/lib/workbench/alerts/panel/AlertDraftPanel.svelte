<script lang="ts">
	// The real alert_draft panel body (T-1015-12): renders every alert record
	// currently in the 'draft' state (workbench/alerts/domain/alert.ts /
	// alertStateMachine.ts) -- a drafted alert pending review, in this
	// ticket's own wording. Not source-bound (see alertDraftPanelKind.ts): it
	// always reads the active workspace's current draft alerts rather than one
	// bound record, the same "read straight off deps.useCaseDeps" shape
	// WatchlistPanel.svelte uses once it has resolved which watchlist to read.
	import type { PanelBodyProps } from '../../../panels/shell/panelController';
	import { readAlerts } from '../domain/alert';
	import { isDraft } from '../domain/alertStateMachine';
	import {
		getAlertDraftPanelRuntimeDeps,
		type AlertDraftPanelRuntimeDeps
	} from '../registry/alertDraftPanelContext';

	// `deps` is not part of PanelBodyProps (PanelFrame never passes it) -- it
	// exists purely so a test can mount this component with an explicit,
	// isolated dependency set instead of the module-global registration
	// singleton, mirroring ResultsTablePanel.svelte's own test seam.
	let { deps: depsOverride }: PanelBodyProps & { deps?: AlertDraftPanelRuntimeDeps } = $props();

	// svelte-ignore state_referenced_locally
	const deps = depsOverride ?? getAlertDraftPanelRuntimeDeps();

	let drafts = $derived.by(() => {
		const doc = deps.useCaseDeps.repository.get(deps.useCaseDeps.workspaceId);
		if (!doc) {
			return [];
		}
		return readAlerts(doc).filter((alert) => isDraft(alert.state));
	});

	function sourceLabel(alert: (typeof drafts)[number]): string {
		return alert.source.kind === 'screener_revision'
			? `screener ${alert.source.screenerId} rev ${alert.source.screenerRevision}`
			: `${alert.source.conditions.length} condition(s)`;
	}
</script>

<div class="alert-draft-panel">
	{#if drafts.length === 0}
		<p class="empty" data-state="empty">No alert drafts are pending review.</p>
	{:else}
		<ul class="drafts">
			{#each drafts as alert (alert.alertId)}
				<li class="draft">
					<div class="draft-header">
						<span class="name">{alert.name || alert.alertId}</span>
						<span class="badge" data-previewable={alert.previewable}>
							{alert.previewable ? 'previewable' : 'not previewable'}
						</span>
					</div>
					<p class="source">{sourceLabel(alert)}</p>
					{#if alert.previewProblems.length > 0}
						<ul class="problems">
							{#each alert.previewProblems as problem (problem)}
								<li>{problem}</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.alert-draft-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		height: 100%;
		min-height: 0;
	}

	.drafts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		overflow: auto;
		min-height: 0;
	}

	.draft {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		padding: var(--space-xs) var(--space-sm);
		border: 1px solid var(--separator);
		border-radius: var(--radius-sm);
		background: var(--surface);
	}

	.draft-header {
		display: flex;
		justify-content: space-between;
		gap: var(--space-sm);
	}

	.name {
		font-weight: 600;
	}

	.badge {
		font-size: var(--font-size-sm);
		color: var(--text-muted);
	}

	.source {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}

	.problems {
		margin: 0;
		padding-left: var(--space-md);
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}

	.empty {
		color: var(--text-muted);
		font-style: italic;
	}
</style>
