// The whole-screener validator (T-1009-8): a dry run reporting everything
// that can be known about a screener without executing it -- invalid
// parameters, data that will not be there, filters that cannot both hold,
// queries that will be expensive, and universes that are empty. Delegates
// per-condition catalog checks to conditionValidation.ts (T-1009-6, AC2)
// and keeps its own job to what that module does not cover: general
// data-availability status, cross-condition contradictions (AC4, split into
// screenerValidation.contradictions.ts), universe resolution (AC6), and
// cost (AC5).
//
// `validateScreenerDefinition` is a clean standalone function, not a method
// on anything -- T-1009-10 is expected to close over its own registry/
// marketData/costBudget and hand the result to
// ScreenerEvaluationPort.validate, whose signature takes only a
// ScreenerDefinition (ports.ts).
//
// Domain layer: no I/O beyond the optional injected ScreenerMarketData port,
// no import from src/lib/webmcp/ or from src/lib/screener/engine/.

import { builtinCatalogRegistry, type CatalogRegistry } from '../catalog/registry';
import type { ResourceId } from '../workbench/domain/ids';
import { validateCondition } from './conditionValidation';
import type { Condition } from './conditions';
import type { ConditionNode, ScreenerDefinition, UniverseSpec, FilterNode } from './definition';
import type { ScreenerMarketData } from './ports';
import { detectGroupContradictions } from './screenerValidation.contradictions';
import {
	PROBLEM_CODES,
	type CostEstimate,
	type ScreenerValidationReport,
	type ValidationProblem
} from './validation';

export interface ScreenerValidationOptions {
	registry?: CatalogRegistry;
	// T-1009-7 ships the real adapter and an honest-unavailability default
	// (ports.ts); absent here means "cannot resolve the universe", which AC6
	// requires be reported as unknown, never as zero.
	marketData?: ScreenerMarketData;
	costBudget?: number;
}

// spec.md Open Question 2's documented default: at the default one-year
// lookback, this budget covers a full-market daily screen (~8,000
// instruments x 252 trading days ~= 2,016,000 instrument-days) with
// headroom before an advisory warning fires.
export const DEFAULT_COST_BUDGET_INSTRUMENT_DAYS = 5_000_000;
// One trading year: the assumed evaluation horizon when no condition in the
// tree names an explicit window.
export const DEFAULT_LOOKBACK_DAYS = 252;
// Used only to keep the cost estimate meaningful when the universe cannot
// be resolved (no injected ScreenerMarketData) -- never used to answer
// AC6's empty-universe question, which requires an actual resolution.
export const DEFAULT_ASSUMED_UNIVERSE_SIZE = 8000;

interface WalkAccumulator {
	problems: ValidationProblem[];
	skippedNodeIds: ResourceId[];
	bestWindow: { value: number; nodeId: ResourceId } | null;
}

// A disabled node's whole subtree is skipped (AC7): the node itself, and
// every descendant regardless of that descendant's own `enabled` flag.
function collectAllIds(node: FilterNode, out: ResourceId[]): void {
	out.push(node.nodeId);
	if (node.kind === 'group') {
		for (const child of node.children) {
			collectAllIds(child, out);
		}
	}
}

// The catalog IDs one condition level (not its recursive children, if any)
// reads data through. `temporal` returns none of its own -- its inner
// condition is visited separately by visitConditionVariants below.
function collectCatalogRefs(condition: Condition): string[] {
	switch (condition.type) {
		case 'scalar':
		case 'range':
		case 'relative':
			return [condition.fieldId];
		case 'series_comparison':
			return [condition.left.catalogId, condition.right.catalogId];
		case 'study_output':
			return [condition.studyId];
		case 'event_relative':
			return [condition.eventTypeId];
		case 'pattern':
			return [condition.patternId];
		case 'temporal':
			return [];
	}
}

// The bar/day window a condition asks for, when it declares one explicitly
// -- used only to drive the cost estimate's lookback (AC5), not validity.
function windowBarsOf(condition: Condition): number | null {
	if (condition.type === 'temporal') {
		return condition.withinBars;
	}
	if (condition.type === 'relative' && condition.baseline.kind === 'own_moving_average') {
		return condition.baseline.windowBars;
	}
	return null;
}

