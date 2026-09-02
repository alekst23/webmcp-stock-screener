// The wire <-> domain boundary for a results-table configuration (T-1010-6).
// tableConfig.ts (T-1010-1) works entirely in camelCase domain shapes
// (ColumnIdentity, ResultsTableConfig, ...) and never touches the wire; the
// registered renderer contract's `configSchema`/`validateConfig` describe and
// accept the wire shape (snake_case), matching every other renderer contract
// in this program (see chartView.ts's CHART_VIEW_CONFIG_SCHEMA). This module
// is the one place that translation happens, in both directions.
//
// Application layer: touches wire shape and produces ConfigError paths a
// tool caller can act on, but performs no I/O and holds no deps -- pure
// functions of their input, like tableConfig.ts's own validateResultsTableConfig.
import type { ConfigError } from '../../panels/registry/panelKindRegistry';
import type {
	ColumnIdentity,
	ComputedColumn,
	DisplayColumn,
	FormattingRule,
	GroupSpec,
	ResultsTableConfig,
	SortDirection,
	SortSpec
} from '../domain/tableConfig';
import type { CatalogValueType } from '../../catalog/types';

const VALUE_TYPES: readonly CatalogValueType[] = ['number', 'string', 'boolean', 'date', 'enum'];
const SORT_DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];
const COMPARATORS = ['lt', 'lte', 'gt', 'gte', 'eq', 'ne'] as const;

export const RESULTS_TABLE_CONFIG_SCHEMA = {
	type: 'object',
	description:
		'How a results table panel presents a screener run: displayed columns, computed columns, ' +
		'sort, grouping, conditional formatting, page size, and the chart panel it is bound to. Only ' +
		'the properties named are changed; every other property is left as it was.',
	properties: {
		columns: { type: 'array', description: 'Displayed columns, in display order.' },
		computed_columns: {
			type: 'array',
			description: 'Formula-derived columns available to display.'
		},
		sort: { type: 'object', description: 'The active sort key and direction, or null for none.' },
		grouping: { type: 'object', description: 'The active grouping key, or null for none.' },
		formatting_rules: { type: 'array', description: 'Conditional formatting rules.' },
		page_size: { type: 'number', description: 'Rows per page. Defaults when omitted.' },
		chart_panel_id: { type: 'string', description: 'The chart panel this table drives, or null.' }
	}
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function err(field: string, reason: string): ConfigError {
	return { field, reason };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: ConfigError[] };

function parseIdentity(raw: unknown, path: string): Parsed<ColumnIdentity> {
	if (!isRecord(raw)) {
		return { ok: false, errors: [err(path, 'must be an object')] };
	}
	if (raw.source === 'catalog_field') {
		if (typeof raw.field_id !== 'string') {
			return { ok: false, errors: [err(`${path}.field_id`, 'must be a string')] };
		}
		return { ok: true, value: { source: 'catalog_field', fieldId: raw.field_id } };
	}
	if (raw.source === 'computed_column') {
		if (typeof raw.computed_column_id !== 'string') {
			return { ok: false, errors: [err(`${path}.computed_column_id`, 'must be a string')] };
		}
		return {
			ok: true,
			value: { source: 'computed_column', computedColumnId: raw.computed_column_id }
		};
	}
	if (raw.source === 'result_id') {
		return { ok: true, value: { source: 'result_id' } };
	}
	return {
		ok: false,
		errors: [err(`${path}.source`, 'must be one of catalog_field, computed_column, result_id')]
	};
}

function parseValueType(raw: unknown, path: string): Parsed<CatalogValueType> {
	if (typeof raw !== 'string' || !VALUE_TYPES.includes(raw as CatalogValueType)) {
		return { ok: false, errors: [err(path, `must be one of ${VALUE_TYPES.join(', ')}`)] };
	}
	return { ok: true, value: raw as CatalogValueType };
}

function parseDisplayColumn(raw: unknown, path: string): Parsed<DisplayColumn> {
	if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.label !== 'string') {
		return { ok: false, errors: [err(path, 'must be an object with string "id" and "label"')] };
	}
	const identity = parseIdentity(raw.identity, `${path}.identity`);
	if (!identity.ok) return identity;
	const valueType = parseValueType(raw.value_type, `${path}.value_type`);
	if (!valueType.ok) return valueType;
	return {
		ok: true,
		value: {
			id: raw.id,
			identity: identity.value,
			label: raw.label,
			valueType: valueType.value,
			...(typeof raw.unit === 'string' ? { unit: raw.unit } : {})
		}
	};
}

