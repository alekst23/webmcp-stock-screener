// The eight typed condition variants a filter-tree condition node can carry
// (T-1009-1). Every field here is a catalog ID, an enum member, or a plain
// number/string/boolean value — never a field a caller could put SQL,
// JavaScript, or a free-form expression into for later parsing. That
// structural property, not a review convention, is what makes "no raw code"
// true of this model; see CONDITION_FIELD_ALLOWLIST below.

import type { ConditionFamily } from '../catalog/types';

export type ComparisonValue = number | string | boolean;

export interface ScalarCondition {
	type: 'scalar';
	fieldId: string;
	operator: string;
	value: ComparisonValue;
	unit: string | null;
}

export interface RangeCondition {
	type: 'range';
	fieldId: string;
	lower: number;
	upper: number;
	lowerInclusive: boolean;
	upperInclusive: boolean;
}

export interface SeriesRef {
	catalogId: string;
	params: Record<string, ComparisonValue>;
}

export interface SeriesComparisonCondition {
	type: 'series_comparison';
	left: SeriesRef;
	right: SeriesRef;
	operator: string;
}

export type TemporalEvent = 'crossed_above' | 'crossed_below' | 'became_true';

export interface TemporalCondition {
	type: 'temporal';
	condition: Condition;
	event: TemporalEvent;
	withinBars: number;
	intervalId: string;
}

export type EventRelativeDirection = 'past' | 'future';

export interface EventRelativeCondition {
	type: 'event_relative';
	eventTypeId: string;
	direction: EventRelativeDirection;
	windowDays: number;
}

export interface PatternCondition {
	type: 'pattern';
	patternId: string;
	minConfidence: number;
	intervalId: string;
}

// A baseline is one of three catalog-anchored shapes, never a computed
// expression — "1.5x its own 20-day average" is windowBars: 20, not a string.
export type RelativeBaseline =
	| { kind: 'own_moving_average'; windowBars: number }
	| { kind: 'peer_group'; groupId: string }
	| { kind: 'index'; indexId: string };

export interface RelativeCondition {
	type: 'relative';
	fieldId: string;
	baseline: RelativeBaseline;
	multiple: number;
	operator: string;
}

export interface StudyOutputCondition {
	type: 'study_output';
	studyId: string;
	params: Record<string, ComparisonValue>;
	outputName: string;
	predicate: string;
}

export type Condition =
	| ScalarCondition
	| RangeCondition
	| SeriesComparisonCondition
	| TemporalCondition
	| EventRelativeCondition
	| PatternCondition
	| RelativeCondition
	| StudyOutputCondition;

// The documented, exhaustive set of own keys each condition variant may
// carry. Record<ConditionFamily, ...> ties this directly to the catalog's
// eight condition families, so the two cannot drift. A test asserts every
// constructed sample's keys are a subset of its family's list here — a
// variant that grows a stray `expression`/`sql`/`js` field fails that test.
export const CONDITION_FIELD_ALLOWLIST: Record<ConditionFamily, readonly string[]> = {
	scalar: ['type', 'fieldId', 'operator', 'value', 'unit'],
	range: ['type', 'fieldId', 'lower', 'upper', 'lowerInclusive', 'upperInclusive'],
	series_comparison: ['type', 'left', 'right', 'operator'],
	temporal: ['type', 'condition', 'event', 'withinBars', 'intervalId'],
	event_relative: ['type', 'eventTypeId', 'direction', 'windowDays'],
	pattern: ['type', 'patternId', 'minConfidence', 'intervalId'],
	relative: ['type', 'fieldId', 'baseline', 'multiple', 'operator'],
	study_output: ['type', 'studyId', 'params', 'outputName', 'predicate']
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function asComparisonValue(value: unknown): ComparisonValue {
	if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
		return value;
	}
	return '';
}

function asParams(value: unknown): Record<string, ComparisonValue> {
	if (!isRecord(value)) {
		return {};
	}
	const out: Record<string, ComparisonValue> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === 'number' || typeof entry === 'string' || typeof entry === 'boolean') {
			out[key] = entry;
		}
	}
	return out;
}

function normalizeSeriesRef(value: unknown): SeriesRef {
	const source = isRecord(value) ? value : {};
	return { catalogId: asString(source.catalogId), params: asParams(source.params) };
}

const TEMPORAL_EVENTS: ReadonlySet<string> = new Set<TemporalEvent>([
	'crossed_above',
	'crossed_below',
	'became_true'
]);

