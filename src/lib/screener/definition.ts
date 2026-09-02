// The screener definition model (T-1009-1): a typed, browser-side entity
// every editing tool in this epic reads and rewrites. Mirrors
// src/lib/workbench/domain/workspace.ts's never-throw normalization style so
// a corrupt or foreign persisted screener degrades to a valid empty one
// instead of breaking the workspace it lives in.

import type { IdSequencer, ResourceId } from '../workbench/domain/ids';
import type { Revision } from '../workbench/domain/workspace';
import { normalizeCondition, type Condition } from './conditions';

export interface LiquidityLimits {
	minPrice: number | null;
	minAverageVolume: number | null;
	minMarketCap: number | null;
}

export interface Exclusions {
	instrumentIds: string[];
	sectorIds: string[];
	industryIds: string[];
}

export interface UniverseSpec {
	assetClass: string;
	exchanges: string[];
	countries: string[];
	sectors: string[];
	industries: string[];
	indexes: string[];
	watchlists: string[];
	liquidity: LiquidityLimits;
	exclusions: Exclusions;
}

export type GroupOp = 'and' | 'or' | 'not';

export interface GroupNode {
	nodeId: ResourceId;
	kind: 'group';
	op: GroupOp;
	children: FilterNode[];
	enabled: boolean;
}

export interface ConditionNode {
	nodeId: ResourceId;
	kind: 'condition';
	condition: Condition;
	enabled: boolean;
}

// Arbitrary nesting: a group's children are FilterNodes, which may themselves
// be groups.
export type FilterNode = GroupNode | ConditionNode;

export interface RankingField {
	fieldId: string;
	direction: 'asc' | 'desc';
	weight: number;
}

export interface RankingTieBreak {
	fieldId: string;
	direction: 'asc' | 'desc';
}

export interface RankingSpec {
	fields: RankingField[];
	tieBreak: RankingTieBreak | null;
	limit: number;
	normalization: string;
}

export interface ScreenerDefinition {
	screenerId: ResourceId;
	workspaceId: ResourceId;
	name: string | null;
	revision: Revision;
	universe: UniverseSpec;
	filterTree: FilterNode;
	ranking: RankingSpec | null;
}

export function emptyUniverse(): UniverseSpec {
	return {
		assetClass: '',
		exchanges: [],
		countries: [],
		sectors: [],
		industries: [],
		indexes: [],
		watchlists: [],
		liquidity: { minPrice: null, minAverageVolume: null, minMarketCap: null },
		exclusions: { instrumentIds: [], sectorIds: [], industryIds: [] }
	};
}

export function emptyFilterTree(nodeId: ResourceId): GroupNode {
	return { nodeId, kind: 'group', op: 'and', children: [], enabled: true };
}

// Mints both IDs off the same sequencer so their sequence numbers can never
// collide with each other or with any previously retired ID of either kind
// (ids.ts's counters only ever advance).
export function createScreener(
	ids: IdSequencer,
	workspaceId: ResourceId,
	name: string | null
): ScreenerDefinition {
	const screenerId = ids.next('screener');
	const rootNodeId = ids.next('filter');
	return {
		screenerId,
		workspaceId,
		name,
		revision: 1,
		universe: emptyUniverse(),
		filterTree: emptyFilterTree(rootNodeId),
		ranking: null
	};
}

// Exposed as a predicate, not just enforced silently during normalization,
// so editing tools can check a proposed edit before committing it.
export function isNotArityValid(node: GroupNode): boolean {
	return node.op !== 'not' || node.children.length === 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === 'string');
}

function asNullableNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeLiquidityLimits(value: unknown): LiquidityLimits {
	const source = isRecord(value) ? value : {};
	return {
		minPrice: asNullableNumber(source.minPrice),
		minAverageVolume: asNullableNumber(source.minAverageVolume),
		minMarketCap: asNullableNumber(source.minMarketCap)
	};
}

function normalizeExclusions(value: unknown): Exclusions {
	const source = isRecord(value) ? value : {};
	return {
		instrumentIds: asStringArray(source.instrumentIds),
		sectorIds: asStringArray(source.sectorIds),
		industryIds: asStringArray(source.industryIds)
	};
}

export function normalizeUniverse(value: unknown): UniverseSpec {
	const source = isRecord(value) ? value : {};
	return {
		assetClass: asString(source.assetClass),
		exchanges: asStringArray(source.exchanges),
		countries: asStringArray(source.countries),
		sectors: asStringArray(source.sectors),
		industries: asStringArray(source.industries),
		indexes: asStringArray(source.indexes),
		watchlists: asStringArray(source.watchlists),
		liquidity: normalizeLiquidityLimits(source.liquidity),
		exclusions: normalizeExclusions(source.exclusions)
	};
}