// temporal.ts's Condition recursion is one level (temporal wraps exactly
// one inner Condition); walking it here, once, lets both the availability
// check and the cost-window scan see the inner condition without each
// re-implementing the recursion.
function visitConditionVariants(
	nodeId: ResourceId,
	condition: Condition,
	fn: (nodeId: ResourceId, condition: Condition) => void
): void {
	fn(nodeId, condition);
	if (condition.type === 'temporal') {
		visitConditionVariants(nodeId, condition.condition, fn);
	}
}

function universeCriteriaOf(universe: UniverseSpec): string[] {
	const parts: string[] = [];
	if (universe.assetClass) {
		parts.push(`asset_class=${universe.assetClass}`);
	}
	const dimensions: [string, readonly string[]][] = [
		['exchanges', universe.exchanges],
		['countries', universe.countries],
		['sectors', universe.sectors],
		['industries', universe.industries],
		['indexes', universe.indexes],
		['watchlists', universe.watchlists]
	];
	for (const [label, values] of dimensions) {
		if (values.length > 0) {
			parts.push(`${label}=${values.join('|')}`);
		}
	}
	return parts;
}

// AC3: an item's declared DataAvailability -- never a hard-coded field list
// or a fetched calendar -- decides whether a reference blocks execution
// ('unavailable') or merely degrades coverage ('partial'). 'available'
// produces nothing.
function availabilityProblems(
	nodeId: ResourceId,
	condition: Condition,
	registry: CatalogRegistry,
	universe: UniverseSpec
): ValidationProblem[] {
	const criteria = universeCriteriaOf(universe);
	const scope = criteria.length > 0 ? ` for ${criteria.join(', ')}` : '';
	const problems: ValidationProblem[] = [];
	for (const id of collectCatalogRefs(condition)) {
		const item = registry.getCatalogItem(id);
		if (!item || item.availability.status === 'available') {
			continue; // unknown items are conditionValidation.ts's job, not this pass's
		}
		const blocking = item.availability.status === 'unavailable';
		problems.push({
			severity: blocking ? 'blocking' : 'advisory',
			code: PROBLEM_CODES.unavailableData,
			nodeIds: [nodeId],
			universeCriteria: criteria,
			message: blocking
				? `"${id}" is unavailable${scope}: ${item.availability.reason} This blocks execution.`
				: `"${id}" has only partial coverage${scope}: ${item.availability.reason} This degrades ` +
					'coverage rather than blocking execution.'
		});
	}
	return problems;
}

function processConditionNode(
	nodeId: ResourceId,
	condition: Condition,
	registry: CatalogRegistry,
	universe: UniverseSpec,
	acc: WalkAccumulator
): void {
	// AC2: validateCondition already recurses into temporal's inner
	// condition on its own, so it is called exactly once here.
	acc.problems.push(...validateCondition(condition, { registry, universe, nodeId }));
	visitConditionVariants(nodeId, condition, (innerNodeId, innerCondition) => {
		acc.problems.push(...availabilityProblems(innerNodeId, innerCondition, registry, universe));
		const window = windowBarsOf(innerCondition);
		if (window !== null && (!acc.bestWindow || window > acc.bestWindow.value)) {
			acc.bestWindow = { value: window, nodeId: innerNodeId };
		}
	});
}

// AC7 (skip disabled) + AC2/AC3 (per-condition checks) + AC4 (contradictions
// among one AND group's direct enabled condition children).
function walk(
	node: FilterNode,
	registry: CatalogRegistry,
	universe: UniverseSpec,
	acc: WalkAccumulator
): void {
	if (!node.enabled) {
		collectAllIds(node, acc.skippedNodeIds);
		return;
	}
	if (node.kind === 'condition') {
		processConditionNode(node.nodeId, node.condition, registry, universe, acc);
		return;
	}
	for (const child of node.children) {
		walk(child, registry, universe, acc);
	}
	if (node.op === 'and') {
		const siblings = node.children.filter(
			(child): child is ConditionNode => child.kind === 'condition' && child.enabled
		);
		acc.problems.push(...detectGroupContradictions(siblings));
	}
}

interface UniverseSizeResolution {
	resolvable: boolean;
	count: number;
}

async function resolveUniverseSize(
	universe: UniverseSpec,
	marketData: ScreenerMarketData | undefined
): Promise<UniverseSizeResolution> {
	if (!marketData) {
		return { resolvable: false, count: 0 };
	}
	try {
		const ids = await marketData.resolveUniverse(universe);
		return { resolvable: true, count: ids.length };
	} catch {
		// An honest "cannot resolve", matching ports.ts's unavailability
		// convention, not a thrown error surfaced to the caller.
		return { resolvable: false, count: 0 };
	}
}

