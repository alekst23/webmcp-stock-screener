// Projects a pinned run's full match set through a results-table
// configuration (T-1010-1): resolves each configured display and computed
// column's value, sorts with a deterministic tie-break, and attaches a
// group value -- all across the *complete* result set, before any page is
// cut (spec.md "computed columns and sort are evaluated ... across the full
// result set of the pinned run before paging", AC3). T-1010-4's use case
// consumes this; it does not redefine any of it.
//
// Domain layer: no I/O, no dependency on PinnedRunStore or ResultsReader.
// Builds on domain/page.ts's ResultRow rather than redefining row identity.

import type { ResourceId } from '../../workbench/domain/ids';
import { toWireProvenance, type MarketDataProvenance } from '../../workbench/domain/provenance';
import type { ScreenerMatch, ScreenerRun } from '../../screener/run';
import { buildRow, toWireResultRow, type ResultRow, type TickerResolver } from './page';
import {
	PERMITTED_FUNCTIONS,
	parseExpression,
	type ColumnIdentity,
	type ExpressionNode,
	type ResultsTableConfig,
	type SortDirection,
	type SortSpec
} from './tableConfig';

export type ColumnValue = number | string | boolean | null;

export interface ProjectedRow extends ResultRow {
	// Keyed by DisplayColumn.id -- one entry per configured display column,
	// evaluated against this row's match data.
	columns: Record<ResourceId, ColumnValue>;
	// The configured GroupSpec key's resolved value, or null when no
	// grouping is configured (AC4). Carried per row so a consumer renders
	// groups without re-deriving them from raw match data.
	groupValue: ColumnValue;
}

export interface ProjectedResultsPage {
	runId: ResourceId;
	rows: ProjectedRow[];
	total: number;
	offset: number;
	pageSize: number;
	nextCursor: string | null;
	provenance: MarketDataProvenance;
	grouped: boolean;
}

// The fallback for a run with no results-table configuration yet: no extra
// display or computed columns, no sort (keeps the run's own rank order,
// already deterministic), no grouping. Behaviorally identical to T-1010-2's
// un-projected page -- "a documented default column set" is the base
// identity columns every ResultRow already carries, nothing added.
export function defaultResultsTableConfig(): ResultsTableConfig {
	return {
		columns: [],
		computedColumns: [],
		sort: null,
		grouping: null,
		formattingRules: [],
		pageSize: null,
		chartPanelId: null
	};
}

// ---------------------------------------------------------------------------
// Expression evaluation
// ---------------------------------------------------------------------------

const PERMITTED_FUNCTION_SET: ReadonlySet<string> = new Set(PERMITTED_FUNCTIONS);

type FieldGetter = (fieldId: string) => number | null;

// Any null operand makes the whole expression null -- an honest "could not
// compute", never a fabricated 0. Division and modulo by zero are treated
// the same way rather than producing Infinity/NaN on the wire.
export function evaluateExpression(node: ExpressionNode, getField: FieldGetter): number | null {
	switch (node.type) {
		case 'number':
			return node.value;
		case 'field':
			return getField(node.fieldId);
		case 'unary': {
			const operand = evaluateExpression(node.operand, getField);
			return operand === null ? null : -operand;
		}
		case 'binary':
			return evaluateBinary(node.op, node.left, node.right, getField);
		case 'call': {
			const args = node.args.map((arg) => evaluateExpression(arg, getField));
			return args.some((arg) => arg === null)
				? null
				: evaluateFunction(node.name, args as number[]);
		}
	}
}

function evaluateBinary(
	op: '+' | '-' | '*' | '/' | '%' | '^',
	leftNode: ExpressionNode,
	rightNode: ExpressionNode,
	getField: FieldGetter
): number | null {
	const left = evaluateExpression(leftNode, getField);
	const right = evaluateExpression(rightNode, getField);
	if (left === null || right === null) {
		return null;
	}
	switch (op) {
		case '+':
			return left + right;
		case '-':
			return left - right;
		case '*':
			return left * right;
		case '/':
			return right === 0 ? null : left / right;
		case '%':
			return right === 0 ? null : left % right;
		case '^':
			return Math.pow(left, right);
	}
}

