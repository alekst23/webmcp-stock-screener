// Per-condition-type evaluation (T-1009-7 AC2, AC12): one small evaluator per
// of the eight condition variants behind a dispatch table, mirroring
// conditionValidation.ts's per-family split. This file answers "does this
// one condition pass for this one instrument", never a boolean combination
// (tree.ts) and never a ranking (ranking.ts).
//
// This file owns the dispatch table (`evaluateCondition`, the exported entry
// point) and the four structurally simpler variants: scalar, range,
// series_comparison, temporal. conditionEvaluation.catalog.ts owns the four
// variants that lean hardest on catalog lookups (event_relative, pattern,
// relative, study_output); shared helpers live in
// conditionEvaluation.shared.ts so neither file depends on the other.
//
// Infra layer: implements evaluation behind the domain port (ports.ts);
// domain code does not import this file.

import type {
	Condition,
	RangeCondition,
	ScalarCondition,
	SeriesComparisonCondition,
	TemporalCondition,
	TemporalEvent
} from '../conditions';
import {
	evaluateEventRelative,
	evaluatePattern,
	evaluateRelative,
	evaluateStudyOutput
} from './conditionEvaluation.catalog';
import {
	availabilityGate,
	compareScalar,
	outcome,
	unavailableOutcome,
	type ConditionEvalDeps,
	type ConditionEvalOutcome
} from './conditionEvaluation.shared';

export type { ConditionEvalDeps, ConditionEvalOutcome } from './conditionEvaluation.shared';

async function evaluateScalar(
	condition: ScalarCondition,
	instrumentId: string,
	deps: ConditionEvalDeps
): Promise<ConditionEvalOutcome> {
	const gate = availabilityGate(deps.registry, condition.fieldId);
	if (!gate.available) {
		return unavailableOutcome(gate.reason);
	}
	const raw = await deps.marketData.getFieldValue(instrumentId, condition.fieldId);
	if (raw === null) {
		return unavailableOutcome(`Field "${condition.fieldId}" has no value for ${instrumentId}.`);
	}
	return outcome(
		compareScalar(condition.operator, raw, condition.value),
		raw,
		condition.unit ?? undefined
	);
}

async function evaluateRange(
	condition: RangeCondition,
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
	const lowerOk = condition.lowerInclusive ? raw >= condition.lower : raw > condition.lower;
	const upperOk = condition.upperInclusive ? raw <= condition.upper : raw < condition.upper;
	return outcome(lowerOk && upperOk, raw);
}

async function evaluateSeriesComparison(
	condition: SeriesComparisonCondition,
	instrumentId: string,
	deps: ConditionEvalDeps
): Promise<ConditionEvalOutcome> {
	const leftGate = availabilityGate(deps.registry, condition.left.catalogId);
	if (!leftGate.available) {
		return unavailableOutcome(leftGate.reason);
	}
	const rightGate = availabilityGate(deps.registry, condition.right.catalogId);
	if (!rightGate.available) {
		return unavailableOutcome(rightGate.reason);
	}
	const left = await deps.marketData.getSeries(
		instrumentId,
		condition.left.catalogId,
		condition.left.params
	);
	const right = await deps.marketData.getSeries(
		instrumentId,
		condition.right.catalogId,
		condition.right.params
	);
	const prevLeft = left[left.length - 2];
	const curLeft = left[left.length - 1];
	const prevRight = right[right.length - 2];
	const curRight = right[right.length - 1];
	if (!prevLeft || !curLeft || !prevRight || !curRight) {
		return unavailableOutcome(
			`At least two bars are required on both series to detect a crossing for ${instrumentId}.`
		);
	}
	let passed = false;
	if (condition.operator === 'op.crosses_above') {
		passed = prevLeft.value <= prevRight.value && curLeft.value > curRight.value;
	} else if (condition.operator === 'op.crosses_below') {
		passed = prevLeft.value >= prevRight.value && curLeft.value < curRight.value;
	}
	return outcome(
		passed,
		curLeft.value - curRight.value,
		undefined,
		`left=${curLeft.value}, right=${curRight.value}`
	);
}

