// The two WebMCP tools this epic registers directly (T-1010-8):
// `get_screener_results` and `explain_result`. Both resolve their bound
// run (and, for get_screener_results, its table configuration and
// selection) from a results panel already bound via EPIC-1007's
// bind_panel_source/configure_panel_view -- neither tool accepts a bare
// run_id, so a caller can never read a run this workspace has no panel
// pointed at (AC4's "a results tool requires a results panel bound to a
// run"). Resolution mirrors ResultsTablePanel.svelte's own resolution
// exactly (same PinnedRunStore, same panel state), so the tool and the
// rendered panel can never disagree about what a panel is showing.
//
// Both tools are pure reads: getScreenerResults and explainResult
// (T-1010-4/T-1010-5) have no path back to ScreenerEvaluationPort --
// PinnedRunStore (screener/ports.ts) has no execute/refresh member to
// reach in the first place -- so nothing reachable from either tool can
// re-run the screener (AC6's structural "no silent rerun" guarantee).
import { readPanelState, type PanelUseCaseDeps } from '../../panels/application';
import type { Panel } from '../../panels/domain/panel';
import type { PinnedRunStore, RunNotAvailable } from '../../screener/ports';
import type { ToolResult, ToolSpec } from '../../webmcp/types';
import { fail, ok } from '../../panels/tools/results';
import {
	getScreenerResults,
	type GetScreenerResultsOutcome
} from '../application/getScreenerResults';
import { explainResult, type ExplainResultOutcome } from '../application/explainResult';
import { parseWireResultsTableConfig } from '../application/tableConfigWire';
import { defaultResultsTableConfig, toWireProjectedResultsPage } from '../domain/projection';
import { mintResultId, MAX_PAGE_SIZE, type TickerResolver } from '../domain/page';
import { toWireResultExplanation } from '../domain/explanationWire';

export const SCREENER_RESULTS_SOURCE_TYPE = 'screener_results';

// The suffix explainResult.ts's own runUnavailable() appends and
// renderState.ts's RUN_AGAIN_SUFFIX matches -- repeated here (not
// imported; both of those live behind other modules' own naming) so
// get_screener_results' expired/unknown-run error reads identically to
// every other place this codebase reports the same condition (AC5).
const RUN_AGAIN_SUFFIX = ' Run the screener again to see current results.';

export interface ResultsToolDeps extends PanelUseCaseDeps {
	runs: PinnedRunStore;
	// Absent resolves to "no ticker available", matching getScreenerResults's
	// own default -- this area's honest-absence convention.
	resolveTicker?: TickerResolver;
}

function isRunNotAvailable<T>(value: T | RunNotAvailable): value is RunNotAvailable {
	return typeof value === 'object' && value !== null && 'available' in value;
}

function isRejected(
	outcome: GetScreenerResultsOutcome
): outcome is Extract<GetScreenerResultsOutcome, { rejected: true }> {
	return 'rejected' in outcome && outcome.rejected === true;
}

// AC5's "not in universe" and "run not available" outcomes both carry
// `available: false` (explainResult.ts's InstrumentNotEvaluated
// deliberately mirrors RunNotAvailable's shape) -- `reason` is the only
// field that tells them apart.
function isInstrumentNotEvaluated(
	outcome: ExplainResultOutcome
): outcome is Extract<ExplainResultOutcome, { reason: 'not_in_universe' }> {
	return 'reason' in outcome && outcome.reason === 'not_in_universe';
}

function runIdOf(panel: Panel): string | null {
	if (!panel.source || panel.source.type !== SCREENER_RESULTS_SOURCE_TYPE) {
		return null;
	}
	const runId = panel.source.ref.run_id;
	return typeof runId === 'string' ? runId : null;
}

interface PanelLookupFailure {
	code: 'unknown_panel' | 'unbound_panel';
	message: string;
}

function isPanelLookupFailure(
	value: { panel: Panel; runId: string } | PanelLookupFailure
): value is PanelLookupFailure {
	return 'code' in value;
}

