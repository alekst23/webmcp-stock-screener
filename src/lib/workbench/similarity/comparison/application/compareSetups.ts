// The compare_setups mutation (T-1012-7): writes a ComparisonView onto a
// `similar_opportunities` panel's config. A panel-container-state mutation,
// so it follows panels/application's own house style (commitPanelChange +
// findPanel) rather than the workbench OperationRegistry style EPIC-1011's
// chart tools use -- the target here is PanelSystemState, the same state
// setPanelSelection/configurePanelView already own.
import type { MutationContext, MutationEnvelope } from '../../../domain/mutation';
import {
	PanelOperationError,
	type PanelSystemState,
	type PanelUseCaseDeps
} from '../../../../panels/application';
import { commitPanelChange, findPanel } from '../../../../panels/application/support';
import type { Panel } from '../../../../panels/domain/panel';
import type { SimilarityRun } from '../../domain/contract';
import { buildComparisonView, type ComparisonForm } from '../domain/comparisonView';
import { similarOpportunitiesPanelKindDefinition } from '../../panel/domain/panelKind';

export interface CompareSetupsRequest {
	context: MutationContext;
	run: SimilarityRun;
	candidateIds: string[];
	form: ComparisonForm;
	// Explicit target, or (default) the similar_opportunities panel bound to
	// this run -- Technical Considerations' resolution rule.
	panelId?: string;
}

// Finds the similar_opportunities panel whose config.runId is this run's id.
// Actionable and specific rather than a generic "unknown panel" (AC8's "no
// view change" spirit extended to target resolution, not just candidate ids).
function findBoundPanel(state: PanelSystemState, runId: string): Panel {
	const panel = state.panels.find(
		(p) => p.kind === 'similar_opportunities' && (p.config as { runId?: unknown }).runId === runId
	);
	if (!panel) {
		// 'unknown_panel' is the closest fit among PanelOperationError's closed
		// code set (EPIC-1007's own contract, not extended here): no panel
		// could be resolved for this operation, same as an explicit unknown id
		// -- the message states the more specific reason.
		throw new PanelOperationError(
			'unknown_panel',
			`No similar_opportunities panel is bound to run "${runId}". Pass an explicit panel_id, ` +
				"or bind one first (its config.runId must equal this run's run_id).",
			{ runId }
		);
	}
	return panel;
}

export function compareSetups(
	deps: PanelUseCaseDeps,
	request: CompareSetupsRequest
): MutationEnvelope {
	return commitPanelChange(
		deps,
		request.context,
		'similarity.compare_setups',
		request,
		(_doc, state) => {
			const panel = request.panelId
				? findPanel(state, request.panelId)
				: findBoundPanel(state, request.run.runId);

			// buildComparisonView throws CandidateSelectionError for AC8 --
			// deliberately not caught here, so it propagates out of
			// commitPanelChange's mutate() and no document write happens at all
			// (recordCommit only writes when mutate() returns normally).
			const view = buildComparisonView(request.run, request.candidateIds, request.form);

			const candidateConfig = { ...panel.config, runId: request.run.runId, comparisonView: view };
			const validation = similarOpportunitiesPanelKindDefinition.validateConfig(candidateConfig);
			if (!validation.ok) {
				throw new PanelOperationError(
					'invalid_config',
					`Comparison view rejected for panel "${panel.title}".`,
					{ errors: validation.errors }
				);
			}

			const updated = { ...panel, config: validation.value };
			return {
				nextState: { ...state, panels: state.panels.map((p) => (p.id === panel.id ? updated : p)) },
				affectedIds: [panel.id],
				diffSummary:
					`Panel "${panel.title}": compared ${view.candidateIds.length} candidate(s) from run ` +
					`"${request.run.runId}" as ${request.form}.`,
				warnings: view.warnings
			};
		}
	);
}
