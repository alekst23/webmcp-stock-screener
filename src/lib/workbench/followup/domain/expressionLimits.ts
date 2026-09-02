// Configurable cost bounds for the typed expression validator (T-1014-1
// AC5), so limits are named constants a caller can override rather than
// magic numbers scattered through expressionValidator.ts.
export interface ExpressionCostLimits {
	// Maximum nesting depth of arithmetic/comparison operators.
	maxDepth: number;
	// Maximum total node count across the whole tree.
	maxNodes: number;
	// Maximum value for any catalog function parameter whose declared unit
	// is 'bars' (e.g. a moving-average length) -- bounds how much history a
	// single expression can demand.
	maxLookbackBars: number;
}

// 500 matches the widest `range.max` already declared on the catalog's
// shared LENGTH_PARAM (src/lib/catalog/items.ts), so the default never
// clips a built-in study's own declared range.
export const DEFAULT_EXPRESSION_LIMITS: ExpressionCostLimits = {
	maxDepth: 8,
	maxNodes: 64,
	maxLookbackBars: 500
};