// Shared by both tools: find the panel, then its bound run id. Neither
// tool ever reads a bare run_id the caller supplies directly (AC4).
function resolvePanel(
	deps: ResultsToolDeps,
	panelId: string
): { panel: Panel; runId: string } | PanelLookupFailure {
	const doc = deps.repository.get(deps.workspaceId);
	const panel = doc ? readPanelState(doc).panels.find((p) => p.id === panelId) : undefined;
	if (!panel) {
		return { code: 'unknown_panel', message: `Unknown panel "${panelId}".` };
	}
	const runId = runIdOf(panel);
	if (runId === null) {
		return {
			code: 'unbound_panel',
			message:
				`Panel "${panel.title}" has no screener run bound. Bind one with bind_panel_source ` +
				'first.'
		};
	}
	return { panel, runId };
}

function currentSelection(deps: ResultsToolDeps, panelId: string): string[] {
	const doc = deps.repository.get(deps.workspaceId);
	return doc ? (readPanelState(doc).selections[panelId] ?? []) : [];
}

// AC4: at least one results panel currently bound to an available run.
// Never invoked by registerPanelTools.ts's static registration loop today
// (see resultsTools.ts's own module doc / the ticket's plan doc for why),
// but a real, closure-based predicate over live state rather than a
// stub -- directly unit-testable, and ready for a future dynamic
// registration loop.
function hasAvailableRunPanel(deps: ResultsToolDeps): boolean {
	const doc = deps.repository.get(deps.workspaceId);
	if (!doc) {
		return false;
	}
	return readPanelState(doc).panels.some((panel) => {
		const runId = runIdOf(panel);
		return runId !== null && !isRunNotAvailable(deps.runs.getRun(runId));
	});
}

// Maps a selected result id (the wire shape set_panel_selection stores)
// back to the instrument it names, reading only the pinned run's already-
// stored matches -- never a fresh lookup. Returns null when the run isn't
// available or the selection is empty, letting the caller fall back to
// requiring an explicit instrument_id.
function instrumentForSelection(
	runs: PinnedRunStore,
	runId: string,
	selection: string[]
): string | null {
	const [primary] = selection;
	if (primary === undefined) {
		return null;
	}
	const run = runs.getRun(runId);
	if (isRunNotAvailable(run)) {
		return null;
	}
	const match = run.matches.find(
		(candidate) => mintResultId(run.runId, candidate.rank) === primary
	);
	return match?.instrumentId ?? null;
}

// panels/tools/results.ts's fail(message, extra) spreads `extra` over a
// base `{ error: message }` -- so a caller that wants a stable machine
// code (not the human text) under `error`, matching
// PanelOperationError.toWireError()'s `{ error: code, message, ...details }`
// shape, must put both `error` and `message` in `extra` itself, or the
// spread silently discards the human text. This is that shape, in one
// place, so no call site below can get the two mixed up again.
function failWithCode(
	code: string,
	message: string,
	details: Record<string, unknown> = {}
): ToolResult {
	return fail(message, { error: code, message, ...details });
}

function runNotAvailableResult(outcome: RunNotAvailable): ToolResult {
	return failWithCode(outcome.reason, `${outcome.message}${RUN_AGAIN_SUFFIX}`, {
		run_id: outcome.runId
	});
}

interface GetScreenerResultsInput {
	panel_id?: unknown;
	cursor?: unknown;
	page_size?: unknown;
}

