// Validates an arbitrary JSON payload against the closed ExpressionNode
// shape (T-1014-1). This is the safety boundary the epic's "no arbitrary
// code execution" guarantee lives in: a payload is proven to be a tree of
// the five permitted node kinds -- resolved against the catalog registry,
// type/unit-checked, and cost-bounded -- before anything downstream (the
// evaluator, or a tool built on it) ever touches it. Nothing here parses a
// string into code or hands text to an interpreter.
//
// Domain layer: no I/O. Depends only on the published CatalogRegistry port.
import type { CatalogRegistry } from '../../../catalog/registry';
import type {
	CatalogItem,
	CatalogOutput,
	CatalogParameter,
	CatalogValueType,
	IndicatorItem,
	PatternItem,
	StudyItem
} from '../../../catalog/types';
import { ExpressionValidationError } from './expressionErrors';
import { DEFAULT_EXPRESSION_LIMITS, type ExpressionCostLimits } from './expressionLimits';
import {
	ARITHMETIC_OPERATORS,
	COMPARISON_OPERATORS,
	LITERAL_VALUE_TYPES,
	usageForResultType,
	type ArithmeticOperator,
	type ComparisonOperator,
	type ExpressionNode,
	type LiteralValue,
	type LiteralValueType,
	type ValidatedExpression
} from './expressionModel';

export type ExpressionValidationResult =
	| { valid: true; expression: ValidatedExpression }
	| { valid: false; error: ExpressionValidationError };

// A catalog item carrying `parameters`/`outputs` -- the three kinds that
// share ComputedItemCore's shape. ComputedItemCore itself isn't exported
// from catalog/types.ts (only its concrete kinds are), so this union is the
// port-safe way to name "a callable catalog item".
type CallableItem = StudyItem | IndicatorItem | PatternItem;

function isCallableItem(item: CatalogItem): item is CallableItem {
	return item.kind === 'study' || item.kind === 'indicator' || item.kind === 'pattern';
}

interface Resolved {
	node: ExpressionNode;
	resultType: CatalogValueType;
	resultUnit?: string;
}

interface WalkState {
	nodeCount: number;
}

