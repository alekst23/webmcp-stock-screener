// Pure "what should this panel currently show" decision (AC10, AC11),
// factored out of ResultsTablePanel.svelte so every branch -- unbound,
// loading, a caught read exception, a rejected page-size/cursor, an
// unavailable (expired/unknown) run, a genuinely empty run, and a real page
// -- is unit-testable without mounting a component. Precedence is
// deliberate: an unbound source always wins (there is nothing to load yet),
// then a caught exception (AC11's "read failed"), then "no read attempted
// yet" (AC11's "still loading"), then the outcome's own shape (AC10).
import { isProjectedPage, isRejectedRequest, isRunNotAvailable } from './outcome';
import type { GetScreenerResultsOutcome } from '../application/getScreenerResults';
import type { ProjectedResultsPage } from '../domain/projection';

export type ResultsPanelRenderState =
	| { kind: 'unbound' }
	| { kind: 'loading' }
	| { kind: 'error'; message: string }
	| { kind: 'unavailable'; message: string }
	| { kind: 'empty'; page: ProjectedResultsPage }
	| { kind: 'ready'; page: ProjectedResultsPage };

export interface ComputeRenderStateInput {
	runId: string | null;
	outcome: GetScreenerResultsOutcome | null;
	readFailed: string | null;
}

// AC8's exact wording lives in explainResult.ts's runUnavailable helper;
// this is the same suffix, reused here rather than re-worded, so an
// unavailable run reads identically whether the person hit it by reading a
// page or opening an explanation.
const RUN_AGAIN_SUFFIX = ' Run the screener again to see current results.';

export function computeRenderState(input: ComputeRenderStateInput): ResultsPanelRenderState {
	if (input.runId === null) {
		return { kind: 'unbound' };
	}
	if (input.readFailed !== null) {
		return { kind: 'error', message: input.readFailed };
	}
	if (input.outcome === null) {
		return { kind: 'loading' };
	}
	if (isRejectedRequest(input.outcome)) {
		return { kind: 'error', message: input.outcome.message };
	}
	if (isRunNotAvailable(input.outcome)) {
		return { kind: 'unavailable', message: `${input.outcome.message}${RUN_AGAIN_SUFFIX}` };
	}
	if (isProjectedPage(input.outcome) && input.outcome.total === 0) {
		return { kind: 'empty', page: input.outcome };
	}
	return { kind: 'ready', page: input.outcome as ProjectedResultsPage };
}
