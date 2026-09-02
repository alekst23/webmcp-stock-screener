// The refine_similarity_search use case (T-1014-4): reads a completed
// similarity run, turns accepted/rejected match ids into adjusted feature
// weights, re-searches with them, and rebinds the `similar_opportunities`
// panel bound to the source run onto the new one.
//
// Follows this epic's own established house style for "a similarity-related
// mutation" -- `compareSetups.ts` (T-1012-7) already writes its payload (a
// comparison view) onto the `similar_opportunities` panel bound to a run
// rather than inventing a parallel workspace-doc extension, and reuses
// `commitPanelChange`/`findPanel` to do it. This use case does the same:
// the workspace mutation IS the panel's `config.runId` moving from the
// source run to the refined one. Nothing about a run or its weights is ever
// mutated in place, so undoing that one write is what makes AC10's "restores
// the previous weights exactly" hold -- the source run, untouched, is
// exactly what the panel resolves back to.
import type { MutationContext, MutationEnvelope } from '../../../domain/mutation';
import {
	PanelOperationError,
	type PanelSystemState,
	type PanelUseCaseDeps
} from '../../../../panels/application';
import { commitPanelChange, findPanel } from '../../../../panels/application/support';
import type { Panel } from '../../../../panels/domain/panel';
import { readCapturedSetup } from '../../../chart/domain/capturedSetup';
import type { SimilarityApiPort } from '../../domain/apiPort';
import { FEATURE_FAMILIES, type SimilarityRun } from '../../domain/contract';
import { refineWeights, validateFeedback, type WeightChange } from '../domain/refinement';

const SIMILAR_OPPORTUNITIES_KIND = 'similar_opportunities';

export interface RefineSimilaritySearchDeps extends PanelUseCaseDeps {
	api: SimilarityApiPort;
}

export interface RefineSimilaritySearchRequest {
	context: MutationContext;
	requestInput: unknown;
	runId: string;
	acceptedMatchIds: readonly string[];
	rejectedMatchIds: readonly string[];
	panelId?: string;
}

export interface RefineSimilaritySearchResult {
	envelope: MutationEnvelope;
	panelId: string;
	sourceRun: SimilarityRun;
	refinedRun: SimilarityRun;
	changes: WeightChange[];
}

// Mirrors `compareSetups.ts`'s own `findBoundPanel`: an actionable,
// specific failure (naming the run) rather than a generic "unknown panel"
// when no explicit `panel_id` was given and none is bound.
function findBoundPanel(state: PanelSystemState, runId: string): Panel {
	const panel = state.panels.find(
		(p) =>
			p.kind === SIMILAR_OPPORTUNITIES_KIND && (p.config as { runId?: unknown }).runId === runId
	);
	if (!panel) {
		throw new PanelOperationError(
			'unknown_panel',
			`No similar_opportunities panel is bound to run "${runId}". Pass an explicit panel_id, ` +
				'or bind one first with find_similar_setups.',
			{ runId }
		);
	}
	return panel;
}

function resolveTargetPanel(state: PanelSystemState, runId: string, panelId?: string): Panel {
	if (!panelId) {
		return findBoundPanel(state, runId);
	}
	const panel = findPanel(state, panelId);
	if (panel.kind !== SIMILAR_OPPORTUNITIES_KIND) {
		throw new PanelOperationError(
			'invalid_config',
			`Panel "${panelId}" is kind "${panel.kind}", not "${SIMILAR_OPPORTUNITIES_KIND}".`,
			{ panelId, actualKind: panel.kind }
		);
	}
	return panel;
}

function diffSummary(
	sourceRun: SimilarityRun,
	refinedRun: SimilarityRun,
	changes: WeightChange[],
	accepted: number,
	rejected: number
): string {
	return (
		`Refined similarity search "${sourceRun.runId}" into "${refinedRun.runId}": adjusted ` +
		`${changes.length} of ${FEATURE_FAMILIES.length} feature weight(s) from ${accepted} accepted ` +
		`and ${rejected} rejected match(es).`
	);
}

export async function refineSimilaritySearch(
	deps: RefineSimilaritySearchDeps,
	request: RefineSimilaritySearchRequest
): Promise<RefineSimilaritySearchResult> {
	const sourceRun = await deps.api.getRun(request.runId);

	const knownCandidateIds = new Set(sourceRun.candidates.map((c) => c.candidateId));
	validateFeedback(request.acceptedMatchIds, request.rejectedMatchIds, knownCandidateIds);

	const vectorsFor = (ids: readonly string[]) =>
		sourceRun.candidates
			.filter((c) => ids.includes(c.candidateId))
			.map((c) => c.perFamilySimilarity);
	const refinement = refineWeights(
		sourceRun.weights,
		vectorsFor(request.acceptedMatchIds),
		vectorsFor(request.rejectedMatchIds)
	);

	const doc = deps.repository.get(deps.workspaceId);
	const setup = doc ? readCapturedSetup(doc, sourceRun.referenceSetupId) : null;
	if (!setup) {
		throw new Error(
			`Cannot re-search: the captured setup "${sourceRun.referenceSetupId}" behind run ` +
				`"${sourceRun.runId}" is no longer in this workspace.`
		);
	}

	const refinedRun = await deps.api.search({
		instrumentId: setup.instrument.symbol,
		window: { start: setup.window.start, end: setup.window.end, timeframe: setup.window.timeframe },
		scope: sourceRun.scope,
		weights: refinement.weights,
		normalization: setup.normalization,
		referenceSetupId: sourceRun.referenceSetupId
	});

	const envelope = commitPanelChange(
		deps,
		request.context,
		'similarity.refine_similarity_search',
		request.requestInput,
		(_doc, state) => {
			const panel = resolveTargetPanel(state, request.runId, request.panelId);
			const config = { ...panel.config, runId: refinedRun.runId, comparisonView: null };
			return {
				nextState: {
					...state,
					panels: state.panels.map((p) => (p.id === panel.id ? { ...p, config } : p))
				},
				affectedIds: [panel.id],
				diffSummary: diffSummary(
					sourceRun,
					refinedRun,
					refinement.changes,
					request.acceptedMatchIds.length,
					request.rejectedMatchIds.length
				),
				warnings: [...refinement.warnings, ...refinedRun.warnings]
			};
		}
	);

	const panelId = envelope.affectedIds[0] ?? '';
	return { envelope, panelId, sourceRun, refinedRun, changes: refinement.changes };
}
