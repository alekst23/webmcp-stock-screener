// The catalog item type model: what the screener knows how to name, and what
// each named thing declares about itself. Two sibling epics consume this
// (EPIC-1009 validates filter conditions against it, EPIC-1011 resolves study
// IDs through it), so it is a published contract, not an internal shape.
//
// Domain layer: types only, no I/O and no imports from src/lib/webmcp/.

import type { CatalogIdPrefix } from '../surface/ids';
import type { ReportingBasis } from '../surface/provenance';

export type CatalogKind =
	'field' | 'operator' | 'study' | 'indicator' | 'pattern' | 'interval' | 'universe' | 'template';

export const CATALOG_KINDS: readonly CatalogKind[] = [
	'field',
	'operator',
	'study',
	'indicator',
	'pattern',
	'interval',
	'universe',
	'template'
] as const;

// `operator` items are addressed as `op.*` -- the ID prefix is shorter than the
// kind name because agents type these into filter conditions constantly.
export const CATALOG_KIND_ID_PREFIX: Record<CatalogKind, CatalogIdPrefix> = {
	field: 'field',
	operator: 'op',
	study: 'study',
	indicator: 'indicator',
	pattern: 'pattern',
	interval: 'interval',
	universe: 'universe',
	template: 'template'
};

export type CatalogValueType = 'number' | 'string' | 'boolean' | 'date' | 'enum';

export interface NumericRange {
	min?: number;
	max?: number;
}

interface AvailabilityCore {
	// True when the item needs reference data this project has no source for
	// (sector, industry, index membership, exchange, country, fundamentals,
	// earnings dates). Kept as its own flag rather than inferred from the reason
	// text so callers can filter on it.
	requiresReferenceData: boolean;
	// Intervals the item is available over, by interval item ID.
	intervalIds: readonly string[];
	// ISO dates. Absent means genuinely unknown, not "no bound".
	earliest?: string;
	latest?: string;
}

// A union rather than an optional `reason`, so "unavailable, no explanation" is
// unrepresentable: an agent told an item is unavailable can only act on the
// reason.
export type DataAvailability =
	| (AvailabilityCore & { status: 'available'; reason?: never })
	| (AvailabilityCore & { status: 'partial' | 'unavailable'; reason: string });

export interface CatalogParameter {
	name: string;
	valueType: CatalogValueType;
	unit?: string;
	// null when the parameter has no default and must be supplied.
	defaultValue: number | string | boolean | null;
	range?: NumericRange;
	enumValues?: readonly string[];
	required: boolean;
}

export interface CatalogOutput {
	name: string;
	valueType: CatalogValueType;
	unit?: string;
	range?: NumericRange;
}

interface CatalogItemCore {
	id: string;
	label: string;
	description: string;
	// Search synonyms. What a user is likely to call this thing.
	aliases: readonly string[];
	tags: readonly string[];
	availability: DataAvailability;
	deprecated?: boolean;
}

export interface FieldItem extends CatalogItemCore {
	kind: 'field';
	valueType: CatalogValueType;
	unit?: string;
	enumValues?: readonly string[];
	range?: NumericRange;
	nullable: boolean;
	// Fundamentals only: which reporting basis the value is stated on.
	reportingBasis?: ReportingBasis;
}

// Exactly the eight condition types tool-spec.md's `edit_filter_tree` names.
// EPIC-1009 groups its filter UI and validation by these.
export type ConditionFamily =
	| 'scalar'
	| 'range'
	| 'series_comparison'
	| 'temporal'
	| 'event_relative'
	| 'pattern'
	| 'relative'
	| 'study_output';

export const CONDITION_FAMILIES: readonly ConditionFamily[] = [
	'scalar',
	'range',
	'series_comparison',
	'temporal',
	'event_relative',
	'pattern',
	'relative',
	'study_output'
] as const;

export interface OperatorItem extends CatalogItemCore {
	kind: 'operator';
	// Counting the field under test: `>` is 2, `between` is 3.
	arity: number;
	// Value types the operator accepts on either side. A field whose valueType
	// is not in this list cannot be used with this operator.
	operandTypes: readonly CatalogValueType[];
	resultType: 'boolean';
	conditionFamily: ConditionFamily;
}

interface ComputedItemCore extends CatalogItemCore {
	parameters: readonly CatalogParameter[];
	outputs: readonly CatalogOutput[];
	defaultIntervalId: string;
}

// A study attaches to a chart and produces plottable series; an indicator is a
// scalar derivable per bar for filtering and ranking without being plotted.
// The tool spec lists both kinds but never draws the line -- see spec.md Open
// Question 1. They share a shape, so merging them later is cheap.
export interface StudyItem extends ComputedItemCore {
	kind: 'study';
}

export interface IndicatorItem extends ComputedItemCore {
	kind: 'indicator';
}

export interface PatternItem extends ComputedItemCore {
	kind: 'pattern';
}

export interface IntervalItem extends CatalogItemCore {
	kind: 'interval';
	barSeconds: number;
	// True when bar boundaries follow exchange sessions rather than wall clock.
	sessionAware: boolean;
}

export interface UniverseItem extends CatalogItemCore {
	kind: 'universe';
	// Where membership comes from, in prose an agent can relay to a user.
	membershipSource: string;
	approximateSize?: number;
}

export interface TemplateItem extends CatalogItemCore {
	kind: 'template';
	appliesTo: 'screener' | 'workspace' | 'chart';
	summary: string;
}

export type CatalogItem =
	| FieldItem
	| OperatorItem
	| StudyItem
	| IndicatorItem
	| PatternItem
	| IntervalItem
	| UniverseItem
	| TemplateItem;

// 'enumeration' is what an empty-text kind-restricted listing reports: nothing
// was matched against, the item is simply a member of the requested kind.
// Saying so beats attributing the hit to a field that played no part.
export type CatalogMatchAttribute =
	'id' | 'label' | 'alias' | 'tag' | 'description' | 'enumeration';

export interface CatalogMatch {
	item: CatalogItem;
	// Higher is a better match. Comparable within one result set only.
	score: number;
	matchedOn: CatalogMatchAttribute;
}

export interface CatalogQuery {
	text?: string;
	kinds?: readonly CatalogKind[];
	// Unavailable items are included by default and marked, because "exists but
	// has no data" is different information from "does not exist".
	includeUnavailable?: boolean;
	limit?: number;
}

export type OperatorFieldCheck = { valid: true } | { valid: false; reason: string };
