// Builds a whole FilterNode tree from a single-shot wire payload
// (define_screener, T-0026-1), collecting every structural problem instead
// of rejecting at the first one (AC4) -- the sibling to filterTree.ts's
// single-operation deltas, needed because define_screener replaces the
// whole tree in one call rather than editing it node by node.
//
// Catalog/range validation (unknown field, out-of-range parameter,
// unavailable data) is deliberately NOT done here -- screenerValidation.ts's
// validateScreenerDefinition already walks a built FilterNode and does
// that; define_screener hands it this module's output rather than
// duplicating that walk. This module only does what validateScreenerDefinition
// cannot: parsing an untrusted wire shape into typed nodes, and the "no raw
// code" check on the RAW payload (normalizeCondition already silently drops
// disallowed keys, so checking the post-normalization Condition -- which
// validateCondition's own extraFieldProblems does -- can never catch them).
//
// Domain layer: no I/O, no import from src/lib/webmcp/.

import { findDisallowedConditionFields } from './conditionValidation.shared';
import { normalizeCondition } from './conditions';
import type { ConditionNode, FilterNode, GroupNode, GroupOp } from './definition';
import { PROBLEM_CODES, type ValidationProblem } from './validation';

// A plain node-id generator rather than the full IdSequencer, so a caller
// can validate with disposable placeholder ids before minting real ones
// only for a call that will actually commit (mirrors edit_filter_tree.ts's
// own mint-after-validate convention -- ids.ts's counters never reset, so
// minting for a call that gets rejected would waste sequence numbers for
// nothing).
export type NodeIdFactory = () => string;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type WireShape = 'group' | 'condition' | 'unrecognized';

function classify(value: unknown): WireShape {
	if (!isRecord(value)) {
		return 'unrecognized';
	}
	if (value.kind === 'group') {
		return 'group';
	}
	if (value.kind === 'condition') {
		return 'condition';
	}
	if (typeof value.type === 'string') {
		// A bare condition object, no {kind:'condition', condition:...}
		// wrapper -- even an unrecognized `type` is routed to
		// buildConditionNode so it gets normalizeCondition's specific
		// "unknown condition type" problem rather than this module's
		// generic "not a group or condition" one.
		return 'condition';
	}
	if (Array.isArray(value.children)) {
		return 'group'; // a group missing its own "kind" but shaped like one
	}
	return 'unrecognized';
}

// {kind:'condition', condition:{...}} wraps; a bare {type:'scalar',...} is
// itself the condition, but its `enabled` key (a node-level concept, read
// separately by buildNode) must be stripped first -- otherwise a bare
// condition carrying `enabled: false` would misreport as a stray field not
// part of its condition model.
function rawConditionOf(value: Record<string, unknown>): unknown {
	if (value.kind === 'condition') {
		return value.condition;
	}
	return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'enabled'));
}

function structuralProblem(nodeId: string, message: string): ValidationProblem {
	return {
		severity: 'blocking',
		code: PROBLEM_CODES.invalidParameter,
		nodeIds: [nodeId],
		universeCriteria: [],
		message
	};
}

function buildConditionNode(
	nodeId: string,
	rawWire: unknown,
	enabled: boolean,
	problems: ValidationProblem[]
): ConditionNode | null {
	const raw = isRecord(rawWire) ? rawConditionOf(rawWire) : rawWire;
	const disallowed = findDisallowedConditionFields(raw);
	if (disallowed.length > 0) {
		problems.push(
			structuralProblem(
				nodeId,
				`Node ${nodeId} carries field(s) not part of its condition model: ${disallowed.join(', ')}. ` +
					'No condition variant accepts a free-form expression, query, or code string.'
			)
		);
		return null;
	}
	const condition = normalizeCondition(raw);
	if (!condition) {
		problems.push({
			severity: 'blocking',
			code: PROBLEM_CODES.unknownConditionType,
			nodeIds: [nodeId],
			universeCriteria: [],
			message: `Node ${nodeId} did not parse into one of the eight known condition types.`
		});
		return null;
	}
	return { nodeId, kind: 'condition', condition, enabled };
}

