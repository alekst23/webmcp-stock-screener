// `validate_screener` (T-1009-8): a read-only dry run over one screener --
// invalid parameters, unavailable data, contradictory filters, an expensive
// query, and an empty universe, all in one response, before anything is
// executed (spec.md "Validate a screener"). The domain logic lives in
// src/lib/screener/screenerValidation.ts; this module only resolves the
// screener from the repository and shapes the wire response.
//
// AC8: this tool never calls RevisionService.commit, never calls
// recordCommit, never writes through the repository, and does not accept
// expected_revision or idempotency_key -- there is no write path to enter.

import { builtinCatalogRegistry, type CatalogRegistry } from '../../catalog/registry';
import type { ScreenerMarketData } from '../../screener/ports';
import { validateScreenerDefinition } from '../../screener/screenerValidation';
import { readScreener } from '../../screener/state';
import type {
	CostEstimate,
	ScreenerValidationReport,
	ValidationProblem
} from '../../screener/validation';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import { fail, ok } from '../tools';
import type { ToolResult, ToolSpec } from '../types';
import { readString, resolveWorkspaceId, toErrorResult } from './support';

const DESCRIPTION =
	'Validates a screener without executing it: reports invalid parameters, data unavailable for ' +
	'part of the universe, filters that cannot both hold, an estimated execution cost against a ' +
	'configured budget, and a universe that resolves to zero instruments. Every independent ' +
	'problem is reported together, not just the first. Blocking problems must be fixed before ' +
	'run_screener will execute; advisory problems (degraded coverage, an over-budget cost ' +
	'estimate) are informational. Contradiction detection covers the tractable cases (disjoint ' +
	'ranges and mutually exclusive scalar bounds on one field under AND) and is never exhaustive -- ' +
	'the response says so explicitly. Read-only: mutates nothing and does not advance the ' +
	'workspace revision.';

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		screener_id: { type: 'string' }
	},
	required: ['screener_id']
};

interface RawInput {
	workspace_id?: unknown;
	screener_id?: unknown;
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

function toWireCostEstimate(estimate: CostEstimate | null): Record<string, unknown> | null {
	if (!estimate) {
		return null;
	}
	return {
		estimated_instrument_days: estimate.estimatedInstrumentDays,
		budget: estimate.budget,
		driver: estimate.driver
	};
}

// snake_case on the wire, per the tool-input convention -- the domain
// report (screener/validation.ts's ScreenerValidationReport) stays
// camelCase internally.
function toWireValidationReport(report: ScreenerValidationReport): Record<string, unknown> {
	return {
		screener_id: report.screenerId,
		screener_revision: report.screenerRevision,
		valid: report.valid,
		problems: report.problems.map(toWireProblem),
		skipped_node_ids: report.skippedNodeIds,
		cost_estimate: toWireCostEstimate(report.costEstimate),
		detection_exhaustive: report.detectionExhaustive
	};
}

async function execute(
	deps: WorkbenchDeps,
	registry: CatalogRegistry,
	marketData: ScreenerMarketData | undefined,
	costBudget: number | undefined,
	rawInput: unknown
): Promise<ToolResult> {
	const input = (rawInput ?? {}) as RawInput;

	const workspaceId = resolveWorkspaceId(deps, input);
	if (!workspaceId) {
		return fail('No active workspace.', { error: 'not_found' });
	}
	const doc = deps.repository.get(workspaceId);
	if (!doc) {
		return fail(`Workspace not found: ${workspaceId}`, { error: 'not_found' });
	}

	const screenerId = readString(input.screener_id);
	if (!screenerId) {
		return fail('validate_screener requires a non-empty "screener_id".', {
			error: 'invalid_input'
		});
	}
	const screener = readScreener(doc, screenerId);
	if (!screener) {
		return fail(`Screener not found: ${screenerId}`, { error: 'not_found', screenerId });
	}

	// Reads the current document and hands the screener straight to the pure
	// validator -- no mutate() callback, no RevisionService, no write path
	// exists for this function to accidentally take. validateScreenerDefinition
	// already catches a rejecting ScreenerMarketData.resolveUniverse
	// internally (screenerValidation.ts), but this still guards against any
	// other unexpected rejection reaching this tool's caller (AC2's "never an
	// unhandled rejection").
	try {
		const report = await validateScreenerDefinition(screener, { registry, marketData, costBudget });
		return ok(toWireValidationReport(report));
	} catch (err) {
		return toErrorResult(err);
	}
}

export interface ValidateScreenerToolOptions {
	registry?: CatalogRegistry;
	// T-1009-7 ships the real adapter; absent means AC6's "cannot resolve"
	// case, honestly reported rather than claiming an empty universe.
	marketData?: ScreenerMarketData;
	costBudget?: number;
}

// `registry` defaults to the built-in catalog, matching every other
// screener tool in this epic; `marketData` and `costBudget` default to
// undefined, matching screenerValidation.ts's own documented defaults.
export function createValidateScreenerTool(
	deps: WorkbenchDeps,
	options: ValidateScreenerToolOptions = {}
): ToolSpec {
	const registry = options.registry ?? builtinCatalogRegistry;
	return {
		name: 'validate_screener',
		description: DESCRIPTION,
		inputSchema: INPUT_SCHEMA,
		available: () => true,
		execute: (input) => execute(deps, registry, options.marketData, options.costBudget, input)
	};
}
