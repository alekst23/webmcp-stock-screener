// `run_screener` (T-1009-9): executes one specific screener revision and
// pins the result under a stable `run_id`. This module orchestrates only --
// it reads the screener, mints a run id, calls the injected
// ScreenerEvaluationPort, stores the outcome in a PinnedRunStore, and shapes
// the wire response. Every field a completed run reports (matches, warnings,
// provenance, ranking) comes straight from run.ts's own contract; this file
// never re-derives any of it.
//
// The run does not advance the workspace revision the way a definition edit
// does, so -- like save_workspace (workbench/tools/index.ts) -- it bypasses
// RevisionService.commit and replays idempotency_key against a private
// cache directly. That cache is not WorkbenchDeps.idempotency: that cache is
// typed to MutationEnvelope, which a ScreenerRun is not, and this ticket
// must not change idempotency.ts's shared type to fit.

import { builtinCatalogRegistry, type CatalogRegistry } from '../../catalog/registry';
import {
	bindPanelSource,
	createPanel,
	readPanelState,
	type PanelUseCaseDeps
} from '../../panels/application';
import { resolveAutoRect, visibleOccupied } from '../../panels/application/support';
import type { LayoutTemplateRegistry } from '../../panels/domain/layoutTemplates';
import type { PanelRegistry } from '../../panels/registry/panelKindRegistry';
import type { SourceRendererRegistry } from '../../panels/registry/sourceRendererRegistry';
import { createScreenerEngine } from '../../screener/engine/engine';
import { createUnavailableMarketData } from '../../screener/engine/unavailableMarketData';
import { createPinnedRunStore } from '../../screener/runStore';
import type { PinnedRunStore } from '../../screener/ports';
import type { ScreenerEvaluationPort, ScreenerMarketData } from '../../screener/ports';
import {
	toWireScreenerRun,
	type ScreenerRunOutcome,
	type ScreenerRunRefusal
} from '../../screener/run';
import { validateScreenerDefinition } from '../../screener/screenerValidation';
import { readScreener } from '../../screener/state';
import type { ScreenerDefinition } from '../../screener/definition';
import { fingerprintRequest } from '../../workbench/application/idempotency';
import {
	IdempotencyConflictError,
	OperationValidationError,
	RevisionConflictError
} from '../../workbench/domain/errors';
import type { Actor } from '../../workbench/domain/mutation';
import type { WorkspaceDocument } from '../../workbench/domain/workspace';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import type { WorkspaceRepository } from '../../workbench/domain/ports';
import type { ValidationProblem } from '../../screener/validation';
import { fail, ok } from '../toolResult';
import type { ToolResult, ToolSpec } from '../types';
import {
	readOptionalNumber,
	readOptionalString,
	readString,
	resolveWorkspaceId,
	toErrorResult
} from './support';

const DESCRIPTION =
	'Executes one specific screener revision and pins the complete, ordered result set under a ' +
	'stable run_id: the screener id and revision executed, universe/matched/returned counts, ' +
	'whether the result was truncated, ranking, warnings and full data provenance. The run never ' +
	'changes after later edits to the screener (it always describes the revision it executed), ' +
	'and its stored matches -- including every ranking value and per-filter-node pass/fail state -- ' +
	'are read back by run_id without ever re-executing the screener. A screener with blocking ' +
	'validation problems is refused instead: the problems are returned and no run_id is minted. A ' +
	'valid screener that nothing satisfies is a normal run with matched_count 0 and a warning, not ' +
	'an error. Accepts an optional screener_revision to run an exact past revision (rejected if no ' +
	'longer retained), expected_revision for optimistic concurrency, and idempotency_key -- a ' +
	'replayed key returns the original run_id without executing a second time.';

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		screener_id: { type: 'string' },
		screener_revision: {
			type: 'integer',
			description:
				"Optional. The screener definition's own revision counter -- not the workspace's " +
				'own revision (see expected_revision, a separate parameter). Runs this exact ' +
				'screener revision instead of the current one; rejected if that revision is no ' +
				'longer retained.'
		},
		expected_revision: {
			type: 'number',
			description:
				"Optional. The workspace's own revision, used for optimistic concurrency -- not " +
				"the screener definition's revision (see screener_revision, a separate parameter). " +
				'Rejected with a revision conflict if the workspace is no longer at this revision.'
		},
		idempotency_key: { type: 'string' }
	},
	required: ['screener_id']
};

