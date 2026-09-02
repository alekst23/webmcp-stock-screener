// Pure prev/next page-cursor bookkeeping (AC5): getScreenerResults only
// ever hands back a forward cursor (nextCursor), so "previous page" is this
// module's own history stack, not a capability the read use case provides.
// Kept pure and separate from ResultsTablePanel.svelte so the paging state
// machine is unit-testable without mounting a component or a PinnedRunStore.
export interface PaginationState {
	// cursors[0] is always undefined (the first page); cursors[i] for i > 0
	// is the cursor that produced the (i+1)th page actually visited.
	cursors: (string | undefined)[];
	index: number;
}

export function initialPagination(): PaginationState {
	return { cursors: [undefined], index: 0 };
}

export function currentCursor(state: PaginationState): string | undefined {
	return state.cursors[state.index];
}

// Advances to the next page. `nextCursor` is the outcome's own nextCursor
// (null on the last page, in which case this is a no-op -- there is no next
// page to advance to). Revisiting an already-seen next page (the person
// paged forward, back, then forward again) reuses the recorded cursor
// rather than appending a duplicate.
export function goToNextPage(state: PaginationState, nextCursor: string | null): PaginationState {
	if (nextCursor === null) {
		return state;
	}
	const atFrontier = state.index === state.cursors.length - 1;
	const cursors = atFrontier ? [...state.cursors, nextCursor] : state.cursors;
	return { cursors, index: state.index + 1 };
}

export function goToPreviousPage(state: PaginationState): PaginationState {
	if (state.index === 0) {
		return state;
	}
	return { ...state, index: state.index - 1 };
}
