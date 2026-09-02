// Results table configuration domain model and validation (T-1010-1). How a
// `results_table` panel presents a screener run: displayed columns, computed
// columns, sort, grouping, conditional formatting, page size, and the chart
// panel it's bound to. Pure domain logic -- no I/O, no dependency on a run,
// no import from src/lib/webmcp/. The use cases in Wave 2 (T-1010-4,
// T-1010-6) apply this to actual result rows and to a workspace revision.
//
// Every column and rule is addressed by a stable ID (`ResourceId`, kind
// `column`/`rule`), never by a positional index -- see
// docs/reference/tool-spec.md's stable-ID rule.
import type { CatalogRegistry } from '../../catalog/registry';
import type { CatalogValueType } from '../../catalog/types';
import { parseId, type ResourceId } from '../../workbench/domain/ids';

// ---------------------------------------------------------------------------
// Constants (Open Question 4's assumption: default 25, hard max 200)
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

// A fixed, domain-owned function vocabulary -- not catalog-dependent, since
// these are math operations rather than data fields. Kept small on purpose;
// grow it only when a real computed-column need shows up.
export const PERMITTED_FUNCTIONS: readonly string[] = Object.freeze([
	'abs',
	'avg',
	'ln',
	'log',
	'max',
	'min',
	'round',
	'sqrt',
	'sum'
]);
const PERMITTED_FUNCTION_SET: ReadonlySet<string> = new Set(PERMITTED_FUNCTIONS);

// ---------------------------------------------------------------------------
// Column identity, columns, sort, grouping, formatting
// ---------------------------------------------------------------------------

// What data backs a column or a sort/grouping key. `result_id` is synthetic
// and always resolvable -- it is the default deterministic tie-break (AC1)
// and never needs catalog lookup or display.
export type ColumnIdentity =
	| { source: 'catalog_field'; fieldId: string }
	| { source: 'computed_column'; computedColumnId: ResourceId }
	| { source: 'result_id' };

export interface ComputedColumn {
	id: ResourceId;
	label: string;
	unit?: string;
	valueType: CatalogValueType;
	// Formula source, e.g. "volume / sma(volume, 20)". Parsed and validated
	// against the injected catalog's numeric fields and PERMITTED_FUNCTIONS.
	expression: string;
}

export interface DisplayColumn {
	id: ResourceId;
	identity: ColumnIdentity;
	label: string;
	unit?: string;
	valueType: CatalogValueType;
}

export type SortDirection = 'asc' | 'desc';

export interface SortSpec {
	key: ColumnIdentity;
	direction: SortDirection;
	// Defaults to { source: 'result_id' } when omitted -- the sort is always
	// deterministic (AC1) regardless of what the caller supplies.
	tieBreak?: ColumnIdentity;
	tieBreakDirection?: SortDirection;
}

export interface GroupSpec {
	key: ColumnIdentity;
}

export type FormattingComparator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'ne';

export interface FormattingPredicate {
	// Must match a DisplayColumn.id in the same configuration's `columns`
	// (AC7) -- unlike a sort/grouping key, an identity that isn't currently
	// displayed is not enough.
	columnId: ResourceId;
	comparator: FormattingComparator;
	value: number | string | boolean;
}

export interface FormattingStyle {
	backgroundColor?: string;
	textColor?: string;
	icon?: string;
}

export interface FormattingRule {
	id: ResourceId;
	predicate: FormattingPredicate;
	style: FormattingStyle;
}

export interface ResultsTableConfig {
	columns: DisplayColumn[];
	computedColumns: ComputedColumn[];
	sort: SortSpec | null;
	grouping: GroupSpec | null;
	formattingRules: FormattingRule[];
	// null/undefined resolves to DEFAULT_PAGE_SIZE on successful validation.
	pageSize: number | null;
	chartPanelId: ResourceId | null;
}

// ---------------------------------------------------------------------------
// Expression parsing (AC3)
// ---------------------------------------------------------------------------

export type ExpressionNode =
	| { type: 'number'; value: number }
	| { type: 'field'; fieldId: string }
	| { type: 'call'; name: string; args: ExpressionNode[] }
	| {
			type: 'binary';
			op: '+' | '-' | '*' | '/' | '%' | '^';
			left: ExpressionNode;
			right: ExpressionNode;
	  }
	| { type: 'unary'; op: '-'; operand: ExpressionNode };

export type ExpressionParseResult =
	{ ok: true; ast: ExpressionNode } | { ok: false; error: string };

