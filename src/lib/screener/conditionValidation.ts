// Catalog validation for the eight condition variants (T-1009-6). Every
// existence, type, range, output-name and availability answer here comes
// from the injected CatalogRegistry -- nothing about a field, operator,
// study, pattern or interval is hard-coded, so the catalog stays the single
// source of truth (EPIC-1008).
//
// This file owns the dispatch table (`validateCondition`, the exported
// entry point) and the four structurally simpler variants: scalar, range,
// series_comparison, temporal. conditionValidation.catalog.ts owns the four
// variants whose rules lean hardest on catalog lookups (event_relative,
// pattern, relative, study_output); shared helpers live in
// conditionValidation.shared.ts so neither file depends on the other.
//
// Domain layer: no I/O, no import from src/lib/webmcp/.

import { builtinCatalogRegistry, type CatalogRegistry } from '../catalog/registry';
import {
	validateEventRelative,
	validatePattern,
	validateRelative,
	validateStudyOutput
} from './conditionValidation.catalog';
import {
	checkTypedValue,
	describeRange,
	extraFieldProblems,
	problem,
	unknownItemProblem,
	validateCatalogParams,
	validateOperatorForField,
	withinRange,
	type ConditionValidationContext,
	type ResolvedContext
} from './conditionValidation.shared';
import type {
	Condition,
	RangeCondition,
	ScalarCondition,
	SeriesComparisonCondition,
	SeriesRef,
	TemporalCondition
} from './conditions';
import { PROBLEM_CODES, type ValidationProblem } from './validation';
import type { ResourceId } from '../workbench/domain/ids';

export type { ConditionValidationContext } from './conditionValidation.shared';
export { findDisallowedConditionFields } from './conditionValidation.shared';

function validateScalar(
	condition: ScalarCondition,
	ctx: ResolvedContext,
	nodeId: ResourceId | undefined
): ValidationProblem[] {
	const field = ctx.registry.getCatalogItem(condition.fieldId);
	if (!field || field.kind !== 'field') {
		return [unknownItemProblem(nodeId, 'field', condition.fieldId, ctx.registry)];
	}
	return [
		...validateOperatorForField(nodeId, ctx.registry, condition.operator, field.id),
		...checkTypedValue(
			nodeId,
			`Field "${field.id}"`,
			field.valueType,
			condition.value,
			field.range,
			field.enumValues
		)
	];
}

function validateRange(
	condition: RangeCondition,
	ctx: ResolvedContext,
	nodeId: ResourceId | undefined
): ValidationProblem[] {
	const field = ctx.registry.getCatalogItem(condition.fieldId);
	if (!field || field.kind !== 'field') {
		return [unknownItemProblem(nodeId, 'field', condition.fieldId, ctx.registry)];
	}
	const problems: ValidationProblem[] = [];
	if (field.valueType !== 'number') {
		problems.push(
			problem(
				'blocking',
				PROBLEM_CODES.invalidParameter,
				nodeId,
				`Field "${field.id}" is of type "${field.valueType}"; a range condition requires a numeric field.`
			)
		);
	}
	if (condition.lower > condition.upper) {
		problems.push(
			problem(
				'blocking',
				PROBLEM_CODES.invalidParameter,
				nodeId,
				`Range lower bound ${condition.lower} exceeds its upper bound ${condition.upper}.`
			)
		);
	}
	if (field.range) {
		if (!withinRange(condition.lower, field.range)) {
			problems.push(rangeBoundProblem(nodeId, 'lower', condition.lower, field.id, field.range));
		}
		if (!withinRange(condition.upper, field.range)) {
			problems.push(rangeBoundProblem(nodeId, 'upper', condition.upper, field.id, field.range));
		}
	}
	return problems;
}

function rangeBoundProblem(
	nodeId: ResourceId | undefined,
	bound: 'lower' | 'upper',
	value: number,
	fieldId: string,
	range: { min?: number; max?: number }
): ValidationProblem {
	return problem(
		'blocking',
		PROBLEM_CODES.invalidParameter,
		nodeId,
		`Range ${bound} bound ${value} for field "${fieldId}" is outside its permitted range (${describeRange(range)}).`
	);
}

interface ResolvedSeries {
	valueType: 'number' | 'string' | 'boolean' | 'date' | 'enum';
	unit?: string;
}

function resolveSeriesValue(
	item: ReturnType<CatalogRegistry['getCatalogItem']>
): ResolvedSeries | null {
	if (!item) {
		return null;
	}
	if (item.kind === 'field') {
		return { valueType: item.valueType, unit: item.unit };
	}
	if (item.kind === 'study' || item.kind === 'indicator') {
		const output = item.outputs[0];
		return output ? { valueType: output.valueType, unit: output.unit } : null;
	}
	return null;
}

