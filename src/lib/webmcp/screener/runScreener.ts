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
import { createScreenerEngine } from '../../screener/engine/engine';
import { createUnavailableMarketData } from '../../screener/engine/unavailableMarketData';
import { createPinnedRunStore } from '../../screener/runStore';
import type { PinnedRunStore } from '../../screener/ports';
import type { ScreenerEvaluationPort, ScreenerMarketData } from '../../screener/ports';
import { toWireScreenerRun, type ScreenerRunRefusal } from '../../screener/run';
import { validateScreenerDefinition } from '../../screener/screenerValidation';
import { readScreener } from '../../screener/state';
import type { ScreenerDefinition } from '../../screener/definition';
import { fingerprintRequest } from '../../workbench/application/idempotency';
import {
	IdempotencyConflictError,
	OperationValidationError,
	RevisionConflictError
} from '../../workbench/domain/errors';
import type { WorkspaceDocument } from '../../workbench/domain/workspace';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import type { WorkspaceRepository } from '../../workbench/domain/ports';
import type { ValidationProblem } from '../../screener/validation';
import { fail, ok } from '../tools';
import type { ToolResult, ToolSpec } from '../types';

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
				'Optional. Runs this exact screener revision instead of the current one; rejected ' +
				'if that revision is no longer retained.'
		},
		expected_revision: { type: 'number' },
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

function resolveWorkspaceId(deps: WorkbenchDeps, input: RawInput): string | null {
	if (typeof input.workspace_id === 'string') {
		return input.workspace_id;
	}
	return deps.repository.getActiveId();
}

// Mirrors workbench/tools/index.ts's toErrorResult -- a private equivalent,
// per this ticket's instructions, rather than an import from a file this
// ticket must not modify.
function toErrorResult(err: unknown): ToolResult {
	if (
		err instanceof RevisionConflictError ||
		err instanceof IdempotencyConflictError ||
		err instanceof OperationValidationError
	) {
		return fail(err.message, err.toWireError());
	}
	return fail(err instanceof Error ? err.message : String(err));
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
		`Screener revision ${requestedRevision} for screener "${screenerId}" is no longer retained.`
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
	rawInput: unknown
): Promise<ToolResult> {
	const input = (rawInput ?? {}) as RawInput;

	const workspaceId = resolveWorkspaceId(deps, input);
	if (!workspaceId) {
		return fail('No active workspace.', { error: 'not_found' });
	}
	const screenerId = typeof input.screener_id === 'string' ? input.screener_id : '';
	if (!screenerId) {
		return fail('run_screener requires a non-empty "screener_id".', { error: 'invalid_input' });
	}
	const requestedRevision =
		typeof input.screener_revision === 'number' ? input.screener_revision : undefined;
	const expectedRevision =
		typeof input.expected_revision === 'number' ? input.expected_revision : undefined;
	const idempotencyKey =
		typeof input.idempotency_key === 'string' ? input.idempotency_key : undefined;

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
	const outcome = await evaluationPort.execute({ definition, runId });

	let result: ToolResult;
	if (outcome.status === 'refused') {
		// AC7: the minted runId is simply discarded -- nothing is stored, and
		// no run_id appears anywhere in the response.
		result = ok(toWireRefusal(outcome));
	} else {
		runStore.putRun(outcome);
		result = ok(toWireScreenerRun(outcome));
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
		execute: (input) => execute(deps, evaluationPort, runStore, replayCache, input)
	};
}