type TokenType = 'number' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof';

interface Token {
	type: TokenType;
	text: string;
	pos: number;
}

const IDENT_START = /[a-zA-Z_]/;
const IDENT_PART = /[a-zA-Z0-9_.]/;
const DIGIT = /[0-9]/;
const OPERATORS = new Set(['+', '-', '*', '/', '%', '^']);

function tokenize(source: string): Token[] | { error: string } {
	const tokens: Token[] = [];
	let i = 0;
	while (i < source.length) {
		const ch = source[i];
		if (ch === undefined) {
			break;
		}
		if (/\s/.test(ch)) {
			i += 1;
			continue;
		}
		if (ch === '(') {
			tokens.push({ type: 'lparen', text: ch, pos: i });
			i += 1;
			continue;
		}
		if (ch === ')') {
			tokens.push({ type: 'rparen', text: ch, pos: i });
			i += 1;
			continue;
		}
		if (ch === ',') {
			tokens.push({ type: 'comma', text: ch, pos: i });
			i += 1;
			continue;
		}
		if (OPERATORS.has(ch)) {
			tokens.push({ type: 'op', text: ch, pos: i });
			i += 1;
			continue;
		}
		if (DIGIT.test(ch)) {
			const start = i;
			while (i < source.length && (DIGIT.test(source[i] ?? '') || source[i] === '.')) {
				i += 1;
			}
			tokens.push({ type: 'number', text: source.slice(start, i), pos: start });
			continue;
		}
		if (IDENT_START.test(ch)) {
			const start = i;
			while (i < source.length && IDENT_PART.test(source[i] ?? '')) {
				i += 1;
			}
			tokens.push({ type: 'ident', text: source.slice(start, i), pos: start });
			continue;
		}
		return { error: `Unexpected character "${ch}" at position ${i}.` };
	}
	tokens.push({ type: 'eof', text: '', pos: source.length });
	return tokens;
}

class Parser {
	private tokens: Token[];
	private index = 0;

	constructor(tokens: Token[]) {
		this.tokens = tokens;
	}

	private peek(): Token {
		const token = this.tokens[this.index];
		if (!token) {
			throw new Error('Parser ran past its own token stream -- this is a parser bug.');
		}
		return token;
	}

	private advance(): Token {
		const token = this.peek();
		this.index += 1;
		return token;
	}

	parseExpression(): ExpressionNode {
		let left = this.parseTerm();
		while (this.peek().type === 'op' && (this.peek().text === '+' || this.peek().text === '-')) {
			const op = this.advance().text as '+' | '-';
			const right = this.parseTerm();
			left = { type: 'binary', op, left, right };
		}
		return left;
	}

	private parseTerm(): ExpressionNode {
		let left = this.parsePower();
		while (
			this.peek().type === 'op' &&
			(this.peek().text === '*' || this.peek().text === '/' || this.peek().text === '%')
		) {
			const op = this.advance().text as '*' | '/' | '%';
			const right = this.parsePower();
			left = { type: 'binary', op, left, right };
		}
		return left;
	}

	private parsePower(): ExpressionNode {
		const left = this.parseUnary();
		if (this.peek().type === 'op' && this.peek().text === '^') {
			this.advance();
			const right = this.parsePower();
			return { type: 'binary', op: '^', left, right };
		}
		return left;
	}

	private parseUnary(): ExpressionNode {
		if (this.peek().type === 'op' && this.peek().text === '-') {
			this.advance();
			return { type: 'unary', op: '-', operand: this.parseUnary() };
		}
		return this.parsePrimary();
	}

	private parsePrimary(): ExpressionNode {
		const token = this.peek();
		if (token.type === 'number') {
			this.advance();
			const value = Number(token.text);
			if (!Number.isFinite(value)) {
				throw new ParseError(`"${token.text}" at position ${token.pos} is not a valid number.`);
			}
			return { type: 'number', value };
		}
		if (token.type === 'ident') {
			this.advance();
			if (this.peek().type === 'lparen') {
				return this.parseCall(token.text);
			}
			return { type: 'field', fieldId: token.text };
		}
		if (token.type === 'lparen') {
			this.advance();
			const inner = this.parseExpression();
			if (this.peek().type !== 'rparen') {
				throw new ParseError(`Expected ")" at position ${this.peek().pos}.`);
			}
			this.advance();
			return inner;
		}
		if (token.type === 'eof') {
			throw new ParseError('Unexpected end of expression.');
		}
		throw new ParseError(`Unexpected token "${token.text}" at position ${token.pos}.`);
	}

