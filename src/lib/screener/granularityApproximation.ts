// define_screener's AC5 (T-0026-1): when a condition names an interval the
// price pipeline cannot actually serve (e.g. an hourly interval against a
// daily-bars-only pipeline -- see catalog/items.ts's NO_INTRADAY), this
// substitutes the catalog's sole *available* interval instead of rejecting
// the whole definition outright, and reports every substitution made so the
// response can state the actual granularity used rather than silently
// swapping it. Only substitutes when the fallback is unambiguous (exactly
// one interval the catalog marks available); otherwise it leaves the
// condition untouched and the existing unavailable-data check
// (screenerValidation.ts / conditionValidation.catalog.ts's validatePattern)
// rejects it as it always has.
//
// Domain layer: no I/O beyond the injected CatalogRegistry, no import from
// src/lib/webmcp/.

import type { CatalogRegistry } from '../catalog/registry';
import type { ResourceId } from '../workbench/domain/ids';
import type { Condition } from './conditions';
import type { FilterNode } from './definition';

export interface GranularityApproximation {
	nodeId: ResourceId;
	requestedIntervalId: string;
	usedIntervalId: string;
}

// Only 'temporal' and 'pattern' carry an intervalId (conditions.ts's
// CONDITION_FIELD_ALLOWLIST) -- every other variant has nothing to
// approximate.
type IntervalBearingCondition = Extract<Condition, { type: 'temporal' | 'pattern' }>;

function carriesInterval(condition: Condition): condition is IntervalBearingCondition {
	return condition.type === 'temporal' || condition.type === 'pattern';
}

// The catalog's one unambiguous fallback: exactly one interval item marked
// available. Zero or several means "don't guess" -- this project's seeded
// catalog has exactly one (interval.1d) today, but nothing here hard-codes
// that id.
function soleAvailableInterval(registry: CatalogRegistry): string | null {
	const available = registry
		.listCatalogItems('interval')
		.filter((item) => item.availability.status === 'available');
	return available.length === 1 ? (available[0]?.id ?? null) : null;
}

function resolveIntervalId(
	requestedIntervalId: string,
	registry: CatalogRegistry,
	fallback: string | null
): string | null {
	const item = registry.getCatalogItem(requestedIntervalId);
	// Unknown id or wrong kind: leave untouched, this is
	// conditionValidation.ts's job to reject as an unknown catalog item.
	if (!item || item.kind !== 'interval') {
		return null;
	}
	// Already usable: nothing to approximate.
	if (item.availability.status !== 'unavailable') {
		return null;
	}
	if (!fallback || fallback === requestedIntervalId) {
		return null;
	}
	return fallback;
}

function approximateOne(
	condition: IntervalBearingCondition,
	registry: CatalogRegistry,
	fallback: string | null
): { condition: Condition; note: { from: string; to: string } | null } {
	const usedIntervalId = resolveIntervalId(condition.intervalId, registry, fallback);
	if (!usedIntervalId) {
		return { condition, note: null };
	}
	return {
		condition: { ...condition, intervalId: usedIntervalId },
		note: { from: condition.intervalId, to: usedIntervalId }
	};
}

function walk(
	node: FilterNode,
	registry: CatalogRegistry,
	fallback: string | null,
	out: GranularityApproximation[]
): FilterNode {
	if (node.kind === 'condition') {
		if (!carriesInterval(node.condition)) {
			return node;
		}
		const { condition, note } = approximateOne(node.condition, registry, fallback);
		if (!note) {
			return node;
		}
		out.push({ nodeId: node.nodeId, requestedIntervalId: note.from, usedIntervalId: note.to });
		return { ...node, condition };
	}
	let changed = false;
	const children = node.children.map((child) => {
		const next = walk(child, registry, fallback, out);
		changed = changed || next !== child;
		return next;
	});
	return changed ? { ...node, children } : node;
}

// The one exported entry point (AC5): walks the whole tree once,
// substituting an unavailable interval for the catalog's sole available one
// wherever the substitution is unambiguous, and returning every
// substitution made. Deterministic given the same tree and registry, so a
// caller can run this once to collect problems/warnings with placeholder
// node ids and again, identically, with real ones once it knows it will
// commit.
export function approximateGranularity(
	tree: FilterNode,
	registry: CatalogRegistry
): { tree: FilterNode; approximations: GranularityApproximation[] } {
	const fallback = soleAvailableInterval(registry);
	const approximations: GranularityApproximation[] = [];
	const nextTree = walk(tree, registry, fallback, approximations);
	return { tree: nextTree, approximations };
}