// Guarded against PERMITTED_FUNCTIONS even though tableConfig.ts's
// validation already rejects any other name upstream -- defense in depth
// for a config that reaches this layer unvalidated.
function evaluateFunction(name: string, args: number[]): number | null {
	if (!PERMITTED_FUNCTION_SET.has(name)) {
		return null;
	}
	const [first] = args;
	switch (name) {
		case 'abs':
			return first === undefined ? null : Math.abs(first);
		case 'sqrt':
			return first === undefined ? null : Math.sqrt(first);
		case 'round':
			return first === undefined ? null : Math.round(first);
		case 'ln':
			return first === undefined || first <= 0 ? null : Math.log(first);
		case 'log':
			return first === undefined || first <= 0 ? null : Math.log10(first);
		case 'max':
			return args.length === 0 ? null : Math.max(...args);
		case 'min':
			return args.length === 0 ? null : Math.min(...args);
		case 'sum':
			return args.length === 0 ? null : args.reduce((a, b) => a + b, 0);
		case 'avg':
			return args.length === 0 ? null : args.reduce((a, b) => a + b, 0) / args.length;
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// Column identity resolution
// ---------------------------------------------------------------------------

interface RowContext {
	match: ScreenerMatch;
	row: ResultRow;
	computedValues: Map<ResourceId, ColumnValue>;
}

function fieldGetterFor(match: ScreenerMatch): FieldGetter {
	return (fieldId) => match.rankingValues[fieldId] ?? null;
}

// Known gap, documented rather than papered over: ScreenerMatch only carries
// field data for fields actually used in ranking (rankingValues). A
// catalog_field column referencing a field outside that set resolves to
// null -- an honest absence, matching this area's existing convention
// (e.g. resultsReader.ts's ticker resolver), not a fabricated value.
function resolveIdentityValue(identity: ColumnIdentity, ctx: RowContext): ColumnValue {
	if (identity.source === 'result_id') {
		return ctx.row.resultId;
	}
	if (identity.source === 'catalog_field') {
		return ctx.match.rankingValues[identity.fieldId] ?? null;
	}
	return ctx.computedValues.get(identity.computedColumnId) ?? null;
}

// result_id's tie-break value is the row's numeric rank, not the result_id
// string. result_id is `result_<runId>_<rank>` (ids.ts's mintId grammar);
// lexicographic comparison of that is not monotonic in rank once rank
// reaches two digits ("...10" sorts before "...9"). Rank is a bijective,
// monotonic surrogate for result_id within one run, so comparing by rank
// *is* the correct implementation of "tie-break by result_id".
function valueForCompare(identity: ColumnIdentity, ctx: RowContext): ColumnValue {
	return identity.source === 'result_id' ? ctx.row.rank : resolveIdentityValue(identity, ctx);
}

// Nulls sort after any non-null value under both directions -- missing data
// at the bottom, regardless of ascending/descending -- consistent with this
// area's "honest absence" stance rather than treating null as the lowest
// possible value.
function compareValues(a: ColumnValue, b: ColumnValue, direction: SortDirection): number {
	if (a === null && b === null) {
		return 0;
	}
	if (a === null) {
		return 1;
	}
	if (b === null) {
		return -1;
	}
	let cmp: number;
	if (typeof a === 'number' && typeof b === 'number') {
		cmp = a - b;
	} else if (typeof a === 'boolean' && typeof b === 'boolean') {
		cmp = a === b ? 0 : a ? 1 : -1;
	} else {
		cmp = String(a).localeCompare(String(b));
	}
	return direction === 'asc' ? cmp : -cmp;
}

// Defaults mirror validateResultsTableConfig's own normalization, repeated
// defensively here in case an unvalidated config reaches this layer.
function makeComparator(sort: SortSpec): (a: RowContext, b: RowContext) => number {
	const tieBreak = sort.tieBreak ?? { source: 'result_id' as const };
	const tieBreakDirection = sort.tieBreakDirection ?? 'asc';
	return (a, b) => {
		const primary = compareValues(
			valueForCompare(sort.key, a),
			valueForCompare(sort.key, b),
			sort.direction
		);
		if (primary !== 0) {
			return primary;
		}
		return compareValues(
			valueForCompare(tieBreak, a),
			valueForCompare(tieBreak, b),
			tieBreakDirection
		);
	};
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

// Builds the full, sorted, grouped, column-projected row set for a run
// (AC2, AC3, AC4). Callers slice the returned array into a page -- this
// function never bounds its own output, since the whole point is that
// sorting happens before any page is cut.
export function projectResultRows(
	run: ScreenerRun,
	config: ResultsTableConfig,
	resolveTicker: TickerResolver
): ProjectedRow[] {
	// Parse each computed column's expression once, not once per row.
	const computedAsts = new Map<ResourceId, ExpressionNode | null>();
	for (const column of config.computedColumns) {
		const parsed = parseExpression(column.expression);
		computedAsts.set(column.id, parsed.ok ? parsed.ast : null);
	}

	const contexts: RowContext[] = run.matches.map((match) => {
		const row = buildRow(run.runId, match, resolveTicker);
		const getField = fieldGetterFor(match);
		const computedValues = new Map<ResourceId, ColumnValue>();
		for (const column of config.computedColumns) {
			const ast = computedAsts.get(column.id) ?? null;
			computedValues.set(column.id, ast ? evaluateExpression(ast, getField) : null);
		}
		return { match, row, computedValues };
	});

	if (config.sort) {
		contexts.sort(makeComparator(config.sort));
	}

	return contexts.map((ctx) => {
		const columns: Record<ResourceId, ColumnValue> = {};
		for (const displayColumn of config.columns) {
			columns[displayColumn.id] = resolveIdentityValue(displayColumn.identity, ctx);
		}
		const groupValue = config.grouping ? resolveIdentityValue(config.grouping.key, ctx) : null;
		return { ...ctx.row, columns, groupValue };
	});
}

// ---------------------------------------------------------------------------
// Wire serialization
// ---------------------------------------------------------------------------

export function toWireProjectedRow(row: ProjectedRow): Record<string, unknown> {
	return {
		...toWireResultRow(row),
		columns: row.columns,
		group_value: row.groupValue
	};
}

export function toWireProjectedResultsPage(page: ProjectedResultsPage): Record<string, unknown> {
	return {
		run_id: page.runId,
		rows: page.rows.map(toWireProjectedRow),
		total: page.total,
		offset: page.offset,
		page_size: page.pageSize,
		next_cursor: page.nextCursor,
		provenance: toWireProvenance(page.provenance),
		grouped: page.grouped
	};
}