	private parseCall(name: string): ExpressionNode {
		this.advance(); // consume '('
		const args: ExpressionNode[] = [];
		if (this.peek().type !== 'rparen') {
			args.push(this.parseExpression());
			while (this.peek().type === 'comma') {
				this.advance();
				args.push(this.parseExpression());
			}
		}
		if (this.peek().type !== 'rparen') {
			throw new ParseError(
				`Expected ")" to close call to "${name}" at position ${this.peek().pos}.`
			);
		}
		this.advance();
		return { type: 'call', name, args };
	}

	finish(): void {
		if (this.peek().type !== 'eof') {
			throw new ParseError(`Unexpected trailing input at position ${this.peek().pos}.`);
		}
	}
}

class ParseError extends Error {}

// Never throws: a malformed expression comes back as `{ ok: false, error }`.
export function parseExpression(source: string): ExpressionParseResult {
	const trimmed = source.trim();
	if (trimmed === '') {
		return { ok: false, error: 'Expression must not be empty.' };
	}
	const tokens = tokenize(trimmed);
	if (!Array.isArray(tokens)) {
		return { ok: false, error: tokens.error };
	}
	const parser = new Parser(tokens);
	try {
		const ast = parser.parseExpression();
		parser.finish();
		return { ok: true, ast };
	} catch (e) {
		if (e instanceof ParseError) {
			return { ok: false, error: e.message };
		}
		throw e;
	}
}

interface ExpressionReferences {
	fieldIds: string[];
	functionNames: string[];
}

function collectReferences(node: ExpressionNode, out: ExpressionReferences): void {
	switch (node.type) {
		case 'number':
			return;
		case 'field':
			out.fieldIds.push(node.fieldId);
			return;
		case 'call':
			out.functionNames.push(node.name);
			for (const arg of node.args) {
				collectReferences(arg, out);
			}
			return;
		case 'binary':
			collectReferences(node.left, out);
			collectReferences(node.right, out);
			return;
		case 'unary':
			collectReferences(node.operand, out);
			return;
	}
}

// ---------------------------------------------------------------------------
// Validation result shapes (AC9: rejections block, warnings don't)
// ---------------------------------------------------------------------------

export interface ResultsTableRejection {
	code: string;
	message: string;
	elementId?: string;
}

export interface ResultsTableWarning {
	code: string;
	message: string;
	elementId?: string;
}

export type ResultsTableValidationResult =
	| { ok: true; config: ResultsTableConfig; warnings: ResultsTableWarning[] }
	| { ok: false; rejections: ResultsTableRejection[] };

function rejection(code: string, message: string, elementId?: string): ResultsTableRejection {
	return { code, message, elementId };
}

function warning(code: string, message: string, elementId?: string): ResultsTableWarning {
	return { code, message, elementId };
}

function permittedFieldIds(catalog: CatalogRegistry): string[] {
	return catalog
		.listCatalogItems('field')
		.filter((item) => item.kind === 'field' && item.valueType === 'number')
		.map((item) => item.id)
		.sort();
}

function permittedListsMessage(catalog: CatalogRegistry): string {
	const fields = permittedFieldIds(catalog);
	return (
		`Permitted fields: ${fields.length > 0 ? fields.join(', ') : '(none available)'}. ` +
		`Permitted functions: ${PERMITTED_FUNCTIONS.join(', ')}.`
	);
}

function validateComputedColumn(
	column: ComputedColumn,
	catalog: CatalogRegistry
): ResultsTableRejection[] {
	const parsed = parseExpression(column.expression);
	if (!parsed.ok) {
		return [
			rejection(
				'computed_column_parse_error',
				`Computed column "${column.id}" failed to parse: ${parsed.error} ${permittedListsMessage(catalog)}`,
				column.id
			)
		];
	}
	const refs: ExpressionReferences = { fieldIds: [], functionNames: [] };
	collectReferences(parsed.ast, refs);

	const rejections: ResultsTableRejection[] = [];
	for (const fieldId of refs.fieldIds) {
		const item = catalog.getCatalogItem(fieldId);
		const permitted = item !== undefined && item.kind === 'field' && item.valueType === 'number';
		if (!permitted) {
			rejections.push(
				rejection(
					'computed_column_disallowed_field',
					`Computed column "${column.id}" references field "${fieldId}", which is not a permitted numeric catalog field. ${permittedListsMessage(catalog)}`,
					column.id
				)
			);
		}
	}
	for (const name of refs.functionNames) {
		if (!PERMITTED_FUNCTION_SET.has(name)) {
			rejections.push(
				rejection(
					'computed_column_disallowed_function',
					`Computed column "${column.id}" calls function "${name}", which is not permitted. ${permittedListsMessage(catalog)}`,
					column.id
				)
			);
		}
	}
	return rejections;
}