function groupOpOf(value: unknown): GroupOp {
	return value === 'or' ? 'or' : value === 'not' ? 'not' : 'and';
}

function buildGroupNode(
	nodeId: string,
	source: Record<string, unknown>,
	nextId: NodeIdFactory,
	problems: ValidationProblem[]
): GroupNode {
	const op = groupOpOf(source.op);
	const enabled = source.enabled !== false;
	const rawChildren = Array.isArray(source.children) ? source.children : [];
	const children = rawChildren
		.map((child) => buildNode(child, nextId, problems))
		.filter((child): child is FilterNode => child !== null);
	if (op === 'not' && children.length !== 1) {
		problems.push(
			structuralProblem(
				nodeId,
				`A "not" group (node ${nodeId}) must hold exactly one child; got ${children.length}.`
			)
		);
	}
	// Repairs the same way definition.ts's normalizeGroupNode does, so a
	// rejected call's (discarded) tree shape stays predictable rather than
	// carrying an invalid "not" arity forward.
	const repairedChildren = op === 'not' ? children.slice(0, 1) : children;
	const repairedOp: GroupOp = op === 'not' && repairedChildren.length === 0 ? 'and' : op;
	return { nodeId, kind: 'group', op: repairedOp, children: repairedChildren, enabled };
}

function buildNode(
	value: unknown,
	nextId: NodeIdFactory,
	problems: ValidationProblem[]
): FilterNode | null {
	const nodeId = nextId();
	const shape = classify(value);
	const record = isRecord(value) ? value : {};
	const enabled = record.enabled !== false;
	if (shape === 'group') {
		return buildGroupNode(nodeId, record, nextId, problems);
	}
	if (shape === 'condition') {
		return buildConditionNode(nodeId, value, enabled, problems);
	}
	problems.push(
		structuralProblem(
			nodeId,
			`Node ${nodeId}: expected a group ({kind:'group', op, children}) or a condition, got ` +
				`something else.`
		)
	);
	return null;
}

// The one exported entry point: turns the caller's whole `conditions`
// payload into a rooted FilterNode tree in one pass, collecting every
// structural problem found instead of stopping at the first (AC4). Accepts
// three convenience root shapes so a caller need not always spell out an
// explicit root group: a group node, a single bare condition, or a plain
// array of nodes (treated as the root group's children under the default
// "and").
export function buildFilterTree(
	wireConditions: unknown,
	nextId: NodeIdFactory,
	problems: ValidationProblem[]
): FilterNode {
	const rootId = nextId();
	if (wireConditions === undefined || wireConditions === null) {
		return { nodeId: rootId, kind: 'group', op: 'and', children: [], enabled: true };
	}
	if (Array.isArray(wireConditions)) {
		const children = wireConditions
			.map((child) => buildNode(child, nextId, problems))
			.filter((child): child is FilterNode => child !== null);
		return { nodeId: rootId, kind: 'group', op: 'and', children, enabled: true };
	}
	const shape = classify(wireConditions);
	if (shape === 'group') {
		return buildGroupNode(rootId, wireConditions as Record<string, unknown>, nextId, problems);
	}
	if (shape === 'condition') {
		const record = wireConditions as Record<string, unknown>;
		const child = buildConditionNode(nextId(), wireConditions, record.enabled !== false, problems);
		return {
			nodeId: rootId,
			kind: 'group',
			op: 'and',
			children: child ? [child] : [],
			enabled: true
		};
	}
	problems.push(
		structuralProblem(
			rootId,
			'"conditions" must be a group, a single condition, or an array of nodes.'
		)
	);
	return { nodeId: rootId, kind: 'group', op: 'and', children: [], enabled: true };
}