function validateSeriesRef(
	nodeId: ResourceId | undefined,
	ctx: ResolvedContext,
	side: 'left' | 'right',
	ref: SeriesRef
): { problems: ValidationProblem[]; resolved: ResolvedSeries | null } {
	const item = ctx.registry.getCatalogItem(ref.catalogId);
	if (!item) {
		return {
			problems: [unknownItemProblem(nodeId, `${side} series`, ref.catalogId, ctx.registry)],
			resolved: null
		};
	}
	const resolved = resolveSeriesValue(item);
	const problems: ValidationProblem[] = [];
	if (!resolved) {
		problems.push(
			problem(
				'blocking',
				PROBLEM_CODES.invalidParameter,
				nodeId,
				`"${item.id}" is a ${item.kind}, which cannot be used as a series in a series_comparison condition.`
			)
		);
	}
	if ('parameters' in item) {
		problems.push(...validateCatalogParams(nodeId, item.parameters, ref.params));
	}
	return { problems, resolved };
}

function validateSeriesComparison(
	condition: SeriesComparisonCondition,
	ctx: ResolvedContext,
	nodeId: ResourceId | undefined
): ValidationProblem[] {
	const problems: ValidationProblem[] = [];
	const operatorItem = ctx.registry.getCatalogItem(condition.operator);
	if (!operatorItem || operatorItem.kind !== 'operator') {
		problems.push(unknownItemProblem(nodeId, 'operator', condition.operator, ctx.registry));
	}
	const left = validateSeriesRef(nodeId, ctx, 'left', condition.left);
	const right = validateSeriesRef(nodeId, ctx, 'right', condition.right);
	problems.push(...left.problems, ...right.problems);
	if (left.resolved && right.resolved) {
		if (left.resolved.valueType !== right.resolved.valueType) {
			problems.push(
				problem(
					'blocking',
					PROBLEM_CODES.invalidParameter,
					nodeId,
					`Series are not comparable: left is "${left.resolved.valueType}", right is "${right.resolved.valueType}".`
				)
			);
		} else if (
			left.resolved.unit &&
			right.resolved.unit &&
			left.resolved.unit !== right.resolved.unit
		) {
			problems.push(
				problem(
					'blocking',
					PROBLEM_CODES.invalidParameter,
					nodeId,
					`Series are not comparable: left unit "${left.resolved.unit}" differs from right unit "${right.resolved.unit}".`
				)
			);
		}
	}
	return problems;
}

// The only recursive variant (technical.md): validation must walk into the
// inner condition rather than assume a flat shape. The inner condition
// shares the outer node's id -- it has no node id of its own in this model.
function validateTemporal(
	condition: TemporalCondition,
	ctx: ResolvedContext,
	nodeId: ResourceId | undefined
): ValidationProblem[] {
	const problems = validateCondition(condition.condition, { ...ctx, nodeId });
	const interval = ctx.registry.getCatalogItem(condition.intervalId);
	if (!interval || interval.kind !== 'interval') {
		problems.push(unknownItemProblem(nodeId, 'interval', condition.intervalId, ctx.registry));
	}
	if (condition.withinBars <= 0) {
		problems.push(
			problem(
				'blocking',
				PROBLEM_CODES.invalidParameter,
				nodeId,
				`within_bars must be a positive integer; got ${condition.withinBars}.`
			)
		);
	}
	return problems;
}

type Validator<C> = (
	condition: C,
	ctx: ResolvedContext,
	nodeId: ResourceId | undefined
) => ValidationProblem[];

const VALIDATORS: { [K in Condition['type']]: Validator<Extract<Condition, { type: K }>> } = {
	scalar: validateScalar,
	range: validateRange,
	series_comparison: validateSeriesComparison,
	temporal: validateTemporal,
	event_relative: validateEventRelative,
	pattern: validatePattern,
	relative: validateRelative,
	study_output: validateStudyOutput
};

// The one exported entry point (per the ticket): empty array means valid.
// `context` defaults its registry to the built-in catalog so call sites need
// not thread one through for the common case, while tests can still inject a
// fixture registry (per-variant tests do, to exercise availability and range
// edges the seeded inventory doesn't happen to cover).
export function validateCondition(
	condition: Condition,
	context: ConditionValidationContext = {}
): ValidationProblem[] {
	const ctx: ResolvedContext = {
		registry: context.registry ?? builtinCatalogRegistry,
		universe: context.universe
	};
	const validator = VALIDATORS[condition.type] as Validator<Condition>;
	return [
		...extraFieldProblems(condition, context.nodeId),
		...validator(condition, ctx, context.nodeId)
	];
}
