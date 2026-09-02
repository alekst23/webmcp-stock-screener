// Validation problem model and the strict execution-time parser (T-1009-2).
// T-1009-1's `normalizeScreener` is deliberately lenient -- a browser-side
// editing tool must never throw on a malformed screener, so it drops what it
// cannot understand and keeps going. Execution cannot make that same choice:
// silently dropping an unrecognized condition would run a screener that
// looks like what the caller asked for but isn't. This module is the strict
// sibling that reports the problem instead of hiding it.
//
// Domain layer: no I/O, no import from infra or from src/lib/webmcp/.

import type { ResourceId } from '../workbench/domain/ids';
import type { Revision } from '../workbench/domain/workspace';
import { normalizeCondition, type Condition } from './conditions';
import {
	emptyFilterTree,
	normalizeRanking,
	normalizeUniverse,
	type FilterNode,
	type ScreenerDefinition
} from './definition';

export type ProblemSeverity = 'blocking' | 'advisory';

// One machine-readable vocabulary for every problem this epic emits, so
// T-1009-6/7/8 (ranking, execution, validation) cite the same strings
// instead of each inventing its own. Values are the wire-facing codes;
// names are the camelCase handles code refers to them by.
export const PROBLEM_CODES = {
	invalidParameter: 'invalid_parameter',
	unknownCatalogItem: 'unknown_catalog_item',
	unavailableData: 'unavailable_data',
	contradiction: 'contradiction',
	expensiveQuery: 'expensive_query',
	emptyUniverse: 'empty_universe',
	unknownConditionType: 'unknown_condition_type'
} as const;

export type ProblemCode = (typeof PROBLEM_CODES)[keyof typeof PROBLEM_CODES];

// `code` is machine-readable (for the tools consuming this to branch on),
// `message` is for a human. Both are kept because neither can stand in for
// the other -- see spec.md's "Validate a screener" scenarios, every one of
// which names both what went wrong and where.
export interface ValidationProblem {
	severity: ProblemSeverity;
	code: string;
	nodeIds: ResourceId[];
	universeCriteria: string[];
	message: string;
}

// spec.md Open Question 2: a configurable estimated-instrument-days budget
// with a documented default. `driver` names what pushed the estimate up
// (e.g. "universe_size x lookback_bars") so the warning is actionable, not
// just a number.
export interface CostEstimate {
	estimatedInstrumentDays: number;
	budget: number;
	driver: string;
}

// Returned by ScreenerEvaluationPort.validate (T-1009-8 implements it).
// `detectionExhaustive: false` is a literal, not a bug: contradiction
// detection (spec.md "Contradiction") is deliberately not exhaustive --
// absence of a contradiction problem is not a proof of consistency, and
// this field says so on every report rather than leaving it to prose.
export interface ScreenerValidationReport {
	screenerId: ResourceId;
	screenerRevision: Revision;
	valid: boolean;
	problems: ValidationProblem[];
	skippedNodeIds: ResourceId[];
	costEstimate: CostEstimate | null;
	detectionExhaustive: false;
}

export type ScreenerParseResult =
	{ ok: true; screener: ScreenerDefinition } | { ok: false; problems: ValidationProblem[] };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const CONDITION_TYPES: ReadonlySet<string> = new Set<Condition['type']>([
	'scalar',
	'range',
	'series_comparison',
	'temporal',
	'event_relative',
	'pattern',
	'relative',
	'study_output'
]);

function unknownConditionTypeProblem(nodeId: string, type: unknown): ValidationProblem {
	return {
		severity: 'blocking',
		code: PROBLEM_CODES.unknownConditionType,
		nodeIds: nodeId ? [nodeId] : [],
		universeCriteria: [],
		message: `Node ${nodeId || '(unknown)'} carries an unrecognized condition type: ${JSON.stringify(type)}.`
	};
}

// Disabled nodes are not checked -- spec.md's "Disabled nodes" scenario is
// explicit that a disabled node "produces no problems and is reported as
// skipped", so an unrecognized type sitting inside a disabled node is not
// a parse failure.
function parseConditionNode(
	nodeId: string,
	source: Record<string, unknown>,
	enabled: boolean,
	problems: ValidationProblem[]
): FilterNode | null {
	const conditionValue = source.condition;
	if (enabled) {
		const type = isRecord(conditionValue) ? conditionValue.type : undefined;
		if (typeof type !== 'string' || !CONDITION_TYPES.has(type)) {
			problems.push(unknownConditionTypeProblem(nodeId, type));
			return null;
		}
	}
	const condition = normalizeCondition(conditionValue);
	return condition === null ? null : { nodeId, kind: 'condition', condition, enabled };
}

function parseGroupNode(
	nodeId: string,
	source: Record<string, unknown>,
	enabled: boolean,
	problems: ValidationProblem[]
): FilterNode {
	const op = source.op === 'or' ? 'or' : source.op === 'not' ? 'not' : 'and';
	const rawChildren = Array.isArray(source.children) ? source.children : [];
	const children: FilterNode[] = [];
	for (const child of rawChildren) {
		const parsed = parseFilterNode(child, problems);
		if (parsed !== null) {
			children.push(parsed);
		}
	}
	const repairedChildren = op === 'not' ? children.slice(0, 1) : children;
	const repairedOp = op === 'not' && repairedChildren.length === 0 ? 'and' : op;
	return { nodeId, kind: 'group', op: repairedOp, children: repairedChildren, enabled };
}

function parseFilterNode(value: unknown, problems: ValidationProblem[]): FilterNode | null {
	if (!isRecord(value)) {
		return null;
	}
	const nodeId = typeof value.nodeId === 'string' ? value.nodeId : '';
	const enabled = value.enabled !== false;
	if (value.kind === 'group') {
		return parseGroupNode(nodeId, value, enabled, problems);
	}
	if (value.kind === 'condition') {
		return parseConditionNode(nodeId, value, enabled, problems);
	}
	return null;
}

// The strict sibling of definition.ts's `normalizeScreener` (AC2): walks the
// filter tree and reports a blocking problem for any enabled condition node
// whose `type` is not one of the eight known variants, instead of silently
// dropping it. Universe and ranking reuse T-1009-1's normalizers unchanged
// -- AC1's field-for-field match is already established there; this
// function's only additional job is the strict condition-type check.
export function parseScreenerForExecution(value: unknown): ScreenerParseResult {
	if (!isRecord(value)) {
		return {
			ok: false,
			problems: [
				{
					severity: 'blocking',
					code: PROBLEM_CODES.invalidParameter,
					nodeIds: [],
					universeCriteria: [],
					message: 'Screener definition must be an object.'
				}
			]
		};
	}
	const problems: ValidationProblem[] = [];
	const filterTree = parseFilterNode(value.filterTree, problems) ?? emptyFilterTree('filter_1');
	if (problems.length > 0) {
		return { ok: false, problems };
	}
	const screener: ScreenerDefinition = {
		screenerId: typeof value.screenerId === 'string' ? value.screenerId : '',
		workspaceId: typeof value.workspaceId === 'string' ? value.workspaceId : '',
		name: typeof value.name === 'string' ? value.name : null,
		revision: typeof value.revision === 'number' && value.revision > 0 ? value.revision : 1,
		universe: normalizeUniverse(value.universe),
		filterTree,
		ranking: normalizeRanking(value.ranking)
	};
	return { ok: true, screener };
}
