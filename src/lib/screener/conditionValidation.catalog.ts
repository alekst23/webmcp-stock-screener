// The four condition variants whose validation rules lean hardest on
// catalog lookups (T-1009-6): event_relative, pattern, relative, and
// study_output. Split out of conditionValidation.ts to stay under the
// 400-line file limit; shared helpers live in conditionValidation.shared.ts
// so this file and conditionValidation.ts can both depend on it without
// depending on each other.
//
// Domain layer: no I/O, no import from src/lib/webmcp/.

import type { ResourceId } from '../workbench/domain/ids';
import {
	problem,
	unknownItemProblem,
	validateCatalogParams,
	validateOperatorForField,
	type ResolvedContext
} from './conditionValidation.shared';
import type {
	EventRelativeCondition,
	PatternCondition,
	RelativeBaseline,
	RelativeCondition,
	StudyOutputCondition
} from './conditions';
import { PROBLEM_CODES, type ValidationProblem } from './validation';

// No pre-existing enumeration of study-output predicates exists anywhere in
// the codebase (conditions.ts deliberately keeps `predicate` a plain string
// so the condition model itself stays catalog-agnostic); this closed list is
// this validator's own contract for "the predicate is a member of a closed
// union" (AC8), not a catalog-sourced value.
export const STUDY_OUTPUT_PREDICATES = [
	'above_zero',
	'below_zero',
	'positive',
	'negative',
	'rising',
	'falling',
	'positive_and_rising',
	'negative_and_falling'
] as const;

export type StudyOutputPredicate = (typeof STUDY_OUTPUT_PREDICATES)[number];

// AC5: the event type resolves through the catalog like any other item (no
// dedicated "event" kind exists, so an event type is a catalog field, e.g.
// field.earnings.next_report_date); availability is a data-availability
// question the registry answers directly, not one this validator fetches a
// calendar to resolve. `requiresReferenceData` is the flag the ticket names
// as the one to read.
export function validateEventRelative(
	condition: EventRelativeCondition,
	ctx: ResolvedContext,
	nodeId: ResourceId | undefined
): ValidationProblem[] {
	const item = ctx.registry.getCatalogItem(condition.eventTypeId);
	if (!item) {
		return [unknownItemProblem(nodeId, 'event type', condition.eventTypeId, ctx.registry)];
	}
	const problems: ValidationProblem[] = [];
	if (item.availability.status === 'unavailable' && item.availability.requiresReferenceData) {
		const universeCriteria = ctx.universe?.assetClass ? [ctx.universe.assetClass] : [];
		problems.push(
			problem(
				'blocking',
				PROBLEM_CODES.unavailableData,
				nodeId,
				`Event type "${item.id}" is unavailable for this screener's universe: ${item.availability.reason}`,
				universeCriteria
			)
		);
	}
	if (condition.windowDays < 0) {
		problems.push(
			problem(
				'blocking',
				PROBLEM_CODES.invalidParameter,
				nodeId,
				`window_days must be zero or greater; got ${condition.windowDays}.`
			)
		);
	}
	return problems;
}

// AC6: confidence is a probability by construction, so its permitted range
// (0 to 1) is a structural invariant of the condition model rather than a
// catalog-declared one; the pattern's own availability.intervalIds (not a
// hard-coded list) decides which intervals it may be detected on.
export function validatePattern(
	condition: PatternCondition,
	ctx: ResolvedContext,
	nodeId: ResourceId | undefined
): ValidationProblem[] {
	const item = ctx.registry.getCatalogItem(condition.patternId);
	if (!item || item.kind !== 'pattern') {
		return [unknownItemProblem(nodeId, 'pattern', condition.patternId, ctx.registry)];
	}
	const problems: ValidationProblem[] = [];
	if (condition.minConfidence < 0 || condition.minConfidence > 1) {
		problems.push(
			problem(
				'blocking',
				PROBLEM_CODES.invalidParameter,
				nodeId,
				`min_confidence ${condition.minConfidence} is outside its permitted range (0 to 1).`
			)
		);
	}
	const interval = ctx.registry.getCatalogItem(condition.intervalId);
	if (!interval || interval.kind !== 'interval') {
		problems.push(unknownItemProblem(nodeId, 'interval', condition.intervalId, ctx.registry));
	} else if (!item.availability.intervalIds.includes(condition.intervalId)) {
		const available =
			item.availability.intervalIds.length > 0
				? item.availability.intervalIds.join(', ')
				: '(none)';
		problems.push(
			problem(
				'blocking',
				PROBLEM_CODES.unavailableData,
				nodeId,
				`Pattern "${item.id}" is not available on interval "${condition.intervalId}"; available intervals: ${available}.`
			)
		);
	}
	return problems;
}