function parseComputedColumn(raw: unknown, path: string): Parsed<ComputedColumn> {
	if (
		!isRecord(raw) ||
		typeof raw.id !== 'string' ||
		typeof raw.label !== 'string' ||
		typeof raw.expression !== 'string'
	) {
		return {
			ok: false,
			errors: [err(path, 'must be an object with string "id", "label" and "expression"')]
		};
	}
	const valueType = parseValueType(raw.value_type, `${path}.value_type`);
	if (!valueType.ok) return valueType;
	return {
		ok: true,
		value: {
			id: raw.id,
			label: raw.label,
			expression: raw.expression,
			valueType: valueType.value,
			...(typeof raw.unit === 'string' ? { unit: raw.unit } : {})
		}
	};
}

function parseSort(raw: unknown, path: string): Parsed<SortSpec | null> {
	if (raw === null || raw === undefined) {
		return { ok: true, value: null };
	}
	if (!isRecord(raw)) {
		return { ok: false, errors: [err(path, 'must be an object or null')] };
	}
	const key = parseIdentity(raw.key, `${path}.key`);
	if (!key.ok) return key;
	if (raw.direction !== undefined && !SORT_DIRECTIONS.includes(raw.direction as SortDirection)) {
		return { ok: false, errors: [err(`${path}.direction`, 'must be "asc" or "desc"')] };
	}
	const spec: SortSpec = { key: key.value, direction: (raw.direction as SortDirection) ?? 'desc' };
	if (raw.tie_break !== undefined) {
		const tieBreak = parseIdentity(raw.tie_break, `${path}.tie_break`);
		if (!tieBreak.ok) return tieBreak;
		spec.tieBreak = tieBreak.value;
	}
	if (raw.tie_break_direction !== undefined) {
		if (!SORT_DIRECTIONS.includes(raw.tie_break_direction as SortDirection)) {
			return { ok: false, errors: [err(`${path}.tie_break_direction`, 'must be "asc" or "desc"')] };
		}
		spec.tieBreakDirection = raw.tie_break_direction as SortDirection;
	}
	return { ok: true, value: spec };
}

function parseGrouping(raw: unknown, path: string): Parsed<GroupSpec | null> {
	if (raw === null || raw === undefined) {
		return { ok: true, value: null };
	}
	if (!isRecord(raw)) {
		return { ok: false, errors: [err(path, 'must be an object or null')] };
	}
	const key = parseIdentity(raw.key, `${path}.key`);
	if (!key.ok) return key;
	return { ok: true, value: { key: key.value } };
}

function parseFormattingRule(raw: unknown, path: string): Parsed<FormattingRule> {
	if (!isRecord(raw) || typeof raw.id !== 'string') {
		return { ok: false, errors: [err(path, 'must be an object with a string "id"')] };
	}
	const predicate: unknown = raw.predicate;
	const style: unknown = raw.style;
	if (!isRecord(predicate) || !isRecord(style)) {
		return { ok: false, errors: [err(path, 'must have object "predicate" and "style"')] };
	}
	const columnId: unknown = predicate.column_id;
	if (typeof columnId !== 'string') {
		return { ok: false, errors: [err(`${path}.predicate.column_id`, 'must be a string')] };
	}
	const comparator: unknown = predicate.comparator;
	if (
		typeof comparator !== 'string' ||
		!COMPARATORS.includes(comparator as (typeof COMPARATORS)[number])
	) {
		return {
			ok: false,
			errors: [err(`${path}.predicate.comparator`, `must be one of ${COMPARATORS.join(', ')}`)]
		};
	}
	const value: unknown = predicate.value;
	if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
		return {
			ok: false,
			errors: [err(`${path}.predicate.value`, 'must be a number, string or boolean')]
		};
	}
	const backgroundColor: unknown = style.background_color;
	const textColor: unknown = style.text_color;
	const icon: unknown = style.icon;
	return {
		ok: true,
		value: {
			id: raw.id,
			predicate: {
				columnId,
				comparator: comparator as FormattingRule['predicate']['comparator'],
				value
			},
			style: {
				...(typeof backgroundColor === 'string' ? { backgroundColor } : {}),
				...(typeof textColor === 'string' ? { textColor } : {}),
				...(typeof icon === 'string' ? { icon } : {})
			}
		}
	};
}

function parseArray<T>(
	raw: unknown,
	path: string,
	parseItem: (item: unknown, itemPath: string) => Parsed<T>
): Parsed<T[]> {
	if (raw === undefined) {
		return { ok: true, value: [] };
	}
	if (!Array.isArray(raw)) {
		return { ok: false, errors: [err(path, 'must be an array')] };
	}
	const values: T[] = [];
	for (let i = 0; i < raw.length; i++) {
		const parsed = parseItem(raw[i], `${path}[${i}]`);
		if (!parsed.ok) return parsed;
		values.push(parsed.value);
	}
	return { ok: true, value: values };
}

