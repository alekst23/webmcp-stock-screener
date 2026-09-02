// createScreenerEngine (T-1009-7): the infra adapter implementing
// ScreenerEvaluationPort (ports.ts) by composing universe.ts, tree.ts and
// ranking.ts. This is the one file domain/webmcp code reaches for when it
// needs to run or validate a screener; everything else in engine/ is a
// module this file wires together.
//
// Infra layer: implements the domain port; domain code does not import this
// file (ports.ts declares the boundary the other direction).

import { builtinCatalogRegistry, type CatalogRegistry } from '../../catalog/registry';
import type { ResourceId } from '../../workbench/domain/ids';
import { validateCondition } from '../conditionValidation';
import type { FilterNode, ScreenerDefinition } from '../definition';
import type { ScreenerEvaluationPort, ScreenerMarketData } from '../ports';
import {
	makeScreenerRun,
	type ScreenerMatch,
	type ScreenerRunOutcome,
	type ScreenerWarning
} from '../run';
import {
	parseScreenerForExecution,
	PROBLEM_CODES,
	type ScreenerValidationReport,
	type ValidationProblem
} from '../validation';
import type { ConditionEvalDeps } from './conditionEvaluation';
import { applyRanking } from './ranking';
import { evaluateFilterTree, type TreeEvalResult } from './tree';
import { resolveEngineUniverse } from './universe';

export interface ScreenerEngineDeps {
	marketData: ScreenerMarketData;
	// Defaults to the built-in catalog so call sites need not thread one
	// through for the common case.
	registry?: CatalogRegistry;
	// Defaults to a minimal structural validator (parseScreenerForExecution +
	// per-enabled-condition validateCondition). T-1009-8's rich
	// validateScreenerDefinition (contradictions, cost, empty universe) is
	// injected here by T-1009-10 -- this ticket does not implement either.
	validateDefinition?: (
		definition: ScreenerDefinition
	) => Promise<ScreenerValidationReport> | ScreenerValidationReport;
	// Injectable for deterministic tests (AC7); defaults to the wall clock.
	now?: () => Date;
}

interface ResolvedDeps {
	marketData: ScreenerMarketData;
	registry: CatalogRegistry;
	now: () => Date;
	validateDefinition: (
		definition: ScreenerDefinition
	) => Promise<ScreenerValidationReport> | ScreenerValidationReport;
}

// A non-PROBLEM_CODES warning: "the universe had members but none matched"
// is a distinct, run-only condition from PROBLEM_CODES.emptyUniverse (the
// universe itself had zero members), so it is not one of validation.ts's
// vocabulary and is named here instead.
const ZERO_MATCHES_WARNING_CODE = 'empty_result';

function walkForDefaultValidation(
	node: FilterNode,
	registry: CatalogRegistry,
	problems: ValidationProblem[],
	skippedNodeIds: ResourceId[]
): void {
	if (!node.enabled) {
		skippedNodeIds.push(node.nodeId);
		return;
	}
	if (node.kind === 'condition') {
		problems.push(...validateCondition(node.condition, { registry, nodeId: node.nodeId }));
		return;
	}
	for (const child of node.children) {
		walkForDefaultValidation(child, registry, problems, skippedNodeIds);
	}
}

// The minimal structural validator this ticket owns: parseScreenerForExecution
// (unknown condition types) plus per-enabled-condition catalog validation
// (conditionValidation.ts). No contradiction detection, no cost estimate --
// that is T-1009-8's validateScreenerDefinition, wired in later.
function defaultValidate(
	definition: ScreenerDefinition,
	registry: CatalogRegistry
): ScreenerValidationReport {
	const parsed = parseScreenerForExecution(definition);
	if (!parsed.ok) {
		return {
			screenerId: definition.screenerId,
			screenerRevision: definition.revision,
			valid: false,
			problems: parsed.problems,
			skippedNodeIds: [],
			costEstimate: null,
			detectionExhaustive: false
		};
	}
	const problems: ValidationProblem[] = [];
	const skippedNodeIds: ResourceId[] = [];
	walkForDefaultValidation(parsed.screener.filterTree, registry, problems, skippedNodeIds);
	return {
		screenerId: parsed.screener.screenerId,
		screenerRevision: parsed.screener.revision,
		valid: problems.length === 0,
		problems,
		skippedNodeIds,
		costEstimate: null,
		detectionExhaustive: false
	};
}