function validateBaseline(
	baseline: RelativeBaseline,
	ctx: ResolvedContext,
	nodeId: ResourceId | undefined
): ValidationProblem[] {
	if (baseline.kind === 'own_moving_average') {
		if (!Number.isFinite(baseline.windowBars) || baseline.windowBars <= 0) {
			return [
				problem(
					'blocking',
					PROBLEM_CODES.invalidParameter,
					nodeId,
					`windowBars must be a positive integer; got ${baseline.windowBars}.`
				)
			];
		}
		return [];
	}
	// A peer group or index baseline is, in this catalog, always represented
	// as a universe item (e.g. universe.sp500) -- there is no separate "peer
	// group" catalog kind to look it up under.
	const id = baseline.kind === 'peer_group' ? baseline.groupId : baseline.indexId;
	const label = baseline.kind === 'peer_group' ? 'peer group' : 'index';
	const item = ctx.registry.getCatalogItem(id);
	if (!item || item.kind !== 'universe') {
		return [unknownItemProblem(nodeId, label, id, ctx.registry)];
	}
	return [];
}

// AC7: field, baseline, multiple, and operator each validate independently
// so a rejection can point at exactly the offending piece.
export function validateRelative(
	condition: RelativeCondition,
	ctx: ResolvedContext,
	nodeId: ResourceId | undefined
): ValidationProblem[] {
	const problems: ValidationProblem[] = [];
	const field = ctx.registry.getCatalogItem(condition.fieldId);
	if (!field || field.kind !== 'field') {
		problems.push(unknownItemProblem(nodeId, 'field', condition.fieldId, ctx.registry));
	} else {
		if (field.valueType !== 'number') {
			problems.push(
				problem(
					'blocking',
					PROBLEM_CODES.invalidParameter,
					nodeId,
					`Field "${field.id}" is of type "${field.valueType}"; a relative condition requires a numeric field.`
				)
			);
		}
		problems.push(...validateOperatorForField(nodeId, ctx.registry, condition.operator, field.id));
	}
	problems.push(...validateBaseline(condition.baseline, ctx, nodeId));
	if (!Number.isFinite(condition.multiple) || condition.multiple <= 0) {
		problems.push(
			problem(
				'blocking',
				PROBLEM_CODES.invalidParameter,
				nodeId,
				`multiple must be a finite positive number; got ${condition.multiple}.`
			)
		);
	}
	return problems;
}

// AC8: the study resolves, its parameters validate against the study's own
// declared CatalogParameter[], the named output must be one the study
// declares, and the predicate is a member of this validator's closed union.
export function validateStudyOutput(
	condition: StudyOutputCondition,
	ctx: ResolvedContext,
	nodeId: ResourceId | undefined
): ValidationProblem[] {
	const study = ctx.registry.resolveStudy(condition.studyId);
	if (!study) {
		return [unknownItemProblem(nodeId, 'study', condition.studyId, ctx.registry)];
	}
	const problems: ValidationProblem[] = [
		...validateCatalogParams(nodeId, study.parameters, condition.params)
	];
	const output = study.outputs.find((candidate) => candidate.name === condition.outputName);
	if (!output) {
		const valid = study.outputs.map((candidate) => candidate.name);
		problems.push(
			problem(
				'blocking',
				PROBLEM_CODES.invalidParameter,
				nodeId,
				`"${condition.outputName}" is not an output of study "${study.id}". Valid outputs: ${
					valid.length > 0 ? valid.join(', ') : '(none)'
				}.`
			)
		);
	}
	if (!(STUDY_OUTPUT_PREDICATES as readonly string[]).includes(condition.predicate)) {
		problems.push(
			problem(
				'blocking',
				PROBLEM_CODES.invalidParameter,
				nodeId,
				`"${condition.predicate}" is not a recognized predicate. Valid predicates: ${STUDY_OUTPUT_PREDICATES.join(', ')}.`
			)
		);
	}
	return problems;
}
