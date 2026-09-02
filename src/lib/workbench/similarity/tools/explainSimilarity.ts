// The `explain_similarity` tool (T-1012-5): the epic's transparency
// surface. Read-only (AC9) -- no mutation envelope, no expected_revision.
import { SimilarityApiError, type SimilarityApiPort } from '../domain/apiPort';
import { toWireExplanation } from '../domain/contract';
import { toWireProvenance } from '../../domain/provenance';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';

export const EXPLAIN_SIMILARITY_TOOL_NAME = 'explain_similarity';

export interface ExplainSimilarityDeps {
	api: SimilarityApiPort;
}

interface WireInput {
	run_id?: unknown;
	candidate_id?: unknown;
}

function ok(payload: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

// `message` is set before the spread and never overwritten by `extra`, even
// when `extra` carries its own `error` discriminator code.
function fail(message: string, extra?: Record<string, unknown>): ToolResult {
	return {
		content: [
			{ type: 'text', text: JSON.stringify({ error: message, message, ...extra }, null, 2) }
		],
		isError: true
	};
}

function toErrorResult(err: unknown): ToolResult {
	if (err instanceof SimilarityApiError) {
		return fail(err.message, err.toWireError());
	}
	return fail(err instanceof Error ? err.message : String(err));
}

export function buildExplainSimilarityTool(deps: ExplainSimilarityDeps): ToolSpec {
	return {
		name: EXPLAIN_SIMILARITY_TOOL_NAME,
		description:
			'Explains one candidate of a completed similarity search: the weight applied, the ' +
			'measured per-family similarity, and the signed contribution to the overall score, for ' +
			"each of the six feature families, reconciling to the candidate's overall score. Served " +
			'entirely from the pinned run -- never re-runs the search. Read-only: no workspace change, ' +
			'no mutation envelope.',
		inputSchema: {
			type: 'object',
			properties: {
				run_id: { type: 'string' },
				candidate_id: { type: 'string' }
			},
			required: ['run_id', 'candidate_id']
		},
		available: () => true,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as WireInput;
			if (typeof input.run_id !== 'string') {
				return fail('"run_id" is required.');
			}
			if (typeof input.candidate_id !== 'string') {
				return fail('"candidate_id" is required.');
			}

			// getRun first, always: a 404 here is unambiguously AC8 (the run
			// itself is unavailable, a new search is required). Only once the
			// run is confirmed to exist does a 404 from explain() mean AC7 (a
			// real run, a candidate id that isn't part of it) -- see this
			// ticket's Solution Approach for why status codes alone can't tell
			// the two apart.
			let run;
			try {
				run = await deps.api.getRun(input.run_id);
			} catch (err) {
				if (err instanceof SimilarityApiError && err.reason === 'not_found_run') {
					return fail(
						`Similarity run "${input.run_id}" is no longer available. A new search ` +
							'(find_similar_setups) is required -- this candidate is never re-explained from ' +
							'a run that no longer exists.',
						{ error: 'similarity_run_unavailable', run_id: input.run_id }
					);
				}
				return toErrorResult(err);
			}

			try {
				const explanation = await deps.api.explain(input.run_id, input.candidate_id);
				return ok({
					...toWireExplanation(explanation),
					scope: run.scope,
					normalization: { mode: run.normalization.mode, anchor: run.normalization.anchor },
					provenance: toWireProvenance(run.provenance)
				});
			} catch (err) {
				if (err instanceof SimilarityApiError && err.reason === 'not_found_candidate') {
					return fail(`Candidate "${input.candidate_id}" is not part of run "${input.run_id}".`, {
						error: 'similarity_candidate_not_found',
						run_id: input.run_id,
						candidate_id: input.candidate_id
					});
				}
				return toErrorResult(err);
			}
		}
	};
}
