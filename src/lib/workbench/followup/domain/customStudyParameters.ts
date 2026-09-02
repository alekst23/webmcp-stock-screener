// Declared-parameter machinery for a custom study (T-1014-2, AC3, AC4).
// Split out of customStudy.ts to keep each file within the project's size
// guidance -- this half owns node-path resolution, resolving a declared
// parameter into a CatalogParameter, and call-time override substitution;
// customStudy.ts owns the record's storage and catalog projection.
//
// T-1014-1's expression tree has no parameter-reference node kind (only
// literal/field_ref/function_call/arithmetic/comparison -- extending that
// model is out of this ticket's scope), so a declared parameter is modeled
// as a *binding* onto an already-validated tree: it names a function_call
// node (by the same dotted path expressionValidator.ts already uses for its
// own error messages) and one of that call's declared argument names.
// Overriding a parameter at call time rewrites the literal at that
// location; not overriding it leaves the value the author originally wrote,
// which is exactly what "default" means here.
//
// Domain layer: pure construction and tree rewriting. No I/O. Depends only
// on the published CatalogRegistry port and T-1014-1's expression model.
import type { CatalogRegistry } from '../../../catalog/registry';
import type { CatalogParameter, NumericRange } from '../../../catalog/types';
import type { CustomStudyRecord } from './customStudy';
import type { ExpressionNode, LiteralValue, ValidatedExpression } from './expressionModel';

export interface CustomStudyParameter {
	name: string;
	// Dotted path into the validated tree, expressionValidator.ts's own
	// grammar: "root", "root.left", "root.left.right", ...
	nodePath: string;
	// Must name a declared argument of the function_call node at nodePath.
	argName: string;
	// Must be a subset of the underlying argument's own declared range, when
	// both are present. Absent means "inherit the underlying argument's own
	// range" (or no bound, if it has none either).
	range?: NumericRange;
}

// ---------------------------------------------------------------------------
// Node-path resolution
// ---------------------------------------------------------------------------

// Walks "root"/"root.left"/"root.left.right"/... through arithmetic/
// comparison edges -- the only edges the expression model has. Returns null
// for an unresolvable path (wrong segment, or a path that runs past a leaf).
export function resolveNodeAtPath(node: ExpressionNode, path: string): ExpressionNode | null {
	const segments = path.split('.');
	if (segments[0] !== 'root') {
		return null;
	}
	let current: ExpressionNode = node;
	for (const segment of segments.slice(1)) {
		if (current.kind !== 'arithmetic' && current.kind !== 'comparison') {
			return null;
		}
		if (segment === 'left') {
			current = current.left;
		} else if (segment === 'right') {
			current = current.right;
		} else {
			return null;
		}
	}
	return current;
}

// Rebuilds the tree with the node at `path` replaced -- never mutates the
// input. Returns the original node unchanged when `path` does not resolve
// (callers are expected to have already validated it does).
function replaceNodeAtPath(
	node: ExpressionNode,
	path: string,
	replacement: ExpressionNode
): ExpressionNode {
	const segments = path.split('.');
	if (segments[0] !== 'root') {
		return node;
	}
	return replaceAlong(node, segments.slice(1), replacement);
}

function replaceAlong(
	node: ExpressionNode,
	remaining: string[],
	replacement: ExpressionNode
): ExpressionNode {
	if (remaining.length === 0) {
		return replacement;
	}
	if (node.kind !== 'arithmetic' && node.kind !== 'comparison') {
		return node;
	}
	const [segment, ...rest] = remaining;
	if (segment === 'left') {
		return { ...node, left: replaceAlong(node.left, rest, replacement) };
	}
	if (segment === 'right') {
		return { ...node, right: replaceAlong(node.right, rest, replacement) };
	}
	return node;
}

// ---------------------------------------------------------------------------
// Parameter declaration -> CatalogParameter (AC3, AC4)
// ---------------------------------------------------------------------------

export interface RawParameterDeclaration {
	name: string;
	nodePath: string;
	argName: string;
	range?: NumericRange;
}

export type ParameterDeclarationResult =
	| { ok: true; parameters: CustomStudyParameter[]; catalogParameters: CatalogParameter[] }
	| { ok: false; issues: string[] };

function isRangeSubset(inner: NumericRange | undefined, outer: NumericRange | undefined): boolean {
	if (!inner) {
		return true;
	}
	if (!outer) {
		return true;
	}
	const minOk = outer.min === undefined || (inner.min !== undefined && inner.min >= outer.min);
	const maxOk = outer.max === undefined || (inner.max !== undefined && inner.max <= outer.max);
	return minOk && maxOk;
}

