// Pure translation from the TS screener model (T-1009-1's
// definition.ts/conditions.ts, camelCase) to the Python backtest engine's
// snake_cased wire shape (backend/domain/models/screener.py, T-1014-5's
// field-for-field mirror of conditions.ts). No I/O: this is the boundary
// T-1014-6's Solution Approach calls out as the thing that has to exist
// before backtest_screener can call the backend at all.
//
// Domain layer: no fetch, no ToolResult, no workbench mutation types.

import type {
	Condition,
	ComparisonValue,
	EventRelativeCondition,
	PatternCondition,
	RelativeBaseline,
	RelativeCondition,
	ScalarCondition,
	SeriesComparisonCondition,
	SeriesRef,
	StudyOutputCondition,
	TemporalCondition
} from '../../../screener/conditions';
import type { FilterNode, UniverseSpec } from '../../../screener/definition';

export interface WireSeriesRef {
	catalog_id: string;
	params: Record<string, ComparisonValue>;
}

export interface WireScalarCondition {
	type: 'scalar';
	field_id: string;
	operator: string;
	value: ComparisonValue;
	unit: string | null;
}

export interface WireRangeCondition {
	type: 'range';
	field_id: string;
	lower: number;
	upper: number;
	lower_inclusive: boolean;
	upper_inclusive: boolean;
}

export interface WireSeriesComparisonCondition {
	type: 'series_comparison';
	left: WireSeriesRef;
	right: WireSeriesRef;
	operator: string;
}

export interface WireTemporalCondition {
	type: 'temporal';
	condition: WireCondition;
	event: TemporalCondition['event'];
	within_bars: number;
	interval_id: string;
}

export interface WireEventRelativeCondition {
	type: 'event_relative';
	event_type_id: string;
	direction: EventRelativeCondition['direction'];
	window_days: number;
}

export interface WirePatternCondition {
	type: 'pattern';
	pattern_id: string;
	min_confidence: number;
	interval_id: string;
}

export type WireRelativeBaseline =
	| { kind: 'own_moving_average'; window_bars: number }
	| { kind: 'peer_group'; group_id: string }
	| { kind: 'index'; index_id: string };

export interface WireRelativeCondition {
	type: 'relative';
	field_id: string;
	baseline: WireRelativeBaseline;
	multiple: number;
	operator: string;
}

export interface WireStudyOutputCondition {
	type: 'study_output';
	study_id: string;
	params: Record<string, ComparisonValue>;
	output_name: string;
	predicate: string;
}

export type WireCondition =
	| WireScalarCondition
	| WireRangeCondition
	| WireSeriesComparisonCondition
	| WireTemporalCondition
	| WireEventRelativeCondition
	| WirePatternCondition
	| WireRelativeCondition
	| WireStudyOutputCondition;

export interface WireGroupNode {
	node_id: string;
	kind: 'group';
	op: 'and' | 'or' | 'not';
	children: WireFilterNode[];
	enabled: boolean;
}

export interface WireConditionNode {
	node_id: string;
	kind: 'condition';
	condition: WireCondition;
	enabled: boolean;
}

export type WireFilterNode = WireGroupNode | WireConditionNode;

export interface WireUniverseSpec {
	universe_id: string;
	label: string;
	tickers: string[] | null;
	min_price: number | null;
	min_avg_volume: number | null;
	min_market_cap: number | null;
	excluded_tickers: string[];
}

function translateSeriesRef(ref: SeriesRef): WireSeriesRef {
	return { catalog_id: ref.catalogId, params: ref.params };
}

function translateBaseline(baseline: RelativeBaseline): WireRelativeBaseline {
	if (baseline.kind === 'peer_group') {
		return { kind: 'peer_group', group_id: baseline.groupId };
	}
	if (baseline.kind === 'index') {
		return { kind: 'index', index_id: baseline.indexId };
	}
	return { kind: 'own_moving_average', window_bars: baseline.windowBars };
}

function translateScalar(c: ScalarCondition): WireScalarCondition {
	return {
		type: 'scalar',
		field_id: c.fieldId,
		operator: c.operator,
		value: c.value,
		unit: c.unit
	};
}

function translateSeriesComparison(c: SeriesComparisonCondition): WireSeriesComparisonCondition {
	return {
		type: 'series_comparison',
		left: translateSeriesRef(c.left),
		right: translateSeriesRef(c.right),
		operator: c.operator
	};
}