function findDuplicateIds(ids: string[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) {
			duplicates.add(id);
		}
		seen.add(id);
	}
	return [...duplicates];
}

interface IdentityResolution {
	// Whether the identity names something the catalog/config actually knows
	// about at all (an unknown catalog field or computed column id).
	known: boolean;
	// Whether the identity is backed by an entry in `columns` (irrelevant --
	// always true -- for 'result_id').
	visible: boolean;
}

function resolveIdentity(
	identity: ColumnIdentity,
	config: ResultsTableConfig,
	catalog: CatalogRegistry
): IdentityResolution {
	if (identity.source === 'result_id') {
		return { known: true, visible: true };
	}
	if (identity.source === 'catalog_field') {
		const item = catalog.getCatalogItem(identity.fieldId);
		const known = item !== undefined && item.kind === 'field';
		const visible = config.columns.some(
			(c) => c.identity.source === 'catalog_field' && c.identity.fieldId === identity.fieldId
		);
		return { known, visible };
	}
	const known = config.computedColumns.some((c) => c.id === identity.computedColumnId);
	const visible = config.columns.some(
		(c) =>
			c.identity.source === 'computed_column' &&
			c.identity.computedColumnId === identity.computedColumnId
	);
	return { known, visible };
}

function describeIdentity(identity: ColumnIdentity): string {
	if (identity.source === 'catalog_field') {
		return `field "${identity.fieldId}"`;
	}
	if (identity.source === 'computed_column') {
		return `computed column "${identity.computedColumnId}"`;
	}
	return 'the result id';
}

function validateDisplayColumns(
	config: ResultsTableConfig,
	catalog: CatalogRegistry
): ResultsTableRejection[] {
	const rejections: ResultsTableRejection[] = [];
	for (const id of findDuplicateIds(config.columns.map((c) => c.id))) {
		rejections.push(
			rejection('duplicate_column_id', `Column id "${id}" is used more than once.`, id)
		);
	}
	for (const column of config.columns) {
		const identity = column.identity;
		if (identity.source === 'catalog_field') {
			const item = catalog.getCatalogItem(identity.fieldId);
			if (!item || item.kind !== 'field') {
				rejections.push(
					rejection(
						'unknown_catalog_field',
						`Column "${column.id}" references unknown catalog field "${identity.fieldId}".`,
						identity.fieldId
					)
				);
			}
		} else if (identity.source === 'computed_column') {
			const exists = config.computedColumns.some((c) => c.id === identity.computedColumnId);
			if (!exists) {
				rejections.push(
					rejection(
						'unknown_computed_column',
						`Column "${column.id}" references unknown computed column "${identity.computedColumnId}".`,
						identity.computedColumnId
					)
				);
			}
		}
	}
	return rejections;
}

function validateSortOrGroupKey(
	kind: 'sort' | 'grouping',
	identity: ColumnIdentity,
	config: ResultsTableConfig,
	catalog: CatalogRegistry
): { rejections: ResultsTableRejection[]; warnings: ResultsTableWarning[] } {
	const resolution = resolveIdentity(identity, config, catalog);
	if (!resolution.known) {
		return {
			rejections: [
				rejection(
					'unknown_catalog_field',
					`${kind === 'sort' ? 'Sort' : 'Grouping'} key ${describeIdentity(identity)} is not a known catalog field or computed column.`,
					identity.source === 'catalog_field'
						? identity.fieldId
						: identity.source === 'computed_column'
							? identity.computedColumnId
							: undefined
				)
			],
			warnings: []
		};
	}
	if (!resolution.visible) {
		return {
			rejections: [],
			warnings: [
				warning(
					`${kind}_key_not_visible`,
					`${kind === 'sort' ? 'Sort' : 'Grouping'} key ${describeIdentity(identity)} is not among the displayed columns.`
				)
			]
		};
	}
	return { rejections: [], warnings: [] };
}