interface RawInput {
	workspace_id?: unknown;
	screener_id?: unknown;
	screener_revision?: unknown;
	expected_revision?: unknown;
	idempotency_key?: unknown;
}

function toWireProblem(problem: ValidationProblem): Record<string, unknown> {
	return {
		severity: problem.severity,
		code: problem.code,
		node_ids: problem.nodeIds,
		universe_criteria: problem.universeCriteria,
		message: problem.message
	};
}

function toWireRefusal(refusal: ScreenerRunRefusal): Record<string, unknown> {
	return {
		status: refusal.status,
		screener_id: refusal.screenerId,
		screener_revision: refusal.screenerRevision,
		problems: refusal.problems.map(toWireProblem)
	};
}

// AC3: an explicit screener_revision names the screener's own revision
// counter (definition.ts's ScreenerDefinition.revision), not the workspace
// revision. The current screener satisfies it directly when they match;
// otherwise every retained past workspace-revision snapshot is searched for
// one whose screener carries that exact revision. None found means the
// revision is no longer retained -- reject rather than silently running a
// different one.
function resolveScreenerRevision(
	repository: WorkspaceRepository,
	workspaceId: string,
	current: ScreenerDefinition,
	screenerId: string,
	requestedRevision: number | undefined
): ScreenerDefinition {
	if (requestedRevision === undefined || current.revision === requestedRevision) {
		return current;
	}
	for (const saved of repository.listRevisions(workspaceId)) {
		const snapshot = repository.getRevision(workspaceId, saved.revision);
		const screener = snapshot ? readScreener(snapshot, screenerId) : null;
		if (screener && screener.revision === requestedRevision) {
			return screener;
		}
	}
	throw new OperationValidationError([
		"screener_revision must be the screener definition's own revision, not the workspace's " +
			`expected_revision -- revision ${requestedRevision} for screener "${screenerId}" is no ` +
			'longer retained.'
	]);
}

interface RunReplayCache {
	// Returns the recorded ToolResult on a fingerprint match, null on a miss
	// (new key), or throws IdempotencyConflictError on a fingerprint
	// mismatch -- mirroring workbench/application/idempotency.ts's
	// IdempotencyCache contract, kept private here because that cache is
	// typed to MutationEnvelope and a ScreenerRun is not one.
	lookup(key: string, fingerprint: string): ToolResult | null;
	remember(key: string, fingerprint: string, result: ToolResult): void;
}

// T-0020-2: the three panel-only registries PanelUseCaseDeps needs besides
// the six fields WorkbenchDeps already carries (repository/revisions/
// history/clock/ids/idempotency) -- injected so this module never builds
// its own registry instances, only reuses whichever ones the shared
// composition root already built (T-0020-1).
export interface PanelBindingDeps {
	kinds: PanelRegistry;
	sourceRenderer: SourceRendererRegistry;
	templates: LayoutTemplateRegistry;
}

