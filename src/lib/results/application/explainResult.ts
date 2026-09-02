// `explain_result` (T-1010-5): orchestrates "why this instrument?" for a
// pinned run -- looks the run up, locates the instrument among its matches
// or its rejected/truncated evaluations, and assembles a ResultExplanation
// (T-1010-3) purely from data the run already carries. Reads only: this
// file and everything it imports has no dependency on
// ScreenerEvaluationPort, ScreenerMarketData, or screener/engine/* -- AC7's
// "no silent rerun" is structurally true here, since PinnedRunStore
// (screener/ports.ts) has no `execute` member to reach in the first place.

import type { ResourceId } from '../../workbench/domain/ids';
import type { PinnedRunStore, RunNotAvailable } from '../../screener/ports';
import type { ScreenerRun } from '../../screener/run';
import {
	makeResultExplanation,
	rejectedStanding,
	resultStanding,
	type ResultExplanation
} from '../domain/explanation';
import { assembleFilterTree, assembleRanking } from '../domain/explanationAssembly';
import { boundFilterTree, boundRankingExplanation } from '../domain/explanationBound';

// AC5: an instrument this run never evaluated at all (outside its resolved
// universe) is a distinct, explicit error from AC4's "evaluated but
// rejected" -- never an empty or fabricated explanation.
export interface InstrumentNotEvaluated {
	available: false;
	runId: ResourceId;
	instrumentId: string;
	reason: 'not_in_universe';
	message: string;
}

export type ExplainResultOutcome = ResultExplanation | RunNotAvailable | InstrumentNotEvaluated;

function isRunNotAvailable(value: ScreenerRun | RunNotAvailable): value is RunNotAvailable {
	return 'available' in value;
}

// AC8's exact wording ("...and stating the screener must be run again")
// extends PinnedRunStore's own message rather than inventing a parallel
// error shape for it.
function runUnavailable(base: RunNotAvailable): RunNotAvailable {
	return {
		...base,
		message: `${base.message} Run the screener again to get a current explanation.`
	};
}

export function explainResult(
	store: PinnedRunStore,
	runId: ResourceId,
	instrumentId: string
): ExplainResultOutcome {
	const run = store.getRun(runId);
	if (isRunNotAvailable(run)) {
		return runUnavailable(run);
	}

	const match = run.matches.find((candidate) => candidate.instrumentId === instrumentId);
	const rejected = run.rejectedEvaluations[instrumentId];
	if (!match && !rejected) {
		return {
			available: false,
			runId,
			instrumentId,
			reason: 'not_in_universe',
			message:
				`Instrument "${instrumentId}" was not evaluated in run "${runId}": it was outside ` +
				`the run's resolved universe.`
		};
	}

	const evaluations = match?.nodeEvaluations ?? rejected?.nodeEvaluations ?? {};
	const filterTree = boundFilterTree(assembleFilterTree(run.filterTree, evaluations));
	const rankingExplanation = match ? assembleRanking(run, match.rankingValues) : null;

	return makeResultExplanation({
		instrumentId,
		runId: run.runId,
		screenerId: run.screenerId,
		screenerRevision: run.screenerRevision,
		filterTree,
		ranking: rankingExplanation ? boundRankingExplanation(rankingExplanation) : null,
		standing: match ? resultStanding(match.rank) : rejectedStanding(),
		provenance: run.provenance
	});
}