// Evaluates the filter tree for every universe instrument, keeping the full
// per-instrument TreeEvalResult (nodeEvaluations included) only for
// instruments that matched -- AC12's memory bound: this map's size is the
// matched-set size, never the universe size.
async function evaluateUniverse(
	filterTree: FilterNode,
	instrumentIds: readonly string[],
	deps: ConditionEvalDeps
): Promise<{
	matched: Map<string, TreeEvalResult>;
	unavailableNodeCounts: Map<ResourceId, number>;
}> {
	const matched = new Map<string, TreeEvalResult>();
	const unavailableNodeCounts = new Map<ResourceId, number>();
	for (const instrumentId of instrumentIds) {
		const result = await evaluateFilterTree(filterTree, instrumentId, deps);
		for (const nodeId of result.unavailableNodeIds) {
			unavailableNodeCounts.set(nodeId, (unavailableNodeCounts.get(nodeId) ?? 0) + 1);
		}
		if (result.passed) {
			matched.set(instrumentId, result);
		}
	}
	return { matched, unavailableNodeCounts };
}

function buildWarnings(
	universeWarnings: readonly ScreenerWarning[],
	universeCount: number,
	matchedCount: number,
	unavailableNodeCounts: ReadonlyMap<ResourceId, number>,
	unavailableFieldIds: readonly string[]
): ScreenerWarning[] {
	const warnings: ScreenerWarning[] = [...universeWarnings];
	if (universeCount > 0 && matchedCount === 0) {
		warnings.push({
			code: ZERO_MATCHES_WARNING_CODE,
			message: 'No instrument in the universe satisfied the filter tree. This is a normal result.'
		});
	}
	for (const [nodeId, count] of unavailableNodeCounts) {
		warnings.push({
			code: PROBLEM_CODES.unavailableData,
			message: `Data was unavailable for ${count} of ${universeCount} universe instrument(s) on this node.`,
			nodeIds: [nodeId]
		});
	}
	if (unavailableFieldIds.length > 0) {
		warnings.push({
			code: PROBLEM_CODES.unavailableData,
			message: `Ranking field(s) unavailable for part of the matched set: ${unavailableFieldIds.join(', ')}.`
		});
	}
	return warnings;
}

async function execute(
	input: { definition: ScreenerDefinition; runId: ResourceId },
	deps: ResolvedDeps
): Promise<ScreenerRunOutcome> {
	const validation = await deps.validateDefinition(input.definition);
	const blockingProblems = validation.problems.filter((problem) => problem.severity === 'blocking');
	if (blockingProblems.length > 0) {
		return {
			status: 'refused',
			screenerId: input.definition.screenerId,
			screenerRevision: input.definition.revision,
			problems: validation.problems
		};
	}

	const universeResolution = await resolveEngineUniverse(
		input.definition.universe,
		deps.marketData
	);
	const conditionDeps: ConditionEvalDeps = {
		marketData: deps.marketData,
		registry: deps.registry,
		now: deps.now
	};
	const { matched, unavailableNodeCounts } = await evaluateUniverse(
		input.definition.filterTree,
		universeResolution.instrumentIds,
		conditionDeps
	);
	const matchedInstrumentIds = [...matched.keys()];

	const ranking = await applyRanking(
		matchedInstrumentIds,
		input.definition.ranking,
		deps.marketData
	);
	const returnedRanked = ranking.ranked.slice(0, ranking.limit);
	const matches: ScreenerMatch[] = returnedRanked.map((ranked, index) => ({
		instrumentId: ranked.instrumentId,
		rank: index + 1,
		compositeScore: ranked.compositeScore,
		rankingValues: ranked.rankingValues,
		nodeEvaluations: matched.get(ranked.instrumentId)?.nodeEvaluations ?? {}
	}));

	const provenance = await deps.marketData.getProvenance();
	return makeScreenerRun({
		runId: input.runId,
		screenerId: input.definition.screenerId,
		screenerRevision: input.definition.revision,
		status: 'complete',
		universeCount: universeResolution.instrumentIds.length,
		matchedCount: matchedInstrumentIds.length,
		returnedCount: matches.length,
		truncated: matches.length < matchedInstrumentIds.length,
		rankingApplied: ranking.rankingApplied,
		normalization: ranking.normalization,
		warnings: buildWarnings(
			universeResolution.warnings,
			universeResolution.instrumentIds.length,
			matchedInstrumentIds.length,
			unavailableNodeCounts,
			ranking.unavailableFieldIds
		),
		provenance,
		matches,
		createdAt: deps.now().toISOString()
	});
}

export function createScreenerEngine(deps: ScreenerEngineDeps): ScreenerEvaluationPort {
	const registry = deps.registry ?? builtinCatalogRegistry;
	const now = deps.now ?? (() => new Date());
	const validateDefinition =
		deps.validateDefinition ??
		((definition: ScreenerDefinition) => defaultValidate(definition, registry));
	const resolved: ResolvedDeps = { marketData: deps.marketData, registry, now, validateDefinition };
	return {
		validate: (definition) => Promise.resolve(resolved.validateDefinition(definition)),
		execute: (input) => execute(input, resolved)
	};
}