// AC1/AC3/AC4/AC5: binds the workspace's first results_table panel (by
// existing panel order) to the just-completed run, via the exact same
// bindPanelSource application function every other panel source change
// uses -- so replacing a prior binding, and recording the change through
// RevisionService/change-history, both come for free. Best-effort (AC2):
// any failure here (a rejected source, a workspace that vanished between
// the run and this call) is swallowed by the caller, never surfacing as a
// run_screener failure.
//
// T-0020-10: when no results_table panel exists yet, one is created first
// via the same createPanel() path an agent's create_panel call would use --
// see spec.md's "Create-if-absent results panel" -- then bound exactly as
// the existing-panel branch always has. Sized 2x1 (narrower than the kind's
// own 4x2 defaultSize) and auto-placed by resolveAutoRect, the same
// placement helper createPanel itself falls back to when no explicit rect
// is given -- no new placement logic.
//
// T-0020-11: `actor` is threaded through (not hardcoded 'agent') so a
// human-triggered run (panelController.ts's runScreenerByHuman) can record
// the resulting create/bind as actor: 'human' in the action log, the same
// way every other human-vs-agent mutation in this codebase is distinguished
// -- execute() below still always passes 'agent', so run_screener's own
// tool-call behavior is unchanged. Exported (and narrowed to only the
// WorkbenchDeps fields this function actually reads) so runScreenerByHuman
// can call the exact same binding logic directly instead of duplicating it.
export function bindRunToResultsPanel(
	deps: Pick<WorkbenchDeps, 'repository' | 'revisions' | 'history' | 'clock' | 'ids'>,
	panelBinding: PanelBindingDeps,
	workspaceId: string,
	runId: string,
	actor: Actor
): void {
	const doc = deps.repository.get(workspaceId);
	if (!doc) {
		return;
	}
	const panelDeps: PanelUseCaseDeps = {
		workspaceId,
		repository: deps.repository,
		revisions: deps.revisions,
		history: deps.history,
		clock: deps.clock,
		ids: deps.ids,
		kinds: panelBinding.kinds,
		sourceRenderer: panelBinding.sourceRenderer,
		templates: panelBinding.templates
	};
	const state = readPanelState(doc);
	const existing = state.panels.find((p) => p.kind === 'results_table');
	let targetId: string;
	if (existing) {
		targetId = existing.id;
	} else {
		const rect = resolveAutoRect({ colSpan: 2, rowSpan: 1 }, visibleOccupied(state.panels));
		const created = createPanel(panelDeps, {
			context: { actor },
			kind: 'results_table',
			rect
		});
		const [newPanelId] = created.affectedIds;
		if (!newPanelId) {
			return;
		}
		targetId = newPanelId;
	}
	bindPanelSource(panelDeps, {
		context: { actor },
		panelId: targetId,
		source: { type: 'screener_results', ref: { run_id: runId } }
	});
}

function createRunReplayCache(): RunReplayCache {
	const entries = new Map<string, { fingerprint: string; result: ToolResult }>();
	return {
		lookup(key, fingerprint) {
			const entry = entries.get(key);
			if (!entry) {
				return null;
			}
			if (entry.fingerprint !== fingerprint) {
				throw new IdempotencyConflictError(key);
			}
			return entry.result;
		},
		remember(key, fingerprint, result) {
			entries.set(key, { fingerprint, result });
		}
	};
}

