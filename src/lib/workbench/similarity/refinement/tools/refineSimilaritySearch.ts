// The `refine_similarity_search` tool (T-1014-4): the agent-facing entry
// point for turning a researcher's accepted/rejected matches into adjusted
// feature weights and a new search. Wire boundary only -- all the actual
// logic lives in the pure domain (`../domain/refinement.ts`) and the use
// case (`../application/refineSimilaritySearch.ts`).
import { PanelOperationError, type PanelUseCaseDeps } from '../../../../panels/application';
import { toWireEnvelope } from '../../../domain/mutation';
import type { MutationContext } from '../../../domain/mutation';
import type { ToolResult, ToolSpec } from '../../../../webmcp/types';
import { SimilarityApiError, type SimilarityApiPort } from '../../domain/apiPort';
import { toWireSimilarityRun } from '../../domain/contract';
import { SimilarityRefinementError, toWireWeightChange } from '../domain/refinement';
import {
	refineSimilaritySearch,
	type RefineSimilaritySearchDeps
} from '../application/refineSimilaritySearch';

export const REFINE_SIMILARITY_SEARCH_TOOL_NAME = 'refine_similarity_search';

export interface RefineSimilaritySearchToolDeps extends PanelUseCaseDeps {
	api: SimilarityApiPort;
}

interface WireInput {
	workspace_id?: unknown;
	run_id?: unknown;
	accepted_match_ids?: unknown;
	rejected_match_ids?: unknown;
	panel_id?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function ok(payload: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

// `message` is set before the spread and never overwritten by `extra`, even
// when `extra` carries its own `error` discriminator code -- matching
// findSimilarSetups.ts/explainSimilarity.ts's own local `fail` exactly.
function fail(message: string, extra?: Record<string, unknown>): ToolResult {
	return {
		content: [
			{ type: 'text', text: JSON.stringify({ error: message, message, ...extra }, null, 2) }
		],
		isError: true
	};
}

// `runId` is only used to word the `not_found_run` message the same way
// explain_similarity.ts does -- naming the run the caller actually asked
// for, not whatever substring the underlying error happened to quote.
function toErrorResult(err: unknown, runId: string): ToolResult {
	if (err instanceof SimilarityRefinementError) {
		return fail(err.message, err.toWireError());
	}
	if (err instanceof SimilarityApiError) {
		if (err.reason === 'not_found_run') {
			return fail(
				`Similarity run "${runId}" is no longer available. A new search ` +
					'(find_similar_setups) is required -- this run is never re-refined once its data is gone.',
				{ error: 'similarity_run_unavailable', run_id: runId }
			);
		}
		return fail(err.message, err.toWireError());
	}
	if (err instanceof PanelOperationError) {
		return fail(err.message, err.toWireError());
	}
	return fail(err instanceof Error ? err.message : String(err));
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function parseContext(input: WireInput): MutationContext {
	return {
		expectedRevision:
			typeof input.expected_revision === 'number' ? input.expected_revision : undefined,
		idempotencyKey: typeof input.idempotency_key === 'string' ? input.idempotency_key : undefined,
		actor: 'agent'
	};
}

function refineSimilaritySearchTool(deps: RefineSimilaritySearchToolDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as WireInput;
		const workspaceId =
			typeof input.workspace_id === 'string' ? input.workspace_id : deps.repository.getActiveId();
		if (!workspaceId) {
			return fail('No active workspace.', { error: 'not_found' });
		}
		if (!deps.repository.get(workspaceId)) {
			return fail(`Workspace not found: ${workspaceId}`, { error: 'not_found' });
		}
		if (typeof input.run_id !== 'string') {
			return fail('"run_id" is required.');
		}

		try {
			const result = await refineSimilaritySearch(deps, {
				context: parseContext(input),
				requestInput: input,
				runId: input.run_id,
				acceptedMatchIds: toStringArray(input.accepted_match_ids),
				rejectedMatchIds: toStringArray(input.rejected_match_ids),
				panelId: typeof input.panel_id === 'string' ? input.panel_id : undefined
			});
			return ok({
				...toWireEnvelope(result.envelope),
				panel_id: result.panelId,
				source_run_id: result.sourceRun.runId,
				weight_changes: result.changes.map(toWireWeightChange),
				...toWireSimilarityRun(result.refinedRun),
				// `toWireSimilarityRun` carries the refined run's own (narrower)
				// warnings; the envelope's already merges those with the
				// refinement's own (clamp/one-sided/small-sample) warnings, so it
				// must win here, spread order notwithstanding.
				warnings: result.envelope.warnings
			});
		} catch (err) {
			return toErrorResult(err, input.run_id);
		}
	};
}

const DESCRIPTION =
	'Given a similarity search (by its run_id, as produced by find_similar_setups or a prior ' +
	'refinement) together with the candidate ids a researcher judged accepted and rejected, ' +
	'adjusts the feature weights to favor the accepted matches and re-searches. Reports every ' +
	'weight that changed, naming its feature and its before/after value, so the refinement is ' +
	'auditable rather than opaque. Returns a new run with a stable run_id distinct from the ' +
	'original -- the original search remains readable by its own run_id. Rebinds the ' +
	'similar_opportunities panel bound to the source run (an explicit panel_id, or the one ' +
	'discovered from the run) onto the refined run, so undoing the call restores the previous ' +
	'weights exactly. As a mutation, honors expected_revision and idempotency_key and returns ' +
	'the common mutation envelope with an undo_token.';

export function buildRefineSimilaritySearchTool(deps: RefineSimilaritySearchToolDeps): ToolSpec {
	return {
		name: REFINE_SIMILARITY_SEARCH_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: { type: 'string' },
				run_id: { type: 'string' },
				accepted_match_ids: { type: 'array', items: { type: 'string' } },
				rejected_match_ids: { type: 'array', items: { type: 'string' } },
				panel_id: { type: 'string' },
				expected_revision: { type: 'number' },
				idempotency_key: { type: 'string' }
			},
			required: ['run_id']
		},
		available: () => true,
		execute: refineSimilaritySearchTool(deps)
	};
}
