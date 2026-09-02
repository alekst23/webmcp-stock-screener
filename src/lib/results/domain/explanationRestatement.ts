// Human-readable restatement of a filter condition (T-1010-3 AC2): one small
// pure function per of the eight condition families, mirroring
// conditionEvaluation.ts's own per-family split. Field and catalog IDs are
// shown verbatim -- resolving them to catalog display labels needs the
// catalog registry, which this module (no I/O) does not import; that's a
// rendering concern (T-1010-7), not this model's job.
//
// Domain layer: no I/O, no import from infra or from src/lib/webmcp/.

import type {
	Condition,
	EventRelativeCondition,
	PatternCondition,
	RangeCondition,
	RelativeBaseline,
	RelativeCondition,
	ScalarCondition,
	SeriesComparisonCondition,
	StudyOutputCondition,
	TemporalCondition
} from '../../screener/conditions';

const SCALAR_LIKE_OPERATOR_PHRASES: Record<string, string> = {
	'op.greater_than': 'is greater than',
	'op.less_than': 'is less than',
	'op.equals': 'equals'
};

const SERIES_OPERATOR_PHRASES: Record<string, string> = {
	'op.crosses_above': 'crosses above',
	'op.crosses_below': 'crosses below'
};

// Unrecognized operator ids (catalog-defined ones this module has no
// registry access to look up) fall back to showing the raw id verbatim
// rather than a generic placeholder -- still legible, never fabricated.
function operatorPhrase(operator: string, table: Record<string, string>): string {
	return table[operator] ?? operator;
}

function formatComparisonValue(value: number | string | boolean): string {
	return typeof value === 'string' ? `"${value}"` : String(value);
}

function describeBaseline(baseline: RelativeBaseline): string {
	if (baseline.kind === 'own_moving_average') {
		return `own ${baseline.windowBars}-bar moving average`;
	}
	if (baseline.kind === 'peer_group') {
		return `peer group "${baseline.groupId}"`;
	}
	return `index "${baseline.indexId}"`;
}

function restateScalar(condition: ScalarCondition): string {
	const phrase = operatorPhrase(condition.operator, SCALAR_LIKE_OPERATOR_PHRASES);
	const unit = condition.unit ? ` ${condition.unit}` : '';
	return `${condition.fieldId} ${phrase} ${formatComparisonValue(condition.value)}${unit}`;
}

function restateRange(condition: RangeCondition): string {
	const lowerBracket = condition.lowerInclusive ? '[' : '(';
	const upperBracket = condition.upperInclusive ? ']' : ')';
	return (
		`${condition.fieldId} is in ${lowerBracket}${condition.lower}, ${condition.upper}` +
		`${upperBracket}`
	);
}

function restateSeriesComparison(condition: SeriesComparisonCondition): string {
	const phrase = operatorPhrase(condition.operator, SERIES_OPERATOR_PHRASES);
	return `${condition.left.catalogId} ${phrase} ${condition.right.catalogId}`;
}

function restateTemporal(condition: TemporalCondition): string {
	const eventPhrase = condition.event.replace(/_/g, ' ');
	return (
		`"${restateCondition(condition.condition)}" ${eventPhrase} within the last ` +
		`${condition.withinBars} bar(s) on ${condition.intervalId}`
	);
}

function restateEventRelative(condition: EventRelativeCondition): string {
	return (
		`${condition.eventTypeId} occurs within ${condition.windowDays} day(s) in the ` +
		`${condition.direction}`
	);
}

function restatePattern(condition: PatternCondition): string {
	return (
		`pattern "${condition.patternId}" detected on ${condition.intervalId} with ` +
		`confidence >= ${condition.minConfidence}`
	);
}

function restateRelative(condition: RelativeCondition): string {
	const phrase = operatorPhrase(condition.operator, SCALAR_LIKE_OPERATOR_PHRASES);
	return (
		`${condition.fieldId} ${phrase} ${condition.multiple}x its ` +
		`${describeBaseline(condition.baseline)}`
	);
}

function restateStudyOutput(condition: StudyOutputCondition): string {
	return `${condition.studyId}.${condition.outputName} satisfies "${condition.predicate}"`;
}

export function restateCondition(condition: Condition): string {
	switch (condition.type) {
		case 'scalar':
			return restateScalar(condition);
		case 'range':
			return restateRange(condition);
		case 'series_comparison':
			return restateSeriesComparison(condition);
		case 'temporal':
			return restateTemporal(condition);
		case 'event_relative':
			return restateEventRelative(condition);
		case 'pattern':
			return restatePattern(condition);
		case 'relative':
			return restateRelative(condition);
		case 'study_output':
			return restateStudyOutput(condition);
	}
}

// The condition's own "operator" (AC2), independent of its restatement.
// Families with no distinct operator concept (range's bounds, pattern's
// confidence threshold) report null rather than a synthesized placeholder.
export function describeConditionOperator(condition: Condition): string | null {
	switch (condition.type) {
		case 'scalar':
		case 'series_comparison':
		case 'relative':
			return condition.operator;
		case 'temporal':
			return condition.event;
		case 'event_relative':
			return condition.direction;
		case 'study_output':
			return condition.predicate;
		case 'range':
		case 'pattern':
			return null;
	}
}

// Convenience bundling both derived fields together, since a
// ConditionExplanation always needs both.
export function describeCondition(condition: Condition): {
	restatement: string;
	operatorLabel: string | null;
} {
	return {
		restatement: restateCondition(condition),
		operatorLabel: describeConditionOperator(condition)
	};
}