async function execute(
	deps: WorkbenchDeps,
	evaluationPort: ScreenerEvaluationPort,
	runStore: PinnedRunStore,
	replayCache: RunReplayCache,
	panelBinding: PanelBindingDeps | undefined,
	rawInput: unknown
): Promise<ToolResult> {
	const input = (rawInput ?? {}) as RawInput;

	const workspaceId = resolveWorkspaceId(deps, input);
	if (!workspaceId) {
		return fail('No active workspace.', { error: 'not_found' });
	}
	const screenerId = readString(input.screener_id);
	if (!screenerId) {
		return fail('run_screener requires a non-empty "screener_id".', { error: 'invalid_input' });
	}
	const requestedRevision = readOptionalNumber(input.screener_revision);
	const expectedRevision = readOptionalNumber(input.expected_revision);
	const idempotencyKey = readOptionalString(input.idempotency_key);

	const fingerprint = fingerprintRequest('screener.run_screener', {
		workspaceId,
		screenerId,
		screenerRevision: requestedRevision ?? null,
		expectedRevision: expectedRevision ?? null
	});

	if (idempotencyKey) {
		try {
			const cached = replayCache.lookup(idempotencyKey, fingerprint);
			if (cached) {
				return cached;
			}
		} catch (err) {
			return toErrorResult(err);
		}
	}

	const doc: WorkspaceDocument | null = deps.repository.get(workspaceId);
	if (!doc) {
		return fail(`Workspace not found: ${workspaceId}`, { error: 'not_found' });
	}
	if (expectedRevision !== undefined && expectedRevision !== doc.revision) {
		const err = new RevisionConflictError(expectedRevision, doc.revision, [screenerId]);
		return fail(err.message, err.toWireError());
	}
	const currentScreener = readScreener(doc, screenerId);
	if (!currentScreener) {
		return fail(`Screener not found: ${screenerId}`, { error: 'not_found', screenerId });
	}

	let definition: ScreenerDefinition;
	try {
		definition = resolveScreenerRevision(
			deps.repository,
			workspaceId,
			currentScreener,
			screenerId,
			requestedRevision
		);
	} catch (err) {
		return toErrorResult(err);
	}

	const runId = deps.ids.next('run');
	// AC2 (deviation note, T-1009-10): ScreenerEvaluationPort.execute reaches
	// through to ScreenerMarketData -- a rejected promise there (an
	// unavailable data source, a fake engine wired to fail in a test) must
	// surface as a tool error an agent can act on, never an unhandled
	// rejection out of this async function.
	let outcome: ScreenerRunOutcome;
	try {
		outcome = await evaluationPort.execute({ definition, runId });
	} catch (err) {
		return toErrorResult(err);
	}

	let result: ToolResult;
	if (outcome.status === 'refused') {
		// AC7: the minted runId is simply discarded -- nothing is stored, and
		// no run_id appears anywhere in the response.
		result = ok(toWireRefusal(outcome));
	} else {
		runStore.putRun(outcome);
		result = ok(toWireScreenerRun(outcome));
		if (panelBinding) {
			try {
				bindRunToResultsPanel(deps, panelBinding, workspaceId, runId, 'agent');
			} catch (err) {
				// AC2/AC5: best-effort -- binding never blocks or alters
				// run_screener's own already-built success response. Still logged
				// (not silently swallowed) so a real binding defect stays visible,
				// matching this codebase's convention for comparable best-effort
				// failures (register.ts, session.ts).
				console.warn(
					'run_screener: auto-bind to results_table panel failed (best-effort, run itself still succeeded)',
					err
				);
			}
		}
	}

	if (idempotencyKey) {
		replayCache.remember(idempotencyKey, fingerprint, result);
	}
	return result;
}

export interface RunScreenerToolOptions {
	registry?: CatalogRegistry;
	// T-1009-7's honest-unavailability default when no real adapter is wired
	// in, matching validate_screener's own default.
	marketData?: ScreenerMarketData;
	costBudget?: number;
	// Defaults to createScreenerEngine wired to the rich validator (AC7);
	// injectable so tests can wrap a counting fake and prove AC10/AC4/AC5
	// without touching real evaluation.
	evaluationPort?: ScreenerEvaluationPort;
	runStore?: PinnedRunStore;
	now?: () => Date;
	// T-0020-2: when supplied, a successful run auto-binds the workspace's
	// first results_table panel to it (best-effort -- see
	// bindRunToResultsPanel). Omitted entirely means no binding is attempted,
	// matching every other caller/test of this tool before T-0020-2.
	panelBinding?: PanelBindingDeps;
}

export function createRunScreenerTool(
	deps: WorkbenchDeps,
	options: RunScreenerToolOptions = {}
): ToolSpec {
	const registry = options.registry ?? builtinCatalogRegistry;
	const marketData = options.marketData ?? createUnavailableMarketData();
	const evaluationPort =
		options.evaluationPort ??
		createScreenerEngine({
			marketData,
			registry,
			validateDefinition: (definition) =>
				validateScreenerDefinition(definition, {
					registry,
					marketData,
					costBudget: options.costBudget
				}),
			now: options.now
		});
	const runStore = options.runStore ?? createPinnedRunStore();
	const replayCache = createRunReplayCache();
	return {
		name: 'run_screener',
		description: DESCRIPTION,
		inputSchema: INPUT_SCHEMA,
		available: () => true,
		execute: (input) =>
			execute(deps, evaluationPort, runStore, replayCache, options.panelBinding, input)
	};
}
