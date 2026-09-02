// The `compare_setups` tool (T-1012-7). Matches the wrapping style
// panels/tools/lifecycleTools.ts uses for its own revisioned tools:
// parseContext for the mutation-context fields, toWireEnvelope for the
// response, toErrorResult for the shared typed-error-to-ToolResult mapping.
import { toWireEnvelope } from '../../../domain/mutation';
import type { PanelUseCaseDeps } from '../../../../panels/application';
import { fail, ok, toErrorResult } from '../../../../panels/tools/results';
import { parseContext } from '../../../../panels/tools/wire';
import type { ToolResult, ToolSpec } from '../../../../webmcp/types';
import type { SimilarityRun } from '../../domain/contract';
import {
	CandidateSelectionError,
	COMPARISON_FORMS,
	isComparisonForm
} from '../domain/comparisonView';
import { compareSetups as compareSetupsUseCase } from '../application/compareSetups';

export const COMPARE_SETUPS_TOOL_NAME = 'compare_setups';

interface WireInput {
	run?: unknown;
	candidate_ids?: unknown;
	form?: unknown;
	panel_id?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function isSimilarityRunShaped(value: unknown): value is SimilarityRun {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const v = value as Record<string, unknown>;
	return (
		typeof v.runId === 'string' &&
		typeof v.referenceSetupId === 'string' &&
		Array.isArray(v.candidates)
	);
}

export function buildCompareSetupsTool(deps: PanelUseCaseDeps): ToolSpec {
	return {
		name: COMPARE_SETUPS_TOOL_NAME,
		description:
			"Displays a similarity run's candidates against its reference setup as normalized " +
			'overlays, synchronized charts, or small multiples. Accepts the run by value (as returned ' +
			'by find_similar_setups), the candidate ids to show, and the comparison form. Targets an ' +
			'explicit panel_id, or defaults to the similar_opportunities panel bound to the run. ' +
			'Returns the mutation envelope; the undo_token restores the prior view.',
		inputSchema: {
			type: 'object',
			properties: {
				run: { type: 'object', description: 'The SimilarityRun this comparison is drawn from.' },
				candidate_ids: { type: 'array', items: { type: 'string' } },
				form: { type: 'string', enum: [...COMPARISON_FORMS] },
				panel_id: { type: 'string' },
				expected_revision: { type: 'number' },
				idempotency_key: { type: 'string' }
			},
			required: ['run', 'candidate_ids', 'form']
		},
		available: () => true,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as WireInput;
			if (!isSimilarityRunShaped(input.run)) {
				return fail('"run" must be a SimilarityRun (as returned by find_similar_setups).');
			}
			if (
				!Array.isArray(input.candidate_ids) ||
				!input.candidate_ids.every((id) => typeof id === 'string')
			) {
				return fail('"candidate_ids" must be an array of candidate id strings.');
			}
			if (!isComparisonForm(input.form)) {
				return fail(`"form" must be one of: ${COMPARISON_FORMS.join(', ')}.`);
			}
			try {
				const envelope = compareSetupsUseCase(deps, {
					context: parseContext(input),
					run: input.run,
					candidateIds: input.candidate_ids,
					form: input.form,
					...(typeof input.panel_id === 'string' ? { panelId: input.panel_id } : {})
				});
				return ok(toWireEnvelope(envelope));
			} catch (err) {
				if (err instanceof CandidateSelectionError) {
					// panels/tools/results.ts's shared fail() sets `error` to
					// `message` before spreading `extra` in -- an `extra.error`
					// discriminator here would otherwise silently clobber the
					// human-readable text unless `extra` restates it under
					// `message` too, matching PanelOperationError's own
					// toWireError() shape.
					return fail(err.message, {
						error: 'unknown_candidate',
						message: err.message,
						run_id: err.runId,
						candidate_ids: err.unknownCandidateIds
					});
				}
				return toErrorResult(err);
			}
		}
	};
}
