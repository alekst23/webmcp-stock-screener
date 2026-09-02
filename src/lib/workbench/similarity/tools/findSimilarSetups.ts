// The `find_similar_setups` tool (T-1012-4): the agent-facing entry point
// to the epic. Reads a captured setup, runs a similarity search against the
// backend, and binds the pinned run into a similar_opportunities panel --
// one atomic workspace mutation (AC5, AC8), not two.
import { readCapturedSetup } from '../../chart/domain/capturedSetup';
import { PanelOperationError, type PanelUseCaseDeps } from '../../../panels/application';
import {
	commitPanelChange,
	findPanel,
	resolveAutoRect,
	throwPlacementViolation,
	visibleOccupied
} from '../../../panels/application/support';
import { validatePlacement } from '../../../panels/domain/layout';
import { makePanel } from '../../../panels/domain/panel';
import { toWireEnvelope } from '../../domain/mutation';
import { isResourceId } from '../../domain/ids';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import type { SimilarityApiPort } from '../domain/apiPort';
import { SimilarityApiError } from '../domain/apiPort';
import { toWireSimilarityRun, type SearchScope, type SimilarityRun } from '../domain/contract';
import { parseContext } from '../../../panels/tools/wire';

export const FIND_SIMILAR_SETUPS_TOOL_NAME = 'find_similar_setups';
const SIMILAR_OPPORTUNITIES_KIND = 'similar_opportunities';

export interface FindSimilarSetupsDeps extends PanelUseCaseDeps {
	api: SimilarityApiPort;
}

interface WireInput {
	workspace_id?: unknown;
	setup_id?: unknown;
	scope?: unknown;
	weights?: unknown;
	limit?: unknown;
	min_score?: unknown;
	panel_id?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

const SCOPES: readonly SearchScope[] = ['cross_instrument', 'same_instrument_windows', 'both'];

function isSearchScope(value: unknown): value is SearchScope {
	return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

function ok(payload: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string, extra?: Record<string, unknown>): ToolResult {
	return {
		content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 2) }],
		isError: true
	};
}

function toErrorResult(err: unknown): ToolResult {
	if (err instanceof SimilarityApiError) {
		return fail(err.message, err.toWireError());
	}
	if (err instanceof PanelOperationError) {
		return fail(err.message, err.toWireError());
	}
	return fail(err instanceof Error ? err.message : String(err));
}

// Resolves the target similar_opportunities panel for the given run,
// creating one (auto-placed) when no explicit panel_id is given -- the same
// pieces createPanel.ts itself uses, orchestrated inline so this stays one
// mutation, not two (see this ticket's Solution Approach).
function bindPanel(
	deps: FindSimilarSetupsDeps,
	state: Parameters<typeof findPanel>[0],
	panelId: string | undefined,
	run: SimilarityRun
) {
	if (panelId) {
		const panel = findPanel(state, panelId);
		if (panel.kind !== SIMILAR_OPPORTUNITIES_KIND) {
			throw new PanelOperationError(
				'invalid_config',
				`Panel "${panelId}" is kind "${panel.kind}", not "${SIMILAR_OPPORTUNITIES_KIND}".`,
				{ panelId, actualKind: panel.kind }
			);
		}
		const config = { ...panel.config, runId: run.runId, comparisonView: null };
		return {
			panels: state.panels.map((p) => (p.id === panel.id ? { ...p, config } : p)),
			panelId: panel.id,
			title: panel.title,
			created: false
		};
	}

	const kindDef = deps.kinds.require(SIMILAR_OPPORTUNITIES_KIND);
	const occupied = visibleOccupied(state.panels);
	const rect = resolveAutoRect(kindDef.defaultSize, occupied);
	const placement = validatePlacement({ rect, minSize: kindDef.minSize, occupied });
	if (!placement.ok) {
		throwPlacementViolation(placement.violation);
	}
	const id = deps.ids.next('panel', SIMILAR_OPPORTUNITIES_KIND);
	const config = { ...kindDef.defaultConfig(), runId: run.runId, comparisonView: null };
	const panel = makePanel({
		id,
		kind: SIMILAR_OPPORTUNITIES_KIND,
		title: kindDef.defaultTitle,
		config,
		rect
	});
	return { panels: [...state.panels, panel], panelId: id, title: panel.title, created: true };
}