function validateFormattingRules(config: ResultsTableConfig): ResultsTableRejection[] {
	const rejections: ResultsTableRejection[] = [];
	for (const id of findDuplicateIds(config.formattingRules.map((r) => r.id))) {
		rejections.push(
			rejection('duplicate_rule_id', `Formatting rule id "${id}" is used more than once.`, id)
		);
	}
	for (const rule of config.formattingRules) {
		const columnExists = config.columns.some((c) => c.id === rule.predicate.columnId);
		if (!columnExists) {
			rejections.push(
				rejection(
					'formatting_rule_unknown_column',
					`Formatting rule "${rule.id}" references column "${rule.predicate.columnId}", which is not part of the configuration.`,
					rule.id
				)
			);
		}
	}
	return rejections;
}

function validatePageSize(pageSize: number | null): {
	rejections: ResultsTableRejection[];
	resolved: number;
} {
	if (pageSize === null || pageSize === undefined) {
		return { rejections: [], resolved: DEFAULT_PAGE_SIZE };
	}
	if (!Number.isInteger(pageSize) || pageSize <= 0) {
		return {
			rejections: [
				rejection('invalid_page_size', `Page size must be a positive integer; got ${pageSize}.`)
			],
			resolved: DEFAULT_PAGE_SIZE
		};
	}
	if (pageSize > MAX_PAGE_SIZE) {
		return {
			rejections: [
				rejection(
					'page_size_over_maximum',
					`Page size ${pageSize} exceeds the maximum of ${MAX_PAGE_SIZE}.`
				)
			],
			resolved: MAX_PAGE_SIZE
		};
	}
	return { rejections: [], resolved: pageSize };
}

function validateChartPanelId(chartPanelId: ResourceId | null): ResultsTableRejection[] {
	if (chartPanelId === null || chartPanelId === undefined) {
		return [];
	}
	const parsed = parseId(chartPanelId);
	if (!parsed || parsed.kind !== 'panel') {
		return [
			rejection(
				'invalid_chart_panel_id',
				`"${chartPanelId}" is not a valid panel reference.`,
				chartPanelId
			)
		];
	}
	return [];
}

// The one exported entry point. Pure function of (config, catalog): no I/O,
// no dependency on any run (AC8). A rejection anywhere means no normalized
// config is returned -- AC4's "no partially applied result".
export function validateResultsTableConfig(
	config: ResultsTableConfig,
	catalog: CatalogRegistry
): ResultsTableValidationResult {
	const rejections: ResultsTableRejection[] = [];
	const warnings: ResultsTableWarning[] = [];

	const pageSizeResult = validatePageSize(config.pageSize);
	rejections.push(...pageSizeResult.rejections);

	for (const column of config.computedColumns) {
		rejections.push(...validateComputedColumn(column, catalog));
	}
	for (const id of findDuplicateIds(config.computedColumns.map((c) => c.id))) {
		rejections.push(
			rejection(
				'duplicate_computed_column_id',
				`Computed column id "${id}" is used more than once.`,
				id
			)
		);
	}

	rejections.push(...validateDisplayColumns(config, catalog));

	if (config.sort) {
		const primary = validateSortOrGroupKey('sort', config.sort.key, config, catalog);
		rejections.push(...primary.rejections);
		warnings.push(...primary.warnings);
		const tieBreak = config.sort.tieBreak ?? { source: 'result_id' };
		const tieBreakResolution = resolveIdentity(tieBreak, config, catalog);
		if (!tieBreakResolution.known) {
			rejections.push(
				rejection(
					'unknown_catalog_field',
					`Sort tie-break ${describeIdentity(tieBreak)} is not a known catalog field or computed column.`,
					tieBreak.source === 'catalog_field'
						? tieBreak.fieldId
						: tieBreak.source === 'computed_column'
							? tieBreak.computedColumnId
							: undefined
				)
			);
		}
	}

	if (config.grouping) {
		const group = validateSortOrGroupKey('grouping', config.grouping.key, config, catalog);
		rejections.push(...group.rejections);
		warnings.push(...group.warnings);
	}

	rejections.push(...validateFormattingRules(config));
	rejections.push(...validateChartPanelId(config.chartPanelId));

	if (rejections.length > 0) {
		return { ok: false, rejections };
	}

	const normalized: ResultsTableConfig = {
		...config,
		pageSize: pageSizeResult.resolved,
		sort: config.sort
			? {
					...config.sort,
					tieBreak: config.sort.tieBreak ?? { source: 'result_id' },
					tieBreakDirection: config.sort.tieBreakDirection ?? 'asc'
				}
			: null
	};
	return { ok: true, config: normalized, warnings };
}