const EVENT_RELATIVE_DIRECTIONS: ReadonlySet<string> = new Set<EventRelativeDirection>([
	'past',
	'future'
]);

function normalizeRelativeBaseline(value: unknown): RelativeBaseline {
	const source = isRecord(value) ? value : {};
	if (source.kind === 'peer_group') {
		return { kind: 'peer_group', groupId: asString(source.groupId) };
	}
	if (source.kind === 'index') {
		return { kind: 'index', indexId: asString(source.indexId) };
	}
	return { kind: 'own_moving_average', windowBars: asNumber(source.windowBars, 1) };
}

function normalizeScalarCondition(source: Record<string, unknown>): ScalarCondition {
	return {
		type: 'scalar',
		fieldId: asString(source.fieldId),
		operator: asString(source.operator),
		value: asComparisonValue(source.value),
		unit: typeof source.unit === 'string' ? source.unit : null
	};
}

function normalizeRangeCondition(source: Record<string, unknown>): RangeCondition {
	return {
		type: 'range',
		fieldId: asString(source.fieldId),
		lower: asNumber(source.lower),
		upper: asNumber(source.upper),
		lowerInclusive: asBoolean(source.lowerInclusive, true),
		upperInclusive: asBoolean(source.upperInclusive, true)
	};
}

function normalizeSeriesComparisonCondition(
	source: Record<string, unknown>
): SeriesComparisonCondition {
	return {
		type: 'series_comparison',
		left: normalizeSeriesRef(source.left),
		right: normalizeSeriesRef(source.right),
		operator: asString(source.operator)
	};
}

// The only recursive variant: an inner condition that fails to normalize
// takes the whole temporal wrapper down with it rather than being repaired
// into a placeholder condition.
function normalizeTemporalCondition(source: Record<string, unknown>): TemporalCondition | null {
	const inner = normalizeCondition(source.condition);
	if (!inner) {
		return null;
	}
	const event =
		typeof source.event === 'string' && TEMPORAL_EVENTS.has(source.event)
			? (source.event as TemporalEvent)
			: 'became_true';
	return {
		type: 'temporal',
		condition: inner,
		event,
		withinBars: asNumber(source.withinBars, 1),
		intervalId: asString(source.intervalId)
	};
}

function normalizeEventRelativeCondition(source: Record<string, unknown>): EventRelativeCondition {
	const direction =
		typeof source.direction === 'string' && EVENT_RELATIVE_DIRECTIONS.has(source.direction)
			? (source.direction as EventRelativeDirection)
			: 'future';
	return {
		type: 'event_relative',
		eventTypeId: asString(source.eventTypeId),
		direction,
		windowDays: asNumber(source.windowDays, 0)
	};
}

function normalizePatternCondition(source: Record<string, unknown>): PatternCondition {
	return {
		type: 'pattern',
		patternId: asString(source.patternId),
		minConfidence: asNumber(source.minConfidence, 0),
		intervalId: asString(source.intervalId)
	};
}

function normalizeRelativeCondition(source: Record<string, unknown>): RelativeCondition {
	return {
		type: 'relative',
		fieldId: asString(source.fieldId),
		baseline: normalizeRelativeBaseline(source.baseline),
		multiple: asNumber(source.multiple, 1),
		operator: asString(source.operator)
	};
}

function normalizeStudyOutputCondition(source: Record<string, unknown>): StudyOutputCondition {
	return {
		type: 'study_output',
		studyId: asString(source.studyId),
		params: asParams(source.params),
		outputName: asString(source.outputName),
		predicate: asString(source.predicate)
	};
}

// Never throws: an unrecognized `type` or a structurally invalid payload
// normalizes to null rather than a half-populated condition, so the caller
// can drop the enclosing node instead of storing something misleading.
export function normalizeCondition(value: unknown): Condition | null {
	if (!isRecord(value)) {
		return null;
	}
	switch (value.type) {
		case 'scalar':
			return normalizeScalarCondition(value);
		case 'range':
			return normalizeRangeCondition(value);
		case 'series_comparison':
			return normalizeSeriesComparisonCondition(value);
		case 'temporal':
			return normalizeTemporalCondition(value);
		case 'event_relative':
			return normalizeEventRelativeCondition(value);
		case 'pattern':
			return normalizePatternCondition(value);
		case 'relative':
			return normalizeRelativeCondition(value);
		case 'study_output':
			return normalizeStudyOutputCondition(value);
		default:
			return null;
	}
}