// AC6: only a genuine resolution to zero is reported as empty; an
// unresolvable universe is never claimed to be zero (checked by the caller,
// which only invokes this when resolvable && count === 0).
function emptyUniverseProblem(universe: UniverseSpec): ValidationProblem {
	const criteria = universeCriteriaOf(universe);
	return {
		severity: 'blocking',
		code: PROBLEM_CODES.emptyUniverse,
		nodeIds: [],
		universeCriteria: criteria.length > 0 ? criteria : ['(no universe criteria set)'],
		message:
			criteria.length > 0
				? `The universe resolves to zero instruments. Applied criteria: ${criteria.join(', ')} ` +
					'-- one or more of these eliminated every instrument.'
				: 'The universe resolves to zero instruments even though no narrowing criteria are set.'
	};
}

function lookbackFrom(bestWindow: WalkAccumulator['bestWindow']): { days: number; driver: string } {
	if (!bestWindow || bestWindow.value <= DEFAULT_LOOKBACK_DAYS) {
		return {
			days: DEFAULT_LOOKBACK_DAYS,
			driver:
				`the default ${DEFAULT_LOOKBACK_DAYS}-day lookback (no explicit window in the ` +
				'filter tree exceeds it)'
		};
	}
	return {
		days: bestWindow.value,
		driver: `node ${bestWindow.nodeId}'s ${bestWindow.value}-bar window`
	};
}

// AC5: estimated instrument-days = universe size x lookback days, reported
// with a named driver so the estimate is actionable, never a bare number.
function computeCostEstimate(
	universeSize: UniverseSizeResolution,
	bestWindow: WalkAccumulator['bestWindow'],
	budget: number
): CostEstimate {
	const size = universeSize.resolvable ? universeSize.count : DEFAULT_ASSUMED_UNIVERSE_SIZE;
	const { days, driver } = lookbackFrom(bestWindow);
	const sizeDriver = universeSize.resolvable
		? `universe_size (${size} resolved instruments)`
		: `universe_size (assumed ${size}; the universe could not be resolved)`;
	return {
		estimatedInstrumentDays: size * days,
		budget,
		driver: `${sizeDriver} x lookback_days (${days}, driven by ${driver})`
	};
}

function costWarning(estimate: CostEstimate): ValidationProblem {
	return {
		severity: 'advisory',
		code: PROBLEM_CODES.expensiveQuery,
		nodeIds: [],
		universeCriteria: [],
		message:
			`Estimated cost is ${estimate.estimatedInstrumentDays} instrument-days, above the ` +
			`configured budget of ${estimate.budget}. Main driver: ${estimate.driver}. This is an ` +
			'estimate, not a refusal -- decide whether to proceed.'
	};
}

// The one exported entry point (per the ticket): a dry run over a screener
// definition. Reads only -- no repository, no revision, no mutation of
// `screener` or anything it references (AC8; the tool wrapping this in
// src/lib/webmcp/screener/validateScreener.ts never calls a write path).
export async function validateScreenerDefinition(
	screener: ScreenerDefinition,
	options: ScreenerValidationOptions = {}
): Promise<ScreenerValidationReport> {
	const registry = options.registry ?? builtinCatalogRegistry;
	const acc: WalkAccumulator = { problems: [], skippedNodeIds: [], bestWindow: null };
	walk(screener.filterTree, registry, screener.universe, acc);

	const universeSize = await resolveUniverseSize(screener.universe, options.marketData);
	if (universeSize.resolvable && universeSize.count === 0) {
		acc.problems.push(emptyUniverseProblem(screener.universe));
	}

	const budget = options.costBudget ?? DEFAULT_COST_BUDGET_INSTRUMENT_DAYS;
	const costEstimate = computeCostEstimate(universeSize, acc.bestWindow, budget);
	if (costEstimate.estimatedInstrumentDays > budget) {
		acc.problems.push(costWarning(costEstimate));
	}

	return {
		screenerId: screener.screenerId,
		screenerRevision: screener.revision,
		valid: acc.problems.every((problem) => problem.severity !== 'blocking'),
		problems: acc.problems,
		skippedNodeIds: acc.skippedNodeIds,
		costEstimate,
		detectionExhaustive: false
	};
}
