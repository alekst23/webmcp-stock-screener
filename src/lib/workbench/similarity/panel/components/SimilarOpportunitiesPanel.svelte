<script lang="ts">
	// The `similar_opportunities` panel kind: a ranked, selectable list of a
	// similarity run's candidates, each showing its score and the feature
	// families that drove it (T-1012-6).
	//
	// Every prop is optional: PanelFrame.svelte's real-component branch
	// currently mounts a real component with no props or context at all (see
	// this ticket's Solution Approach), so this renders its "no run bound"
	// state until that wiring exists. Selecting a candidate is reported
	// through `onSelectCandidate` rather than mutated locally -- the panel
	// system's existing `set_panel_selection` operation is what makes a
	// selection readable as workspace state (AC4), and this component does
	// not reach into workspace mutation itself.
	import type { SimilarityCandidate, SimilarityRun } from '../../domain/contract';
	import {
		emptyRunMessage,
		formatNormalization,
		formatProvenance,
		formatScore,
		rankCandidates,
		topContributingFamilies
	} from '../domain/presentation';

	let {
		run = null,
		selectedCandidateId = null,
		onSelectCandidate
	}: {
		run?: SimilarityRun | null;
		selectedCandidateId?: string | null;
		onSelectCandidate?: (candidateId: string) => void;
	} = $props();

	const ranked = $derived(run ? rankCandidates(run) : []);
	const emptyMessage = $derived(run ? emptyRunMessage(run) : null);
	const provenanceLines = $derived(run ? formatProvenance(run.provenance) : []);
	const normalizationLine = $derived(run ? formatNormalization(run.normalization) : null);

	function candidateFamilies(candidate: SimilarityCandidate): string[] {
		if (!run) {
			return [];
		}
		return topContributingFamilies(candidate, run.weights).map((f) => f.replace('_', ' '));
	}

	function select(candidateId: string): void {
		onSelectCandidate?.(candidateId);
	}
</script>

<div class="similar-opportunities">
	{#if !run}
		<p class="empty" data-state="unbound">No similarity run is bound to this panel yet.</p>
	{:else if emptyMessage}
		<p class="empty" data-state="empty-run">{emptyMessage}</p>
	{:else}
		<ul class="candidates">
			{#each ranked as candidate (candidate.candidateId)}
				<li>
					<button
						type="button"
						class="candidate"
						aria-pressed={candidate.candidateId === selectedCandidateId}
						onclick={() => select(candidate.candidateId)}
					>
						<span class="symbol">{candidate.instrument.symbol}</span>
						<span class="window">{candidate.window.start} – {candidate.window.end}</span>
						<span class="score">{formatScore(candidate.score)}</span>
						<span class="families">
							{#each candidateFamilies(candidate) as family (family)}
								<span class="family-chip">{family}</span>
							{/each}
							{#each candidate.unavailableFamilies as family (family)}
								<span class="family-chip unavailable">{family.replace('_', ' ')} unavailable</span>
							{/each}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if run}
		<footer class="provenance">
			<p class="normalization">Normalization: {normalizationLine}</p>
			<ul>
				{#each provenanceLines as line (line)}
					<li>{line}</li>
				{/each}
			</ul>
		</footer>
	{/if}
</div>

<style>
	.similar-opportunities {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		height: 100%;
		min-height: 0;
	}

	.empty {
		color: var(--text-muted);
		font-style: italic;
	}

	.candidates {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		overflow: auto;
		min-height: 0;
	}

	.candidate {
		width: 100%;
		text-align: left;
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: var(--space-xs);
		border: 1px solid var(--separator);
		border-radius: var(--radius-sm);
		padding: var(--space-xs) var(--space-sm);
		background: var(--surface);
		cursor: pointer;
	}

	.candidate[aria-pressed='true'] {
		border-color: var(--accent);
	}

	.families {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
	}

	.family-chip {
		font-size: var(--font-size-sm);
		padding: 0 var(--space-xs);
		border-radius: var(--radius-sm);
		background: var(--surface-muted);
	}

	.family-chip.unavailable {
		color: var(--text-muted);
		font-style: italic;
	}

	.provenance {
		flex: 0 0 auto;
		border-top: 1px solid var(--separator);
		padding-top: var(--space-xs);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}

	.provenance ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-sm);
	}

	.normalization {
		margin: 0 0 var(--space-xs);
	}
</style>
