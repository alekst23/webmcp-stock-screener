// The typed expression tree computed fields and custom studies are authored
// as (T-1014-1). A calculation arrives as a tree of these five node kinds --
// never as a string -- so there is no code path in which an agent's text
// becomes something the app parses or executes. See
// docs/design/screener-followup-tools/spec.md's "Author a computed field"
// and "Author a custom study" scenarios.
//
// Domain layer: types only, no I/O, no imports from src/lib/webmcp/.
import type { CatalogValueType } from '../../../catalog/types';

export type LiteralValueType = 'number' | 'string' | 'boolean';
export type LiteralValue = number | string | boolean;

export const LITERAL_VALUE_TYPES: readonly LiteralValueType[] = ['number', 'string', 'boolean'];

export type ArithmeticOperator = '+' | '-' | '*' | '/';
export const ARITHMETIC_OPERATORS: readonly ArithmeticOperator[] = ['+', '-', '*', '/'];

export type ComparisonOperator = '>' | '<' | '>=' | '<=' | '==' | '!=';
export const COMPARISON_OPERATORS: readonly ComparisonOperator[] = [
	'>',
	'<',
	'>=',
	'<=',
	'==',
	'!='
];

// A literal value. Inert data -- a string literal is never parsed,
// concatenated into a query, or handed to an interpreter; it is only ever
// compared or passed as a catalog function's argument value.
export interface LiteralNode {
	kind: 'literal';
	valueType: LiteralValueType;
	value: LiteralValue;
}

// A reference to a catalog field. `fieldId` is only ever used as a
// `CatalogRegistry.getCatalogItem` lookup key -- never interpreted.
export interface FieldRefNode {
	kind: 'field_ref';
	fieldId: string;
}

// A call to a catalog study/indicator/pattern. `functionId`, `outputName`
// and every key of `args` are only ever used as lookup keys against the
// resolved catalog item's declared `parameters`/`outputs`. Argument values
// are literal data, checked against the declared type/range/enum -- never
// executed. `outputName` is optional on input (filled in by validation when
// the function has exactly one output) but always present once validated.
export interface FunctionCallNode {
	kind: 'function_call';
	functionId: string;
	args: Readonly<Record<string, LiteralValue>>;
	outputName?: string;
}

// Arithmetic and comparison operators are intrinsic node shapes, not catalog
// lookups: the tool spec's `op.*` catalog operators are a separate concept
// used by `edit_filter_tree`'s condition editor, not by this expression tree.
export interface ArithmeticNode {
	kind: 'arithmetic';
	op: ArithmeticOperator;
	left: ExpressionNode;
	right: ExpressionNode;
}

export interface ComparisonNode {
	kind: 'comparison';
	op: ComparisonOperator;
	left: ExpressionNode;
	right: ExpressionNode;
}

// Closed union: exactly these five shapes. No variant holds free-form text
// meant to be parsed or interpreted -- see expressionValidator.ts, whose job
// is to prove an arbitrary JSON payload is actually one of these shapes
// before anything downstream touches it.
export type ExpressionNode =
	| LiteralNode
	| FieldRefNode
	| FunctionCallNode
	| ArithmeticNode
	| ComparisonNode;

export const EXPRESSION_NODE_KINDS: readonly ExpressionNode['kind'][] = [
	'literal',
	'field_ref',
	'function_call',
	'arithmetic',
	'comparison'
];

// What a validated expression is usable for: a numeric results column, a
// boolean filter operand, or neither (a string/date/enum-typed result).
export type ExpressionUsage = 'numeric_column' | 'boolean_filter' | 'none';

export function usageForResultType(resultType: CatalogValueType): ExpressionUsage {
	if (resultType === 'number') return 'numeric_column';
	if (resultType === 'boolean') return 'boolean_filter';
	return 'none';
}

// What `validateExpression` returns on success (AC7). `node` is the
// original tree with every `function_call`'s `args`/`outputName` normalized
// (defaults filled, output resolved) so the evaluator never needs the
// catalog registry.
export interface ValidatedExpression {
	node: ExpressionNode;
	resultType: CatalogValueType;
	resultUnit?: string;
	usage: ExpressionUsage;
}