// Malformed children are dropped rather than repaired into a placeholder --
// a condition node with no recoverable condition, or a group/condition with
// no usable node ID, carries no information worth keeping.
function normalizeFilterNodeArray(value: unknown): FilterNode[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: FilterNode[] = [];
	for (const item of value) {
		const normalized = normalizeFilterNode(item);
		if (normalized !== null) {
			out.push(normalized);
		}
	}
	return out;
}

function normalizeGroupNode(
	nodeId: ResourceId,
	source: Record<string, unknown>,
	enabled: boolean
): GroupNode {
	const op: GroupOp = source.op === 'or' ? 'or' : source.op === 'not' ? 'not' : 'and';
	const children = normalizeFilterNodeArray(source.children);
	// A 'not' group repairs to its first child, matching the ticket's arity
	// rule; with no child to keep, repairing the op (rather than dropping the
	// node) preserves the node ID a caller may still reference.
	const repairedChildren = op === 'not' ? children.slice(0, 1) : children;
	const repairedOp: GroupOp = op === 'not' && repairedChildren.length === 0 ? 'and' : op;
	return { nodeId, kind: 'group', op: repairedOp, children: repairedChildren, enabled };
}

function normalizeConditionNode(
	nodeId: ResourceId,
	source: Record<string, unknown>,
	enabled: boolean
): ConditionNode | null {
	const condition = normalizeCondition(source.condition);
	return condition === null ? null : { nodeId, kind: 'condition', condition, enabled };
}

function normalizeFilterNode(value: unknown): FilterNode | null {
	if (!isRecord(value)) {
		return null;
	}
	const nodeId = value.nodeId;
	if (typeof nodeId !== 'string' || nodeId.length === 0) {
		return null;
	}
	const enabled = value.enabled !== false;
	if (value.kind === 'group') {
		return normalizeGroupNode(nodeId, value, enabled);
	}
	if (value.kind === 'condition') {
		return normalizeConditionNode(nodeId, value, enabled);
	}
	return null;
}

function normalizeRankingField(value: unknown): RankingField | null {
	if (!isRecord(value) || typeof value.fieldId !== 'string' || value.fieldId.length === 0) {
		return null;
	}
	return {
		fieldId: value.fieldId,
		direction: value.direction === 'asc' ? 'asc' : 'desc',
		weight: typeof value.weight === 'number' && Number.isFinite(value.weight) ? value.weight : 1
	};
}

function normalizeRankingFieldArray(value: unknown): RankingField[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: RankingField[] = [];
	for (const item of value) {
		const normalized = normalizeRankingField(item);
		if (normalized !== null) {
			out.push(normalized);
		}
	}
	return out;
}

function normalizeTieBreak(value: unknown): RankingTieBreak | null {
	if (!isRecord(value) || typeof value.fieldId !== 'string' || value.fieldId.length === 0) {
		return null;
	}
	return { fieldId: value.fieldId, direction: value.direction === 'asc' ? 'asc' : 'desc' };
}

// A missing or foreign `ranking` normalizes to null -- the documented default
// order -- rather than a hollow RankingSpec, matching "null means the
// documented default order" in technical.md.
export function normalizeRanking(value: unknown): RankingSpec | null {
	if (!isRecord(value)) {
		return null;
	}
	return {
		fields: normalizeRankingFieldArray(value.fields),
		tieBreak: normalizeTieBreak(value.tieBreak),
		limit: typeof value.limit === 'number' && value.limit > 0 ? value.limit : 100,
		normalization: asString(value.normalization, 'percentile_rank')
	};
}

// Never throws: malformed, partial, or foreign data normalizes to a valid
// ScreenerDefinition, dropping only the individual nodes that don't parse
// rather than the whole screener.
export function normalizeScreener(value: unknown): ScreenerDefinition {
	const source = isRecord(value) ? value : {};
	const filterTree = normalizeFilterNode(source.filterTree) ?? emptyFilterTree('filter_1');
	return {
		screenerId: asString(source.screenerId),
		workspaceId: asString(source.workspaceId),
		name: typeof source.name === 'string' ? source.name : null,
		revision: typeof source.revision === 'number' && source.revision > 0 ? source.revision : 1,
		universe: normalizeUniverse(source.universe),
		filterTree,
		ranking: normalizeRanking(source.ranking)
	};
}