export function validateExpression(
	raw: unknown,
	registry: CatalogRegistry,
	limits: ExpressionCostLimits = DEFAULT_EXPRESSION_LIMITS
): ExpressionValidationResult {
	try {
		const state: WalkState = { nodeCount: 0 };
		const resolved = resolveNode(raw, registry, limits, 'root', 1, state);
		return {
			valid: true,
			expression: {
				node: resolved.node,
				resultType: resolved.resultType,
				resultUnit: resolved.resultUnit,
				usage: usageForResultType(resolved.resultType)
			}
		};
	} catch (err) {
		if (err instanceof ExpressionValidationError) {
			return { valid: false, error: err };
		}
		throw err;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveNode(
	raw: unknown,
	registry: CatalogRegistry,
	limits: ExpressionCostLimits,
	path: string,
	depth: number,
	state: WalkState
): Resolved {
	state.nodeCount += 1;
	if (state.nodeCount > limits.maxNodes) {
		throw ExpressionValidationError.nodeCountExceeded(limits.maxNodes);
	}
	if (depth > limits.maxDepth) {
		throw ExpressionValidationError.depthExceeded(path, limits.maxDepth);
	}
	if (!isPlainObject(raw)) {
		throw ExpressionValidationError.unknownNodeKind(path, raw);
	}
	switch (raw.kind) {
		case 'literal':
			return resolveLiteral(raw, path);
		case 'field_ref':
			return resolveFieldRef(raw, registry, path);
		case 'function_call':
			return resolveFunctionCall(raw, registry, limits, path);
		case 'arithmetic':
			return resolveBinary(raw, registry, limits, path, depth, state, 'arithmetic');
		case 'comparison':
			return resolveBinary(raw, registry, limits, path, depth, state, 'comparison');
		default:
			throw ExpressionValidationError.unknownNodeKind(path, raw.kind);
	}
}

function resolveLiteral(raw: Record<string, unknown>, path: string): Resolved {
	const valueType = raw.valueType;
	const value = raw.value;
	const isValidType = LITERAL_VALUE_TYPES.includes(valueType as LiteralValueType);
	const typeofMatches = isValidType && typeof value === valueType;
	const finiteIfNumber = valueType !== 'number' || (typeof value === 'number' && Number.isFinite(value));
	if (!typeofMatches || !finiteIfNumber) {
		throw ExpressionValidationError.invalidLiteral(path, valueType, value);
	}
	return {
		node: { kind: 'literal', valueType: valueType as LiteralValueType, value: value as LiteralValue },
		resultType: valueType as CatalogValueType,
		resultUnit: undefined
	};
}

function resolveFieldRef(
	raw: Record<string, unknown>,
	registry: CatalogRegistry,
	path: string
): Resolved {
	const fieldId = raw.fieldId;
	if (typeof fieldId !== 'string' || fieldId === '') {
		throw ExpressionValidationError.unresolvedField(path, String(fieldId), []);
	}
	const item = registry.getCatalogItem(fieldId);
	if (!item || item.kind !== 'field') {
		throw ExpressionValidationError.unresolvedField(path, fieldId, fieldSuggestions(registry, fieldId));
	}
	return { node: { kind: 'field_ref', fieldId }, resultType: item.valueType, resultUnit: item.unit };
}

function fieldSuggestions(registry: CatalogRegistry, fieldId: string): string[] {
	const suggestions = registry.suggestCatalogIds(fieldId);
	if (suggestions.length > 0) {
		return suggestions;
	}
	return registry
		.listCatalogItems('field')
		.map((item) => item.id)
		.slice(0, 20);
}

function callableSuggestions(registry: CatalogRegistry, functionId: string): string[] {
	const suggestions = registry.suggestCatalogIds(functionId);
	if (suggestions.length > 0) {
		return suggestions;
	}
	return registry
		.listCatalogItems()
		.filter(isCallableItem)
		.map((item) => item.id)
		.slice(0, 20);
}

function resolveFunctionCall(
	raw: Record<string, unknown>,
	registry: CatalogRegistry,
	limits: ExpressionCostLimits,
	path: string
): Resolved {
	const functionId = raw.functionId;
	if (typeof functionId !== 'string' || functionId === '') {
		throw ExpressionValidationError.unresolvedFunction(path, String(functionId), []);
	}
	const item = registry.getCatalogItem(functionId);
	if (!item || !isCallableItem(item)) {
		throw ExpressionValidationError.unresolvedFunction(
			path,
			functionId,
			callableSuggestions(registry, functionId)
		);
	}
	if (raw.args !== undefined && !isPlainObject(raw.args)) {
		throw ExpressionValidationError.argumentTypeMismatch(path, functionId, 'args', 'object');
	}
	const suppliedArgs = isPlainObject(raw.args) ? raw.args : {};
	const args = resolveArgs(item, suppliedArgs, limits, path, functionId);
	const outputName = resolveOutputName(item, raw.outputName, path, functionId);
	const output = item.outputs.find((o) => o.name === outputName) as CatalogOutput;
	return {
		node: { kind: 'function_call', functionId, args, outputName },
		resultType: output.valueType,
		resultUnit: output.unit
	};
}

function resolveArgs(
	item: CallableItem,
	suppliedArgs: Record<string, unknown>,
	limits: ExpressionCostLimits,
	path: string,
	functionId: string
): Record<string, LiteralValue> {
	const declaredNames = new Set(item.parameters.map((p) => p.name));
	for (const key of Object.keys(suppliedArgs)) {
		if (!declaredNames.has(key)) {
			throw ExpressionValidationError.unexpectedArgument(path, functionId, key, [...declaredNames]);
		}
	}
	const missing = item.parameters
		.filter((p) => !(p.name in suppliedArgs) && (p.required || p.defaultValue === null))
		.map((p) => p.name);
	if (missing.length > 0) {
		throw ExpressionValidationError.missingArgument(path, functionId, missing);
	}
	const resolved: Record<string, LiteralValue> = {};
	for (const param of item.parameters) {
		const value = param.name in suppliedArgs ? suppliedArgs[param.name] : param.defaultValue;
		resolved[param.name] = validateArgValue(param, value, limits, path, functionId);
	}
	return resolved;
}

function validateArgValue(
	param: CatalogParameter,
	value: unknown,
	limits: ExpressionCostLimits,
	path: string,
	functionId: string
): LiteralValue {
	if (!argValueMatchesType(param, value)) {
		throw ExpressionValidationError.argumentTypeMismatch(
			path,
			functionId,
			param.name,
			describeParamType(param)
		);
	}
	const literal = value as LiteralValue;
	if (typeof literal === 'number' && param.range) {
		const { min, max } = param.range;
		if ((min !== undefined && literal < min) || (max !== undefined && literal > max)) {
			throw ExpressionValidationError.argumentOutOfRange(path, functionId, param.name, param.range);
		}
	}
	if (typeof literal === 'number' && param.unit === 'bars' && literal > limits.maxLookbackBars) {
		throw ExpressionValidationError.lookbackExceeded(
			path,
			functionId,
			param.name,
			literal,
			limits.maxLookbackBars
		);
	}
	return literal;
}

function argValueMatchesType(param: CatalogParameter, value: unknown): boolean {
	if (param.valueType === 'number') return typeof value === 'number' && Number.isFinite(value);
	if (param.valueType === 'boolean') return typeof value === 'boolean';
	if (param.valueType === 'enum') {
		return typeof value === 'string' && (param.enumValues?.includes(value) ?? false);
	}
	// 'string' and 'date' both accept a plain string -- a date parameter is
	// an opaque ISO-8601 string, never parsed or executed here.
	return typeof value === 'string';
}

function describeParamType(param: CatalogParameter): string {
	if (param.valueType === 'enum') {
		return `enum (${(param.enumValues ?? []).join(', ')})`;
	}
	if (param.valueType === 'date') {
		return 'date (ISO-8601 string)';
	}
	return param.valueType;
}

function resolveOutputName(
	item: CallableItem,
	rawOutputName: unknown,
	path: string,
	functionId: string
): string {
	const declared = item.outputs.map((o) => o.name);
	if (rawOutputName === undefined) {
		if (declared.length === 1) return declared[0] as string;
		throw ExpressionValidationError.ambiguousOutput(path, functionId, declared);
	}
	if (typeof rawOutputName !== 'string' || !declared.includes(rawOutputName)) {
		throw ExpressionValidationError.unknownOutput(path, functionId, String(rawOutputName), declared);
	}
	return rawOutputName;
}

function resolveBinary(
	raw: Record<string, unknown>,
	registry: CatalogRegistry,
	limits: ExpressionCostLimits,
	path: string,
	depth: number,
	state: WalkState,
	kind: 'arithmetic' | 'comparison'
): Resolved {
	const permitted = kind === 'arithmetic' ? ARITHMETIC_OPERATORS : COMPARISON_OPERATORS;
	const op = raw.op;
	if (typeof op !== 'string' || !(permitted as readonly string[]).includes(op)) {
		throw ExpressionValidationError.invalidOperator(path, kind, op, permitted);
	}
	const left = resolveNode(raw.left, registry, limits, `${path}.left`, depth + 1, state);
	const right = resolveNode(raw.right, registry, limits, `${path}.right`, depth + 1, state);
	return kind === 'arithmetic'
		? resolveArithmeticResult(path, op as ArithmeticOperator, left, right)
		: resolveComparisonResult(path, op as ComparisonOperator, left, right);
}

// Two units conflict only when both are explicitly declared and differ. An
// undefined unit (a plain literal, almost always) is compatible with
// anything -- "close > 100" or "close - 5" must validate.
function unitsConflict(a: string | undefined, b: string | undefined): boolean {
	return a !== undefined && b !== undefined && a !== b;
}

function resolveArithmeticResult(
	path: string,
	op: ArithmeticOperator,
	left: Resolved,
	right: Resolved
): Resolved {
	if (left.resultType !== 'number' || right.resultType !== 'number') {
		throw ExpressionValidationError.typeMismatch(
			path,
			`arithmetic requires numeric operands; got "${left.resultType}" and "${right.resultType}".`,
			['number']
		);
	}
	let resultUnit: string | undefined;
	if (op === '+' || op === '-') {
		// A unitless operand (a literal threshold or offset, almost always) is
		// compatible with any unit -- only two *different, both-declared*
		// units conflict (e.g. currency vs shares).
		if (unitsConflict(left.resultUnit, right.resultUnit)) {
			throw ExpressionValidationError.unitMismatch(path, left.resultUnit, right.resultUnit);
		}
		resultUnit = left.resultUnit ?? right.resultUnit;
	} else {
		// '*' / '/': never rejected on unit grounds -- the result is a derived
		// quantity. Keep the one explicit unit if only one side declares one;
		// two (possibly equally) unitted operands produce an unlabeled ratio.
		resultUnit = left.resultUnit !== undefined && right.resultUnit === undefined
			? left.resultUnit
			: right.resultUnit !== undefined && left.resultUnit === undefined
				? right.resultUnit
				: undefined;
	}
	return {
		node: { kind: 'arithmetic', op, left: left.node, right: right.node },
		resultType: 'number',
		resultUnit
	};
}

function resolveComparisonResult(
	path: string,
	op: ComparisonOperator,
	left: Resolved,
	right: Resolved
): Resolved {
	if (left.resultType !== right.resultType) {
		throw ExpressionValidationError.typeMismatch(
			path,
			`comparison requires operands of the same type; got "${left.resultType}" and "${right.resultType}".`,
			[left.resultType]
		);
	}
	if (left.resultType === 'number' && unitsConflict(left.resultUnit, right.resultUnit)) {
		throw ExpressionValidationError.unitMismatch(path, left.resultUnit, right.resultUnit);
	}
	return {
		node: { kind: 'comparison', op, left: left.node, right: right.node },
		resultType: 'boolean',
		resultUnit: undefined
	};
}