function getScreenerResultsTool(deps: ResultsToolDeps): ToolSpec {
	return {
		name: 'get_screener_results',
		description:
			"Returns a bounded page of an existing screener run's results, projected through the " +
			"bound results panel's configured columns, computed columns, sort and grouping, together " +
			"with the total count, a cursor for the next page, the current selection, and the run's " +
			'own provenance. Reads only: it retrieves an already-pinned run and never re-runs the ' +
			'screener, even implicitly -- an expired or unknown run is reported as an explicit error, ' +
			'not a fresh execution.',
		inputSchema: {
			type: 'object',
			properties: {
				panel_id: {
					type: 'string',
					description: 'A results_table panel already bound to a screener run.'
				},
				cursor: {
					type: 'string',
					description:
						"Opaque resume token from a previous page's next_cursor. Omit for the first page."
				},
				page_size: {
					type: 'number',
					description: `Rows per page, up to ${MAX_PAGE_SIZE}; defaults to the panel's configured page size, or the documented default when unset.`
				}
			},
			required: ['panel_id']
		},
		available: () => hasAvailableRunPanel(deps),
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as GetScreenerResultsInput;
			if (typeof input.panel_id !== 'string') {
				return fail('"panel_id" is required.');
			}
			const resolved = resolvePanel(deps, input.panel_id);
			if (isPanelLookupFailure(resolved)) {
				return failWithCode(resolved.code, resolved.message);
			}
			const { panel, runId } = resolved;
			const parsedConfig = parseWireResultsTableConfig(panel.config);
			const tableConfig = parsedConfig.ok ? parsedConfig.config : defaultResultsTableConfig();

			const outcome = getScreenerResults(
				deps.runs,
				{
					runId,
					cursor: typeof input.cursor === 'string' ? input.cursor : undefined,
					pageSize: typeof input.page_size === 'number' ? input.page_size : undefined,
					tableConfig
				},
				{ resolveTicker: deps.resolveTicker }
			);

			if (isRunNotAvailable(outcome)) {
				return runNotAvailableResult(outcome);
			}
			if (isRejected(outcome)) {
				const { message, reason, ...rest } = outcome;
				return failWithCode(reason, message, rest);
			}
			return ok({
				...toWireProjectedResultsPage(outcome),
				selected_result_ids: currentSelection(deps, panel.id)
			});
		}
	};
}

interface ExplainResultInput {
	panel_id?: unknown;
	instrument_id?: unknown;
}

function explainResultTool(deps: ResultsToolDeps): ToolSpec {
	return {
		name: 'explain_result',
		description:
			'Returns why one instrument matched or did not match a pinned screener run: the actual ' +
			'value and pass/fail/indeterminate state for every filter condition -- including ' +
			"conditions nested inside AND/OR/NOT groups, with each group's own resolved outcome -- " +
			"plus each ranking field's raw value, normalized value, weight and contribution to the " +
			"final score. Covers a run's rejected and truncated candidates as well as its results: an " +
			'instrument only needs to have been evaluated, not to have passed, to be explained. Omit ' +
			"instrument_id to explain the results panel's current selection. Reads only: it never " +
			're-runs the screener.',
		inputSchema: {
			type: 'object',
			properties: {
				panel_id: {
					type: 'string',
					description: 'A results_table panel already bound to a screener run.'
				},
				instrument_id: {
					type: 'string',
					description:
						"Instrument to explain. Omit to explain the panel's current single-result " +
						'selection; an error names the requirement when neither is available.'
				}
			},
			required: ['panel_id']
		},
		available: () => hasAvailableRunPanel(deps),
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as ExplainResultInput;
			if (typeof input.panel_id !== 'string') {
				return fail('"panel_id" is required.');
			}
			const resolved = resolvePanel(deps, input.panel_id);
			if (isPanelLookupFailure(resolved)) {
				return failWithCode(resolved.code, resolved.message);
			}
			const { panel, runId } = resolved;

			let instrumentId: string;
			if (typeof input.instrument_id === 'string' && input.instrument_id.length > 0) {
				instrumentId = input.instrument_id;
			} else {
				const fromSelection = instrumentForSelection(
					deps.runs,
					runId,
					currentSelection(deps, panel.id)
				);
				if (fromSelection === null) {
					return fail(
						`"instrument_id" is required: panel "${panel.title}" has no selection to fall back to.`
					);
				}
				instrumentId = fromSelection;
			}

			const outcome = explainResult(deps.runs, runId, instrumentId);
			if (isInstrumentNotEvaluated(outcome)) {
				return failWithCode(outcome.reason, outcome.message, {
					run_id: outcome.runId,
					instrument_id: outcome.instrumentId
				});
			}
			if (isRunNotAvailable(outcome)) {
				// explainResult.ts's own runUnavailable() already appends the
				// "run it again" suffix -- no double-suffixing here.
				return failWithCode(outcome.reason, outcome.message, { run_id: outcome.runId });
			}
			return ok(toWireResultExplanation(outcome));
		}
	};
}

export function buildResultsTools(deps: ResultsToolDeps): ToolSpec[] {
	return [getScreenerResultsTool(deps), explainResultTool(deps)];
}
