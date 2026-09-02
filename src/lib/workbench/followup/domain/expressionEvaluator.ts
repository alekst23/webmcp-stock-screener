// Evaluation semantics for an already-validated expression (T-1014-1 AC6).
// `validateExpression` normalizes every function_call's args/outputName
// onto the tree, so this walker needs no catalog registry and does no I/O
// -- it only asks the injected port for values.
//
// Missing data or a division by zero yields an explicit "not available" for
// that node (and everything built on it) rather than throwing or silently
// producing NaN/Infinity. Wiring a real, panel-data-backed context is
// T-1014-2's and the screener epic's concern -- this ticket defines the
// port and the pure walk over it.
import type { ExpressionNode, LiteralValue, ValidatedExpression } from './expressionModel';

// The port a caller supplies. `null` means "not available for this row":
// the field/function has no value here (missing history, insufficient
// lookback, unavailable data).
export interface ExpressionEvaluationContext {
	getFieldValue(fieldId: string): LiteralValue | null;
	getFunctionOutput(
		functionId: string,
		args: Readonly<Record<string, LiteralValue>>,
		outputName: string
	): LiteralValue | null;
}

export type EvaluatedValue = { available: true; value: LiteralValue } | { available: false };

const NOT_AVAILABLE: EvaluatedValue = { available: false };

export function evaluateExpression(
	expression: ValidatedExpression,
	ctx: ExpressionEvaluationContext
): EvaluatedValue {
	return evaluateNode(expression.node, ctx);
}

function evaluateNode(node: ExpressionNode, ctx: ExpressionEvaluationContext): EvaluatedValue {
	switch (node.kind) {
		case 'literal':
			return { available: true, value: node.value };
		case 'field_ref':
			return fromNullable(ctx.getFieldValue(node.fieldId));
		case 'function_call':
			return fromNullable(
				ctx.getFunctionOutput(node.functionId, node.args, node.outputName as string)
			);
		case 'arithmetic':
			return evaluateArithmetic(node.op, node.left, node.right, ctx);
		case 'comparison':
			return evaluateComparison(node.op, node.left, node.right, ctx);
	}
}

function fromNullable(value: LiteralValue | null): EvaluatedValue {
	return value === null ? NOT_AVAILABLE : { available: true, value };
}

function evaluateArithmetic(
	op: '+' | '-' | '*' | '/',
	leftNode: ExpressionNode,
	rightNode: ExpressionNode,
	ctx: ExpressionEvaluationContext
): EvaluatedValue {
	const left = evaluateNode(leftNode, ctx);
	const right = evaluateNode(rightNode, ctx);
	if (!left.available || !right.available) return NOT_AVAILABLE;
	// Validation guarantees both operands are numeric.
	const a = left.value as number;
	const b = right.value as number;
	if (op === '/' && b === 0) return NOT_AVAILABLE;
	if (op === '+') return { available: true, value: a + b };
	if (op === '-') return { available: true, value: a - b };
	if (op === '*') return { available: true, value: a * b };
	return { available: true, value: a / b };
}

function evaluateComparison(
	op: '>' | '<' | '>=' | '<=' | '==' | '!=',
	leftNode: ExpressionNode,
	rightNode: ExpressionNode,
	ctx: ExpressionEvaluationContext
): EvaluatedValue {
	const left = evaluateNode(leftNode, ctx);
	const right = evaluateNode(rightNode, ctx);
	if (!left.available || !right.available) return NOT_AVAILABLE;
	const a = left.value;
	const b = right.value;
	if (op === '==') return { available: true, value: a === b };
	if (op === '!=') return { available: true, value: a !== b };
	return { available: true, value: compareOrdered(op, a, b) };
}

type OrderingOperator = '>' | '<' | '>=' | '<=';

// Validation guarantees `a` and `b` share the same resultType. Dispatched
// by runtime type instead of a shared union parameter, so each branch stays
// a plain, honestly-typed number/number or string/string comparison rather
// than reaching for `any`.
function compareOrdered(op: OrderingOperator, a: LiteralValue, b: LiteralValue): boolean {
	if (typeof a === 'number' && typeof b === 'number') return numberOrder(op, a, b);
	if (typeof a === 'string' && typeof b === 'string') return stringOrder(op, a, b);
	// Booleans: ordered via numeric coercion, matching JS's own
	// false-before-true ordering.
	return numberOrder(op, Number(a), Number(b));
}

function numberOrder(op: OrderingOperator, a: number, b: number): boolean {
	if (op === '>') return a > b;
	if (op === '<') return a < b;
	if (op === '>=') return a >= b;
	return a <= b;
}

function stringOrder(op: OrderingOperator, a: string, b: string): boolean {
	if (op === '>') return a > b;
	if (op === '<') return a < b;
	if (op === '>=') return a >= b;
	return a <= b;
}
