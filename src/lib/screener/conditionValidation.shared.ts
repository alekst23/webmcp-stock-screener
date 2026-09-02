// Shared context type and helper functions for condition validation
// (T-1009-6). Split out so conditionValidation.ts (dispatch, scalar, range,
// series_comparison, temporal) and conditionValidation.catalog.ts
// (event_relative, pattern, relative, study_output) can both depend on this
// file without depending on each other -- a clean DAG instead of a cycle.
//
// Domain layer: no I/O, no import from src/lib/webmcp/.

import type { CatalogRegistry } from '../catalog/registry';
import type { CatalogParameter, NumericRange } from '../catalog/types';
import type { ResourceId } from '../workbench/domain/ids';
import { CONDITION_FIELD_ALLOWLIST, type Condition, type ComparisonValue } from './conditions';
import type { UniverseSpec } from './definition';
import { PROBLEM_CODES, type ProblemSeverity, type ValidationProblem } from './validation';

export interface ConditionValidationContext {
	registry?: CatalogRegistry;
	universe?: UniverseSpec;
	// The node the condition belongs to, for ValidationProblem.nodeIds. Absent
	// on a not-yet-written 'add' -- no node id has been minted yet.
	nodeId?: ResourceId;
}

// The resolved (defaulted) form every per-variant validator works against,
// so they never repeat the "registry ?? builtinCatalogRegistry" fallback.
export interface ResolvedContext {
	registry: CatalogRegistry;
	universe?: UniverseSpec;
}

export function problem(
	severity: ProblemSeverity,
	code: (typeof PROBLEM_CODES)[keyof typeof PROBLEM_CODES],
	nodeId: ResourceId | undefined,
	message: string,
	universeCriteria: string[] = []
): ValidationProblem {
	return { severity, code, nodeIds: nodeId ? [nodeId] : [], universeCriteria, message };
}

// AC9/AC12: an unknown ID names itself and, when the registry can suggest
// one, the nearest real IDs -- the same one-turn self-correction convention
// as src/lib/webmcp/discovery/describeCatalogItem.ts.
export function unknownItemProblem(
	nodeId: ResourceId | undefined,
	itemLabel: string,
	id: string,
	registry: CatalogRegistry
): ValidationProblem {
	const suggestions = registry.suggestCatalogIds(id);
	const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
	return problem(
		'blocking',
		PROBLEM_CODES.unknownCatalogItem,
		nodeId,
		`Unknown ${itemLabel} "${id}".${suggestionText}`
	);
}

export function withinRange(value: number, range?: NumericRange): boolean {
	if (!range) {
		return true;
	}
	if (range.min !== undefined && value < range.min) {
		return false;
	}
	if (range.max !== undefined && value > range.max) {
		return false;
	}
	return true;
}

export function describeRange(range?: NumericRange): string {
	if (!range || (range.min === undefined && range.max === undefined)) {
		return 'unrestricted';
	}
	if (range.min !== undefined && range.max !== undefined) {
		return `${range.min} to ${range.max}`;
	}
	return range.min !== undefined ? `>= ${range.min}` : `<= ${range.max}`;
}

// AC11: the structural guarantee behind "no raw SQL/JavaScript" -- a
// payload's own keys are checked against conditions.ts's declared allowlist
// for its `type`, so a stray `expression`/`query`/`sql`/`js` key is caught
// whether it arrives as an already-typed Condition (a test constructing one
// directly) or as the raw wire payload editFilterTree.ts parses before
// normalizeCondition would otherwise silently drop it.
export function findDisallowedConditionFields(value: unknown): readonly string[] {
	if (typeof value !== 'object' || value === null) {
		return [];
	}
	const type = (value as Record<string, unknown>).type;
	if (typeof type !== 'string' || !(type in CONDITION_FIELD_ALLOWLIST)) {
		return [];
	}
	const allowlist = CONDITION_FIELD_ALLOWLIST[type as Condition['type']];
	return Object.keys(value as Record<string, unknown>).filter((key) => !allowlist.includes(key));
}

