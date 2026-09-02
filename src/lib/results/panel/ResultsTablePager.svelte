<script lang="ts">
	// AC5: requests the next/previous page and shows the total result count.
	// Never calls anything but the two callbacks its parent wires to
	// getScreenerResults -- this component holds no PinnedRunStore reference
	// and cannot trigger a screener run even by mistake.
	let {
		offset,
		rowCount,
		total,
		canGoPrevious,
		canGoNext,
		onPrevious,
		onNext
	}: {
		offset: number;
		rowCount: number;
		total: number;
		canGoPrevious: boolean;
		canGoNext: boolean;
		onPrevious: () => void;
		onNext: () => void;
	} = $props();

	let rangeLabel = $derived(
		total === 0 ? '0 of 0' : `${offset + 1}–${offset + rowCount} of ${total}`
	);
</script>

<div class="pager">
	<button type="button" class="control" disabled={!canGoPrevious} onclick={onPrevious}>
		Previous
	</button>
	<span class="range">{rangeLabel}</span>
	<button type="button" class="control" disabled={!canGoNext} onclick={onNext}> Next </button>
</div>

<style>
	.pager {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		font-size: var(--font-size-sm);
	}

	.range {
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
</style>