function findSimilarSetups(deps: FindSimilarSetupsDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as WireInput;
		const workspaceId =
			typeof input.workspace_id === 'string' ? input.workspace_id : deps.repository.getActiveId();
		if (!workspaceId) {
			return fail('No active workspace.', { error: 'not_found' });
		}
		const doc = deps.repository.get(workspaceId);
		if (!doc) {
			return fail(`Workspace not found: ${workspaceId}`, { error: 'not_found' });
		}
		if (typeof input.setup_id !== 'string') {
			return fail('"setup_id" is required.');
		}
		const setup = readCapturedSetup(doc, input.setup_id);
		if (!setup) {
			// AC10: actionable, names the missing setup -- never an empty result.
			return fail(`Captured setup not found: ${input.setup_id}`, {
				error: 'setup_not_found',
				setup_id: input.setup_id
			});
		}
		if (!isSearchScope(input.scope)) {
			return fail(`"scope" must be one of: ${SCOPES.join(', ')}.`);
		}

		let run: SimilarityRun;
		try {
			run = await deps.api.search({
				// The backend engine (T-1012-2/3) treats instrument_id as a bare
				// ticker (PandasSimilarityEngine._row_range(ticker, ...)), not a
				// stable inst:<MIC>:<symbol> ID -- the captured setup's own
				// symbol is what the panel actually indexes by.
				instrumentId: setup.instrument.symbol,
				window: {
					start: setup.window.start,
					end: setup.window.end,
					timeframe: setup.window.timeframe
				},
				scope: input.scope,
				...(typeof input.weights === 'object' && input.weights !== null
					? { weights: input.weights as Partial<Record<string, number>> }
					: {}),
				normalization: setup.normalization,
				...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
				...(typeof input.min_score === 'number' ? { minScore: input.min_score } : {}),
				referenceSetupId: input.setup_id
			});
		} catch (err) {
			return toErrorResult(err);
		}

		try {
			const envelope = commitPanelChange(
				deps,
				parseContext(input),
				'similarity.find_similar_setups',
				input,
				(_doc, state) => {
					const bound = bindPanel(
						deps,
						state,
						typeof input.panel_id === 'string' ? input.panel_id : undefined,
						run
					);
					return {
						nextState: { ...state, panels: bound.panels },
						affectedIds: [bound.panelId],
						diffSummary: bound.created
							? `Found ${run.candidates.length} similar setup(s) for "${input.setup_id}" and bound them to a new "${bound.title}" panel.`
							: `Found ${run.candidates.length} similar setup(s) for "${input.setup_id}" and bound them to panel "${bound.title}".`,
						warnings: run.warnings
					};
				}
			);
			const panelId = envelope.affectedIds.find((id) => isResourceId(id, 'panel')) ?? '';
			return ok({
				...toWireEnvelope(envelope),
				panel_id: panelId,
				...toWireSimilarityRun(run)
			});
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const DESCRIPTION =
	'Given a captured setup (by its stable setup_id, as produced by capture_chart_setup), searches ' +
	'other symbols and/or other historical windows for setups that resemble it. Returns a pinned ' +
	'similarity run: a stable run_id and ranked candidates, each carrying its overall score and ' +
	'per-family measured similarities -- never a bare score, never identified by ticker alone. ' +
	'Binds the run to a similar_opportunities panel (an explicit panel_id, or a newly created one) ' +
	'so the result is visible in the workspace. As a mutation, honors expected_revision and ' +
	'idempotency_key and returns the common mutation envelope with an undo_token.';

export function buildFindSimilarSetupsTool(deps: FindSimilarSetupsDeps): ToolSpec {
	return {
		name: FIND_SIMILAR_SETUPS_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: { type: 'string' },
				setup_id: { type: 'string' },
				scope: { type: 'string', enum: [...SCOPES] },
				weights: { type: 'object' },
				limit: { type: 'number' },
				min_score: { type: 'number' },
				panel_id: { type: 'string' },
				expected_revision: { type: 'number' },
				idempotency_key: { type: 'string' }
			},
			required: ['setup_id', 'scope']
		},
		available: () => true,
		execute: findSimilarSetups(deps)
	};
}
