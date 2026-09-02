// Pure discrimination of getScreenerResults's four-way outcome union
// (T-1010-4), factored out so ResultsTablePanel.svelte and renderState.ts
// both branch on it the same way, and so the branching itself is
// unit-testable without a PinnedRunStore or a mounted component.
import type { GetScreenerResultsOutcome } from '../application/getScreenerResults';
import type { ProjectedResultsPage } from '../domain/projection';
import type { CursorRejected, PageSizeRejected } from '../domain/page';
import type { RunNotAvailable } from '../../screener/ports';

export function isRunNotAvailable(outcome: GetScreenerResultsOutcome): outcome is RunNotAvailable {
	return 'available' in outcome && outcome.available === false;
}

export function isRejectedRequest(
	outcome: GetScreenerResultsOutcome
): outcome is PageSizeRejected | CursorRejected {
	return 'rejected' in outcome && outcome.rejected === true;
}

export function isProjectedPage(
	outcome: GetScreenerResultsOutcome
): outcome is ProjectedResultsPage {
	return !isRunNotAvailable(outcome) && !isRejectedRequest(outcome);
}