// Derives a per-point boolean signal for a temporal condition's inner
// condition, so evaluateTemporal can scan for an edge or a presence over a
// trailing window. Only the inner shapes that map onto one or two catalog
// series under this port's narrow surface (scalar, range, series_comparison)
// are supported; anything else returns null so the caller reports
// dataUnavailable rather than fabricating history it cannot read.
async function derivePointSignal(
	inner: Condition,
	instrumentId: string,
	deps: ConditionEvalDeps
): Promise<boolean[] | null> {
	if (inner.type === 'scalar') {
		const gate = availabilityGate(deps.registry, inner.fieldId);
		if (!gate.available) return null;
		const series = await deps.marketData.getSeries(instrumentId, inner.fieldId, {});
		if (series.length === 0) return null;
		return series.map((point) => compareScalar(inner.operator, point.value, inner.value));
	}
	if (inner.type === 'range') {
		const gate = availabilityGate(deps.registry, inner.fieldId);
		if (!gate.available) return null;
		const series = await deps.marketData.getSeries(instrumentId, inner.fieldId, {});
		if (series.length === 0) return null;
		return series.map((point) => {
			const lowerOk = inner.lowerInclusive ? point.value >= inner.lower : point.value > inner.lower;
			const upperOk = inner.upperInclusive ? point.value <= inner.upper : point.value < inner.upper;
			return lowerOk && upperOk;
		});
	}
	if (inner.type === 'series_comparison') {
		const leftGate = availabilityGate(deps.registry, inner.left.catalogId);
		const rightGate = availabilityGate(deps.registry, inner.right.catalogId);
		if (!leftGate.available || !rightGate.available) return null;
		const left = await deps.marketData.getSeries(
			instrumentId,
			inner.left.catalogId,
			inner.left.params
		);
		const right = await deps.marketData.getSeries(
			instrumentId,
			inner.right.catalogId,
			inner.right.params
		);
		const length = Math.min(left.length, right.length);
		if (length === 0) return null;
		const signal: boolean[] = [];
		for (let i = 0; i < length; i++) {
			const l = left[i];
			const r = right[i];
			signal.push(l !== undefined && r !== undefined && l.value > r.value);
		}
		return signal;
	}
	return null;
}

// Scans the trailing `withinBars` points of a derived signal for the
// temporal condition's declared event: any true point ('became_true'), a
// rising edge ('crossed_above'), or a falling edge ('crossed_below'). An
// edge at the very first point of `signal` is undetectable (there is no
// prior point to compare against) -- an honest limit of scanning a finite
// history rather than an unbounded one.
function scanWindow(signal: readonly boolean[], withinBars: number, event: TemporalEvent): boolean {
	const windowStart = Math.max(0, signal.length - withinBars);
	if (event === 'became_true') {
		return signal.slice(windowStart).some((value) => value);
	}
	for (let i = Math.max(1, windowStart); i < signal.length; i++) {
		const prev = signal[i - 1];
		const cur = signal[i];
		if (prev === undefined || cur === undefined) continue;
		if (event === 'crossed_above' && !prev && cur) return true;
		if (event === 'crossed_below' && prev && !cur) return true;
	}
	return false;
}

async function evaluateTemporal(
	condition: TemporalCondition,
	instrumentId: string,
	deps: ConditionEvalDeps
): Promise<ConditionEvalOutcome> {
	const signal = await derivePointSignal(condition.condition, instrumentId, deps);
	if (signal === null) {
		return unavailableOutcome(
			`Temporal evaluation is not supported for a nested "${condition.condition.type}" ` +
				`condition, or its history is unavailable for ${instrumentId}.`
		);
	}
	const passed = scanWindow(signal, condition.withinBars, condition.event);
	return outcome(
		passed,
		passed,
		undefined,
		`evaluated over the trailing ${condition.withinBars} bar(s)`
	);
}

type Evaluator<C> = (
	condition: C,
	instrumentId: string,
	deps: ConditionEvalDeps
) => Promise<ConditionEvalOutcome>;

const EVALUATORS: { [K in Condition['type']]: Evaluator<Extract<Condition, { type: K }>> } = {
	scalar: evaluateScalar,
	range: evaluateRange,
	series_comparison: evaluateSeriesComparison,
	temporal: evaluateTemporal,
	event_relative: evaluateEventRelative,
	pattern: evaluatePattern,
	relative: evaluateRelative,
	study_output: evaluateStudyOutput
};

// The one exported entry point: dispatches on `condition.type` to the small
// per-family evaluator above (or in conditionEvaluation.catalog.ts).
export function evaluateCondition(
	condition: Condition,
	instrumentId: string,
	deps: ConditionEvalDeps
): Promise<ConditionEvalOutcome> {
	const evaluator = EVALUATORS[condition.type] as Evaluator<Condition>;
	return evaluator(condition, instrumentId, deps);
}
