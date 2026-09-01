<script lang="ts">
	import { get, type Writable } from 'svelte/store';
	import type { WorkspaceState } from '../webmcp/types';
	import {
		deleteSnapshot,
		listSnapshots,
		loadSnapshot,
		saveSnapshot,
		type SnapshotSummary
	} from './snapshots';
	import { hasUnsavedChanges } from './snapshotGuard';

	let { store, onload }: { store: Writable<WorkspaceState>; onload?: () => void } = $props();

	let name = $state('');
	let snapshots = $state<SnapshotSummary[]>(listSnapshots());
	// The state as of the last save-into or load-from a snapshot this
	// session; null means neither has happened yet (spec.md's "Unsaved
	// changes" scenario -- see snapshotGuard.ts for the null semantics).
	let baseline = $state<WorkspaceState | null>(null);
	let error = $state<string | null>(null);

	function refresh(): void {
		snapshots = listSnapshots();
	}

	function save(): void {
		error = null;
		const trimmed = name.trim();
		if (!trimmed) {
			error = 'Enter a name to save the current workspace.';
			return;
		}
		const current = get(store);
		saveSnapshot(trimmed, current);
		baseline = current;
		name = '';
		refresh();
	}

	function load(snapshotName: string): void {
		error = null;
		const current = get(store);

		if (hasUnsavedChanges(current, baseline)) {
			const proceed = confirm(
				`Switching to "${snapshotName}" will discard unsaved changes in the current workspace. Continue?`
			);
			if (!proceed) {
				return;
			}
		}

		const loaded = loadSnapshot(snapshotName);
		if (!loaded) {
			error = `Workspace "${snapshotName}" no longer exists.`;
			refresh();
			return;
		}
		store.set(loaded);
		baseline = loaded;
		// The loaded snapshot's own focus/panels replace the store's, but the
		// page's separately-fetched focus detail view (keyed off the *old*
		// focus) doesn't reset itself -- without this, a snapshot whose own
		// focus.selected points at a different instance renders the previous
		// chart's data under the new focus state. Mirrors ChartToolbar's
		// existing onclear callback for the same class of stale-view problem.
		onload?.();
	}

	function remove(snapshotName: string): void {
		// Deleting never touches the live workspace or baseline (epic AC5),
		// even if the live workspace was originally loaded from this snapshot.
		deleteSnapshot(snapshotName);
		refresh();
	}
</script>

<details class="snapshot-picker">
	<summary>
		Workspaces {snapshots.length ? `(${snapshots.length})` : '(none saved)'}
	</summary>

	<div class="save-row">
		<label>
			<span>Workspace name</span>
			<input bind:value={name} placeholder="e.g. gap-fade-research" />
		</label>
		<button type="button" onclick={save}>Save workspace</button>
	</div>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if snapshots.length}
		<ul>
			{#each snapshots as snapshot (snapshot.name)}
				<li>
					<button type="button" class="load" onclick={() => load(snapshot.name)}>
						{snapshot.name}
					</button>
					<span class="saved-at">{new Date(snapshot.savedAt).toLocaleString()}</span>
					<button
						type="button"
						class="delete"
						aria-label={`Delete workspace ${snapshot.name}`}
						onclick={() => remove(snapshot.name)}
					>
						Delete
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">No saved workspaces yet.</p>
	{/if}
</details>

<style>
	.snapshot-picker {
		margin: 0.5rem 0 0.75rem;
		padding: 0.3rem 0;
		border-top: 1px solid #ddd;
		border-bottom: 1px solid #ddd;
	}
	summary {
		cursor: pointer;
		font-size: 0.85rem;
		color: #555;
		user-select: none;
	}
	.snapshot-picker[open] summary {
		margin-bottom: 0.4rem;
	}
	.save-row {
		display: flex;
		gap: 0.4rem;
		align-items: end;
		margin-top: 0.4rem;
	}
	label {
		display: grid;
		gap: 0.15rem;
		font-size: 0.8rem;
		color: #555;
		flex: 1;
	}
	input {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #bbb;
		border-radius: 4px;
		padding: 0.3rem 0.45rem;
		font: inherit;
		color: #111;
	}
	button {
		border: 1px solid #999;
		border-radius: 4px;
		padding: 0.3rem 0.55rem;
		background: #fff;
		color: #111;
		font: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.2rem;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.load {
		flex: 1;
		text-align: left;
	}
	.saved-at {
		font-size: 0.75rem;
		color: #666;
		white-space: nowrap;
	}
	.empty {
		margin: 0;
		font-size: 0.85rem;
		color: #666;
	}
	.error {
		margin: 0;
		color: #b00;
	}
</style>
