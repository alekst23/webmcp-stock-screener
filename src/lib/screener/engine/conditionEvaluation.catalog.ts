// The four condition evaluators that lean hardest on catalog lookups and a
// baseline/trend resolution step: event_relative, pattern, relative,
// study_output. conditionEvaluation.ts owns the dispatch table and the four
// structurally simpler variants (scalar, range, series_comparison,
// temporal); shared helpers live in conditionEvaluation.shared.ts so neither
// file depends on the other. Mirrors conditionValidation.catalog.ts's split.
//
// Infra layer: implements evaluation behind the domain port (ports.ts);
// domain code does not import this file.

import type {
	EventRelativeCondition,
	PatternCondition,
	RelativeBaseline,
	RelativeCondition,
	StudyOutputCondition
} from '../conditions';
import {
	availabilityGate,
	compareScalar,
	outcome,
	unavailableOutcome,
	type ConditionEvalDeps,
	type ConditionEvalOutcome
} from './conditionEvaluation.shared';

// A number reads as "days from event" directly (whatever sign convention the
// field's own direction implies); an ISO date string is diffed against
// `now` in the direction the condition declares.
function resolveDaysFromEvent(
	raw: number | string | boolean | null,
	direction: 'past' | 'future',
	now: Date
): number | null {
	if (typeof raw === 'number') {
		return raw;
	}
	if (typeof raw !== 'string') {
		return null;
	}
	const eventDate = new Date(raw);
	if (Number.isNaN(eventDate.getTime())) {
		return null;
	}
	const diffMs =
		direction === 'future'
			? eventDate.getTime() - now.getTime()
			: now.getTime() - eventDate.getTime();
	return diffMs / 86_400_000;
}

export async function evaluateEventRelative(
	condition: EventRelativeCondition,
	instrumentId: string,
	deps: ConditionEvalDeps
): Promise<ConditionEvalOutcome> {
	const gate = availabilityGate(deps.registry, condition.eventTypeId);
	if (!gate.available) {
		return unavailableOutcome(gate.reason);
	}
	const raw = await deps.marketData.getFieldValue(instrumentId, condition.eventTypeId);
	const daysFromEvent = resolveDaysFromEvent(raw, condition.direction, deps.now());
	if (daysFromEvent === null) {
		return unavailableOutcome(
			`Event field "${condition.eventTypeId}" has no usable date or day count for ${instrumentId}.`
		);
	}
	return outcome(
		daysFromEvent >= 0 && daysFromEvent <= condition.windowDays,
		daysFromEvent,
		'days'
	);
}

export async function evaluatePattern(
	condition: PatternCondition,
	instrumentId: string,
	deps: ConditionEvalDeps
): Promise<ConditionEvalOutcome> {
	const gate = availabilityGate(deps.registry, condition.patternId);
	if (!gate.available) {
		return unavailableOutcome(gate.reason);
	}
	const result = await deps.marketData.detectPattern(
		instrumentId,
		condition.patternId,
		condition.intervalId
	);
	// null from an 'available' pattern engine is a genuine non-match, not a
	// missing read -- only the catalog gate above signals unavailability.
	if (result === null) {
		return outcome(false, null, undefined, 'Pattern not detected.');
	}
	return outcome(result.confidence >= condition.minConfidence, result.confidence);
}

async function resolveBaseline(
	baseline: RelativeBaseline,
	fieldId: string,
	instrumentId: string,
	deps: ConditionEvalDeps
): Promise<number | null> {
	if (baseline.kind === 'own_moving_average') {
		const series = await deps.marketData.getSeries(instrumentId, fieldId, {
			length: baseline.windowBars
		});
		if (series.length === 0) return null;
		const sum = series.reduce((acc, point) => acc + point.value, 0);
		return sum / series.length;
	}
	const baselineId = baseline.kind === 'peer_group' ? baseline.groupId : baseline.indexId;
	const value = await deps.marketData.getFieldValue(instrumentId, baselineId);
	return typeof value === 'number' ? value : null;
}