// Shared by scalar (AC1) and relative (AC7): both name a field and an
// operator and require the operator's declared operand types to accept the
// field's declared value type.
export function validateOperatorForField(
	nodeId: ResourceId | undefined,
	registry: CatalogRegistry,
	operatorId: string,
	fieldId: string
): ValidationProblem[] {
	const operatorItem = registry.getCatalogItem(operatorId);
	if (!operatorItem || operatorItem.kind !== 'operator') {
		return [unknownItemProblem(nodeId, 'operator', operatorId, registry)];
	}
	const check = registry.isOperatorValidForField(operatorId, fieldId);
	return check.valid
		? []
		: [problem('blocking', PROBLEM_CODES.invalidParameter, nodeId, check.reason)];
}

function valueMatchesType(
	valueType: 'number' | 'string' | 'boolean' | 'date' | 'enum',
	value: ComparisonValue
): boolean {
	switch (valueType) {
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'boolean':
			return typeof value === 'boolean';
		case 'string':
		case 'date':
		case 'enum':
			return typeof value === 'string';
	}
}

// Shared by scalar's `value` (AC1) and a catalog parameter's value (AC10):
// both are "one typed value against one catalog-declared type/range/enum".
export function checkTypedValue(
	nodeId: ResourceId | undefined,
	label: string,
	valueType: 'number' | 'string' | 'boolean' | 'date' | 'enum',
	value: ComparisonValue,
	range?: NumericRange,
	enumValues?: readonly string[]
): ValidationProblem[] {
	if (!valueMatchesType(valueType, value)) {
		return [
			problem(
				'blocking',
				PROBLEM_CODES.invalidParameter,
				nodeId,
				`${label} value ${JSON.stringify(value)} is not a valid "${valueType}".`
			)
		];
	}
	if (typeof value === 'number' && !withinRange(value, range)) {
		return [
			problem(
				'blocking',
				PROBLEM_CODES.invalidParameter,
				nodeId,
				`${label} value ${value} is outside its permitted range (${describeRange(range)}).`
			)
		];
	}
	if (
		valueType === 'enum' &&
		typeof value === 'string' &&
		enumValues &&
		!enumValues.includes(value)
	) {
		return [
			problem(
				'blocking',
				PROBLEM_CODES.invalidParameter,
				nodeId,
				`${label} value "${value}" is not one of its permitted values: ${enumValues.join(', ')}.`
			)
		];
	}
	return [];
}

// AC10: every declared parameter is checked for type, range, and enum
// membership; a missing required parameter is its own rejection. Shared by
// series_comparison's SeriesRef params (AC3) and study_output's params
// (AC8).
export function validateCatalogParams(
	nodeId: ResourceId | undefined,
	parameters: readonly CatalogParameter[],
	values: Record<string, ComparisonValue>
): ValidationProblem[] {
	const problems: ValidationProblem[] = [];
	for (const param of parameters) {
		const has = Object.prototype.hasOwnProperty.call(values, param.name);
		if (!has) {
			if (param.required) {
				problems.push(
					problem(
						'blocking',
						PROBLEM_CODES.invalidParameter,
						nodeId,
						`Missing required parameter "${param.name}".`
					)
				);
			}
			continue;
		}
		problems.push(
			...checkTypedValue(
				nodeId,
				`Parameter "${param.name}"`,
				param.valueType,
				values[param.name] as ComparisonValue,
				param.range,
				param.enumValues
			)
		);
	}
	return problems;
}

export function extraFieldProblems(
	condition: Condition,
	nodeId: ResourceId | undefined
): ValidationProblem[] {
	const extra = findDisallowedConditionFields(condition);
	if (extra.length === 0) {
		return [];
	}
	return [
		problem(
			'blocking',
			PROBLEM_CODES.invalidParameter,
			nodeId,
			`Condition carries field(s) not part of the ${condition.type} model: ${extra.join(', ')}. ` +
				'No condition variant accepts a free-form expression, query, or code string.'
		)
	];
}