function resolveOneDeclaration(
	declaration: RawParameterDeclaration,
	expression: ValidatedExpression,
	registry: CatalogRegistry
):
	| { ok: true; parameter: CustomStudyParameter; catalogParameter: CatalogParameter }
	| { ok: false; issue: string } {
	const target = resolveNodeAtPath(expression.node, declaration.nodePath);
	if (!target) {
		return {
			ok: false,
			issue:
				`parameter "${declaration.name}": nodePath "${declaration.nodePath}" does not resolve ` +
				`within the expression (valid paths descend via ".left"/".right" from "root").`
		};
	}
	if (target.kind !== 'function_call') {
		return {
			ok: false,
			issue:
				`parameter "${declaration.name}": nodePath "${declaration.nodePath}" resolves to a ` +
				`"${target.kind}" node, not a function_call -- only a function_call argument can be ` +
				'declared as a parameter.'
		};
	}
	const item = registry.getCatalogItem(target.functionId);
	const underlying =
		item && 'parameters' in item
			? item.parameters.find((p) => p.name === declaration.argName)
			: undefined;
	if (!underlying) {
		const permitted = item && 'parameters' in item ? item.parameters.map((p) => p.name) : [];
		return {
			ok: false,
			issue:
				`parameter "${declaration.name}": "${declaration.argName}" is not a declared argument of ` +
				`"${target.functionId}". Permitted: ${permitted.length > 0 ? permitted.join(', ') : '(none)'}.`
		};
	}
	if (!isRangeSubset(declaration.range, underlying.range)) {
		return {
			ok: false,
			issue:
				`parameter "${declaration.name}": declared range must fall within "${declaration.argName}"'s ` +
				`own range [${underlying.range?.min ?? '-Infinity'}, ${underlying.range?.max ?? 'Infinity'}].`
		};
	}
	const defaultValue = target.args[declaration.argName] as LiteralValue;
	return {
		ok: true,
		parameter: {
			name: declaration.name,
			nodePath: declaration.nodePath,
			argName: declaration.argName,
			range: declaration.range
		},
		catalogParameter: {
			name: declaration.name,
			valueType: underlying.valueType,
			unit: underlying.unit,
			defaultValue,
			range: declaration.range ?? underlying.range,
			enumValues: underlying.enumValues,
			required: false
		}
	};
}

// Resolves and validates every declared parameter against the already-
// validated expression (AC3), producing both the stored binding shape and
// the CatalogParameter[] the study's catalog projection reports (AC4).
// Names must be unique -- two parameters answering to the same name would
// make a study-output condition's `params` ambiguous.
export function resolveParameterDeclarations(
	declarations: readonly RawParameterDeclaration[],
	expression: ValidatedExpression,
	registry: CatalogRegistry
): ParameterDeclarationResult {
	const issues: string[] = [];
	const parameters: CustomStudyParameter[] = [];
	const catalogParameters: CatalogParameter[] = [];
	const seenNames = new Set<string>();
	for (const declaration of declarations) {
		if (seenNames.has(declaration.name)) {
			issues.push(`parameter "${declaration.name}" is declared more than once.`);
			continue;
		}
		seenNames.add(declaration.name);
		const resolved = resolveOneDeclaration(declaration, expression, registry);
		if (!resolved.ok) {
			issues.push(resolved.issue);
			continue;
		}
		parameters.push(resolved.parameter);
		catalogParameters.push(resolved.catalogParameter);
	}
	return issues.length > 0 ? { ok: false, issues } : { ok: true, parameters, catalogParameters };
}

// ---------------------------------------------------------------------------
// Call-time override substitution
// ---------------------------------------------------------------------------

export type OverrideResult = { ok: true; node: ExpressionNode } | { ok: false; issues: string[] };

function overrideMatchesDeclaredType(value: unknown, catalogParameter: CatalogParameter): boolean {
	if (catalogParameter.valueType === 'number')
		return typeof value === 'number' && Number.isFinite(value);
	if (catalogParameter.valueType === 'boolean') return typeof value === 'boolean';
	if (catalogParameter.valueType === 'enum') {
		return typeof value === 'string' && (catalogParameter.enumValues?.includes(value) ?? false);
	}
	return typeof value === 'string';
}

// Rewrites the validated tree with `overrides` substituted at each
// declared parameter's location (a name absent from `overrides` keeps the
// author's own default). Returns issues rather than throwing when an
// override is out of range or the wrong type -- the same discipline
// expressionValidator.ts uses for authoring-time input.
export function resolveCustomStudyExpression(
	study: CustomStudyRecord,
	overrides: Readonly<Record<string, LiteralValue>>
): OverrideResult {
	const issues: string[] = [];
	let node = study.expression.node;
	for (const parameter of study.parameters) {
		if (!(parameter.name in overrides)) {
			continue;
		}
		const catalogParameter = study.catalogParameters.find((p) => p.name === parameter.name);
		const value = overrides[parameter.name] as LiteralValue;
		if (!catalogParameter || !overrideMatchesDeclaredType(value, catalogParameter)) {
			issues.push(`parameter "${parameter.name}": value does not match its declared type.`);
			continue;
		}
		if (
			typeof value === 'number' &&
			catalogParameter.range &&
			((catalogParameter.range.min !== undefined && value < catalogParameter.range.min) ||
				(catalogParameter.range.max !== undefined && value > catalogParameter.range.max))
		) {
			issues.push(`parameter "${parameter.name}": ${value} is outside its declared range.`);
			continue;
		}
		const target = resolveNodeAtPath(node, parameter.nodePath);
		if (!target || target.kind !== 'function_call') {
			continue; // unreachable given create-time validation; skip defensively
		}
		const replacement = { ...target, args: { ...target.args, [parameter.argName]: value } };
		node = replaceNodeAtPath(node, parameter.nodePath, replacement);
	}
	return issues.length > 0 ? { ok: false, issues } : { ok: true, node };
}