export async function evaluateRelative(
	condition: RelativeCondition,
	instrumentId: string,
	deps: ConditionEvalDeps
): Promise<ConditionEvalOutcome> {
	const gate = availabilityGate(deps.registry, condition.fieldId);
	if (!gate.available) {
		return unavailableOutcome(gate.reason);
	}
	const raw = await deps.marketData.getFieldValue(instrumentId, condition.fieldId);
	if (typeof raw !== 'number') {
		return unavailableOutcome(
			`Field "${condition.fieldId}" has no numeric value for ${instrumentId}.`
		);
	}
	const baseline = await resolveBaseline(condition.baseline, condition.fieldId, instrumentId, deps);
	if (baseline === null) {
		return unavailableOutcome(
			`Baseline for "${condition.fieldId}" is unavailable for ${instrumentId}.`
		);
	}
	if (baseline === 0) {
		return unavailableOutcome(
			`Baseline for "${condition.fieldId}" is zero for ${instrumentId}; a multiple is undefined.`
		);
	}
	const ratio = raw / baseline;
	return outcome(compareScalar(condition.operator, ratio, condition.multiple), ratio);
}

type StudyTrend = 'rising' | 'falling' | 'flat' | null;

async function resolveStudyTrend(
	condition: StudyOutputCondition,
	instrumentId: string,
	deps: ConditionEvalDeps
): Promise<StudyTrend> {
	if (!condition.predicate.includes('rising') && !condition.predicate.includes('falling')) {
		return null;
	}
	const series = await deps.marketData.getSeries(instrumentId, condition.studyId, condition.params);
	const prev = series[series.length - 2];
	const cur = series[series.length - 1];
	if (!prev || !cur) return null;
	if (cur.value > prev.value) return 'rising';
	if (cur.value < prev.value) return 'falling';
	return 'flat';
}

function evaluatePredicateToken(
	token: string,
	value: number | string | boolean,
	trend: StudyTrend
): boolean {
	switch (token) {
		case 'positive':
			return typeof value === 'number' && value > 0;
		case 'negative':
			return typeof value === 'number' && value < 0;
		case 'non_negative':
			return typeof value === 'number' && value >= 0;
		case 'non_positive':
			return typeof value === 'number' && value <= 0;
		case 'zero':
			return typeof value === 'number' && value === 0;
		case 'true':
			return value === true;
		case 'false':
			return value === false;
		case 'rising':
			return trend === 'rising';
		case 'falling':
			return trend === 'falling';
		default:
			return false;
	}
}

// The predicate DSL StudyOutputCondition carries no catalog vocabulary for
// (unlike operator ids elsewhere): a small, self-contained language of
// tokens joined by "_and_", e.g. "positive_and_rising".
function evaluateStudyPredicate(
	predicate: string,
	value: number | string | boolean,
	trend: StudyTrend
): boolean {
	const tokens = predicate
		.split('_and_')
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	return tokens.length > 0 && tokens.every((token) => evaluatePredicateToken(token, value, trend));
}

export async function evaluateStudyOutput(
	condition: StudyOutputCondition,
	instrumentId: string,
	deps: ConditionEvalDeps
): Promise<ConditionEvalOutcome> {
	const gate = availabilityGate(deps.registry, condition.studyId);
	if (!gate.available) {
		return unavailableOutcome(gate.reason);
	}
	const raw = await deps.marketData.getStudyOutput(
		instrumentId,
		condition.studyId,
		condition.params,
		condition.outputName
	);
	if (raw === null) {
		return unavailableOutcome(
			`Study "${condition.studyId}" output "${condition.outputName}" has no value for ${instrumentId}.`
		);
	}
	const trend = await resolveStudyTrend(condition, instrumentId, deps);
	return outcome(evaluateStudyPredicate(condition.predicate, raw, trend), raw);
}