// Lenient on absence (a missing field resolves to its empty default -- the
// same stance tableConfig.ts's own validateResultsTableConfig takes toward
// `sort`/`grouping`/`pageSize`), strict on a present field's shape. Used both
// to parse a caller's candidate config and, by the renderer contract's
// describeConfigChange glue, to re-read the panel's stored previous config.
export function parseWireResultsTableConfig(
	input: unknown
): { ok: true; config: ResultsTableConfig } | { ok: false; errors: ConfigError[] } {
	if (!isRecord(input)) {
		return { ok: false, errors: [err('config', 'must be an object')] };
	}
	const columns = parseArray(input.columns, 'columns', parseDisplayColumn);
	if (!columns.ok) return columns;
	const computedColumns = parseArray(
		input.computed_columns,
		'computed_columns',
		parseComputedColumn
	);
	if (!computedColumns.ok) return computedColumns;
	const sort = parseSort(input.sort, 'sort');
	if (!sort.ok) return sort;
	const grouping = parseGrouping(input.grouping, 'grouping');
	if (!grouping.ok) return grouping;
	const formattingRules = parseArray(
		input.formatting_rules,
		'formatting_rules',
		parseFormattingRule
	);
	if (!formattingRules.ok) return formattingRules;
	if (
		input.page_size !== undefined &&
		input.page_size !== null &&
		typeof input.page_size !== 'number'
	) {
		return { ok: false, errors: [err('page_size', 'must be a number or null')] };
	}
	if (
		input.chart_panel_id !== undefined &&
		input.chart_panel_id !== null &&
		typeof input.chart_panel_id !== 'string'
	) {
		return { ok: false, errors: [err('chart_panel_id', 'must be a string or null')] };
	}

	return {
		ok: true,
		config: {
			columns: columns.value,
			computedColumns: computedColumns.value,
			sort: sort.value,
			grouping: grouping.value,
			formattingRules: formattingRules.value,
			pageSize: (input.page_size as number | undefined) ?? null,
			chartPanelId: (input.chart_panel_id as string | undefined) ?? null
		}
	};
}

function wireIdentity(identity: ColumnIdentity): Record<string, unknown> {
	if (identity.source === 'catalog_field')
		return { source: 'catalog_field', field_id: identity.fieldId };
	if (identity.source === 'computed_column') {
		return { source: 'computed_column', computed_column_id: identity.computedColumnId };
	}
	return { source: 'result_id' };
}

function wireDisplayColumn(column: DisplayColumn): Record<string, unknown> {
	return {
		id: column.id,
		identity: wireIdentity(column.identity),
		label: column.label,
		value_type: column.valueType,
		...(column.unit !== undefined ? { unit: column.unit } : {})
	};
}

function wireComputedColumn(column: ComputedColumn): Record<string, unknown> {
	return {
		id: column.id,
		label: column.label,
		expression: column.expression,
		value_type: column.valueType,
		...(column.unit !== undefined ? { unit: column.unit } : {})
	};
}

function wireSort(sort: SortSpec | null): Record<string, unknown> | null {
	if (sort === null) return null;
	return {
		key: wireIdentity(sort.key),
		direction: sort.direction,
		...(sort.tieBreak !== undefined ? { tie_break: wireIdentity(sort.tieBreak) } : {}),
		...(sort.tieBreakDirection !== undefined ? { tie_break_direction: sort.tieBreakDirection } : {})
	};
}

function wireFormattingRule(rule: FormattingRule): Record<string, unknown> {
	return {
		id: rule.id,
		predicate: {
			column_id: rule.predicate.columnId,
			comparator: rule.predicate.comparator,
			value: rule.predicate.value
		},
		style: {
			...(rule.style.backgroundColor !== undefined
				? { background_color: rule.style.backgroundColor }
				: {}),
			...(rule.style.textColor !== undefined ? { text_color: rule.style.textColor } : {}),
			...(rule.style.icon !== undefined ? { icon: rule.style.icon } : {})
		}
	};
}

// The normalized-config half of a successful validateResultsTableConfig
// result, serialized back to the wire shape that becomes the new panel.config
// (mirroring results/domain/page.ts's toWireResultsPage convention).
export function toWireResultsTableConfig(config: ResultsTableConfig): Record<string, unknown> {
	return {
		columns: config.columns.map(wireDisplayColumn),
		computed_columns: config.computedColumns.map(wireComputedColumn),
		sort: wireSort(config.sort),
		grouping: config.grouping ? { key: wireIdentity(config.grouping.key) } : null,
		formatting_rules: config.formattingRules.map(wireFormattingRule),
		page_size: config.pageSize,
		chart_panel_id: config.chartPanelId
	};
}

export function defaultWireResultsTableConfig(): Record<string, unknown> {
	return toWireResultsTableConfig({
		columns: [],
		computedColumns: [],
		sort: null,
		grouping: null,
		formattingRules: [],
		pageSize: null,
		chartPanelId: null
	});
}