function translateTemporal(c: TemporalCondition): WireTemporalCondition {
	return {
		type: 'temporal',
		condition: translateCondition(c.condition),
		event: c.event,
		within_bars: c.withinBars,
		interval_id: c.intervalId
	};
}

function translateEventRelative(c: EventRelativeCondition): WireEventRelativeCondition {
	return {
		type: 'event_relative',
		event_type_id: c.eventTypeId,
		direction: c.direction,
		window_days: c.windowDays
	};
}

function translatePattern(c: PatternCondition): WirePatternCondition {
	return {
		type: 'pattern',
		pattern_id: c.patternId,
		min_confidence: c.minConfidence,
		interval_id: c.intervalId
	};
}

function translateRelative(c: RelativeCondition): WireRelativeCondition {
	return {
		type: 'relative',
		field_id: c.fieldId,
		baseline: translateBaseline(c.baseline),
		multiple: c.multiple,
		operator: c.operator
	};
}

function translateStudyOutput(c: StudyOutputCondition): WireStudyOutputCondition {
	return {
		type: 'study_output',
		study_id: c.studyId,
		params: c.params,
		output_name: c.outputName,
		predicate: c.predicate
	};
}

// Exhaustive over conditions.ts's eight variants -- a ninth added there
// without a matching case here fails to compile (the `never` fallthrough),
// the same guardrail T-1014-5's own screener.py mirror relies on being kept
// in sync by hand.
export function translateCondition(condition: Condition): WireCondition {
	switch (condition.type) {
		case 'scalar':
			return translateScalar(condition);
		case 'range':
			return {
				type: 'range',
				field_id: condition.fieldId,
				lower: condition.lower,
				upper: condition.upper,
				lower_inclusive: condition.lowerInclusive,
				upper_inclusive: condition.upperInclusive
			};
		case 'series_comparison':
			return translateSeriesComparison(condition);
		case 'temporal':
			return translateTemporal(condition);
		case 'event_relative':
			return translateEventRelative(condition);
		case 'pattern':
			return translatePattern(condition);
		case 'relative':
			return translateRelative(condition);
		case 'study_output':
			return translateStudyOutput(condition);
		default: {
			const exhaustive: never = condition;
			throw new Error(`translateCondition: unhandled condition type ${JSON.stringify(exhaustive)}`);
		}
	}
}

export function translateFilterNode(node: FilterNode): WireFilterNode {
	if (node.kind === 'group') {
		return {
			node_id: node.nodeId,
			kind: 'group',
			op: node.op,
			children: node.children.map(translateFilterNode),
			enabled: node.enabled
		};
	}
	return {
		node_id: node.nodeId,
		kind: 'condition',
		condition: translateCondition(node.condition),
		enabled: node.enabled
	};
}

export interface TranslatedUniverse {
	universe: WireUniverseSpec;
	// Non-representable criteria the caller asked for but Python's
	// deliberately smaller UniverseSpec (backend/domain/models/screener.py)
	// has no field for -- surfaced as a warning rather than silently
	// dropped or used to reject the whole backtest (AC10's "nothing
	// silently vanishes" in spirit).
	droppedCriteria: string[];
}

export function translateUniverse(
	universe: UniverseSpec,
	universeId: string,
	label: string
): TranslatedUniverse {
	const droppedCriteria: string[] = [];
	const dropIfNonEmpty = (name: string, values: readonly unknown[] | string) => {
		if (values.length > 0) {
			droppedCriteria.push(name);
		}
	};
	dropIfNonEmpty('universe.assetClass', universe.assetClass);
	dropIfNonEmpty('universe.exchanges', universe.exchanges);
	dropIfNonEmpty('universe.countries', universe.countries);
	dropIfNonEmpty('universe.sectors', universe.sectors);
	dropIfNonEmpty('universe.industries', universe.industries);
	dropIfNonEmpty('universe.indexes', universe.indexes);
	dropIfNonEmpty('universe.watchlists', universe.watchlists);
	dropIfNonEmpty('universe.exclusions.sectorIds', universe.exclusions.sectorIds);
	dropIfNonEmpty('universe.exclusions.industryIds', universe.exclusions.industryIds);

	return {
		universe: {
			universe_id: universeId,
			label,
			tickers: null,
			min_price: universe.liquidity.minPrice,
			min_avg_volume: universe.liquidity.minAverageVolume,
			min_market_cap: universe.liquidity.minMarketCap,
			excluded_tickers: universe.exclusions.instrumentIds
		},
		droppedCriteria
	};
}
