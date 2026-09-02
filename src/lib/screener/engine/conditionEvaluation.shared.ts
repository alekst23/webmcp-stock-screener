// Shared context type and helper functions for condition evaluation
// (T-1009-7). Split out so conditionEvaluation.ts (dispatch, scalar, range,
// series_comparison, temporal) and conditionEvaluation.catalog.ts
// (event_relative, pattern, relative, study_output) can both depend on this
// file without depending on each other -- a clean DAG instead of a cycle,
// mirroring conditionValidation.shared.ts's split.
//
// Infra layer: implements evaluation behind the domain port (ports.ts);
// domain code does not import this file.

import type { CatalogRegistry } from '../../catalog/registry';
import type { ScreenerMarketData } from '../ports';
import type { ComparisonValue } from '../conditions';

export interface ConditionEvalDeps {
	marketData: ScreenerMarketData;
	registry: CatalogRegistry;
	// Injectable so event_relative's day-diff math is deterministic in tests
	// (AC7) rather than reading the wall clock.
	now: () => Date;
}

export interface ConditionEvalOutcome {
	passed: boolean;
	// null when the evaluated value has no single scalar form worth storing,
	// matching run.ts's FilterNodeEvaluation.value.
	value: number | string | boolean | null;
	unit?: string;
	detail?: string;
	dataUnavailable: boolean;
}

export function outcome(
	passed: boolean,
	value: number | string | boolean | null,
	unit?: string,
	detail?: string
): ConditionEvalOutcome {
	return { passed, value, unit, detail, dataUnavailable: false };
}

export function unavailableOutcome(detail: string): ConditionEvalOutcome {
	return { passed: false, value: null, detail, dataUnavailable: true };
}

// The catalog gate every evaluator runs before calling ScreenerMarketData
// (AC11): the catalog stays the single source of truth for "is this wired
// up", so an evaluator never has to guess whether a market-data `null`
// means "no data for this instrument" or "this source isn't built".
export function availabilityGate(
	registry: CatalogRegistry,
	catalogId: string
): { available: boolean; reason: string } {
	const item = registry.getCatalogItem(catalogId);
	if (!item) {
		return { available: false, reason: `Unknown catalog item "${catalogId}".` };
	}
	if (item.availability.status !== 'available') {
		return { available: false, reason: item.availability.reason };
	}
	return { available: true, reason: '' };
}

export function compareScalar(
	operator: string,
	raw: ComparisonValue,
	target: ComparisonValue
): boolean {
	switch (operator) {
		case 'op.greater_than':
			return typeof raw === 'number' && typeof target === 'number' && raw > target;
		case 'op.less_than':
			return typeof raw === 'number' && typeof target === 'number' && raw < target;
		case 'op.equals':
			return raw === target;
		default:
			return false;
	}
}
