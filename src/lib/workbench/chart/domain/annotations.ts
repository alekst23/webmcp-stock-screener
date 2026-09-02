// Chart annotations: the five drawing kinds an agent can add to a chart.
//
// Anchors are a discriminated union carrying their own `kind`, and
// `ChartAnnotation` ties the annotation's `kind` to its anchors' `kind`, so a
// trendline holding a price-level's anchors does not type-check -- the runtime
// validation below is a second line of defence for values arriving off the
// wire, not the only one.
//
// Every annotation stamps the price-adjustment policy in force when it was
// drawn. A price drawn on unadjusted data does not mean the same number after
// the chart switches to adjusted prices, so the stamp is what lets a policy
// change surface as staleness instead of a silent, wrong re-plot.
//
// Domain layer: pure types and pure functions, no I/O.
import type { ResourceId } from '../../domain/ids';
import type { ChartPriceAdjustment } from './chartState';

export type AnnotationKind = 'trendline' | 'price_level' | 'date_range' | 'label' | 'setup_window';

export interface TimePricePoint {
	// ISO timestamp of the bar the point sits on.
	time: string;
	price: number;
}

export interface TrendlineAnchors {
	kind: 'trendline';
	from: TimePricePoint;
	to: TimePricePoint;
}

export interface PriceLevelAnchors {
	kind: 'price_level';
	price: number;
}

export interface DateRangeAnchors {
	kind: 'date_range';
	start: string;
	end: string;
}

export interface SetupWindowAnchors {
	kind: 'setup_window';
	start: string;
	end: string;
}

export interface LabelAnchors {
	kind: 'label';
	at: TimePricePoint;
	text: string;
}

export type AnnotationAnchors =
	TrendlineAnchors | PriceLevelAnchors | DateRangeAnchors | SetupWindowAnchors | LabelAnchors;

// The generic is what makes a mismatched pair unrepresentable: `kind` is read
// off the anchors' own discriminant rather than declared independently.
interface AnnotationOf<A extends AnnotationAnchors> {
	id: ResourceId;
	kind: A['kind'];
	anchors: A;
	priceAdjustment: ChartPriceAdjustment;
	label?: string;
}

export type ChartAnnotation =
	| AnnotationOf<TrendlineAnchors>
	| AnnotationOf<PriceLevelAnchors>
	| AnnotationOf<DateRangeAnchors>
	| AnnotationOf<SetupWindowAnchors>
	| AnnotationOf<LabelAnchors>;

export type AnnotationResult =
	{ ok: true; annotation: ChartAnnotation } | { ok: false; issues: string[] };

export const ANNOTATION_KINDS: Record<AnnotationKind, true> = {
	trendline: true,
	price_level: true,
	date_range: true,
	label: true,
	setup_window: true
};

// A Record over the type, not a copied string list: adding a value to
// `ChartPriceAdjustment` without adding it here is a compile error, so this
// cannot drift from chartState.ts even though only its *type* is imported
// (which is what keeps this module free of a runtime dependency on it).
const PRICE_ADJUSTMENTS: Record<ChartPriceAdjustment, true> = {
	adjusted: true,
	split_adjusted: true,
	unadjusted: true
};

export function isAnnotationKind(value: unknown): value is AnnotationKind {
	return typeof value === 'string' && value in ANNOTATION_KINDS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function validatePrice(value: unknown, field: string): string[] {
	return typeof value === 'number' && Number.isFinite(value)
		? []
		: [`${field}: "${String(value)}" is not a finite price.`];
}

function validateTime(value: unknown, field: string): string[] {
	return isIsoTimestamp(value) ? [] : [`${field}: "${String(value)}" is not an ISO timestamp.`];
}

function validatePoint(value: unknown, field: string): string[] {
	if (!isRecord(value)) {
		return [`${field}: expected a {time, price} point.`];
	}
	return [
		...validateTime(value.time, `${field}.time`),
		...validatePrice(value.price, `${field}.price`)
	];
}

function validateSpan(value: Record<string, unknown>, field: string): string[] {
	const issues = [
		...validateTime(value.start, `${field}.start`),
		...validateTime(value.end, `${field}.end`)
	];
	if (issues.length > 0) {
		return issues;
	}
	if (Date.parse(value.end as string) <= Date.parse(value.start as string)) {
		return [`${field}.end: must be after ${field}.start.`];
	}
	return [];
}

const ANCHOR_VALIDATORS: Record<AnnotationKind, (anchors: Record<string, unknown>) => string[]> = {
	trendline: (a) => {
		const issues = [...validatePoint(a.from, 'anchors.from'), ...validatePoint(a.to, 'anchors.to')];
		if (issues.length > 0) {
			return issues;
		}
		const from = a.from as TimePricePoint;
		const to = a.to as TimePricePoint;
		return from.time === to.time && from.price === to.price
			? ['anchors: a trendline needs two distinct points; both anchors are the same point.']
			: [];
	},
	price_level: (a) => validatePrice(a.price, 'anchors.price'),
	date_range: (a) => validateSpan(a, 'anchors'),
	setup_window: (a) => validateSpan(a, 'anchors'),
	label: (a) => {
		const issues = validatePoint(a.at, 'anchors.at');
		if (typeof a.text !== 'string' || a.text.trim().length === 0) {
			issues.push('anchors.text: a label needs non-empty text.');
		}
		return issues;
	}
};

// The message names what each kind expects, so "one point for a trendline" is
// actionable rather than a bare type error.
const EXPECTED_ANCHORS: Record<AnnotationKind, string> = {
	trendline: 'two {time, price} points as `from` and `to`',
	price_level: 'a single finite `price`',
	date_range: 'a `start` and `end` ISO timestamp',
	setup_window: 'a `start` and `end` ISO timestamp',
	label: 'a single {time, price} point as `at`, plus `text`'
};

export function validateAnnotationAnchors(kind: AnnotationKind, anchors: unknown): string[] {
	if (!isRecord(anchors)) {
		return [`anchors: a ${kind} annotation expects ${EXPECTED_ANCHORS[kind]}.`];
	}
	if (anchors.kind !== kind) {
		return [
			`anchors.kind: "${String(anchors.kind)}" does not match the annotation kind "${kind}"; ` +
				`a ${kind} expects ${EXPECTED_ANCHORS[kind]}.`
		];
	}
	return ANCHOR_VALIDATORS[kind](anchors);
}

export interface AnnotationInput {
	id: ResourceId;
	kind: AnnotationKind;
	anchors: unknown;
	priceAdjustment: ChartPriceAdjustment;
	label?: string;
}

export function createAnnotation(input: AnnotationInput): AnnotationResult {
	const issues: string[] = [];
	if (typeof input.id !== 'string' || input.id.length === 0) {
		issues.push('annotation_id: expected a stable annotation ID.');
	}
	if (!isAnnotationKind(input.kind)) {
		issues.push(
			`kind: "${String(input.kind)}" is not one of ${Object.keys(ANNOTATION_KINDS).join(', ')}.`
		);
		return { ok: false, issues };
	}
	if (!(input.priceAdjustment in PRICE_ADJUSTMENTS)) {
		issues.push(`price_adjustment: "${String(input.priceAdjustment)}" is not a known policy.`);
	}
	issues.push(...validateAnnotationAnchors(input.kind, input.anchors));
	if (issues.length > 0) {
		return { ok: false, issues };
	}
	const annotation = {
		id: input.id,
		kind: input.kind,
		anchors: copyAnchors(input.anchors as AnnotationAnchors),
		priceAdjustment: input.priceAdjustment,
		...(input.label !== undefined ? { label: input.label } : {})
	} as ChartAnnotation;
	return { ok: true, annotation };
}

export function copyAnchors(anchors: AnnotationAnchors): AnnotationAnchors {
	switch (anchors.kind) {
		case 'trendline':
			return {
				kind: 'trendline',
				from: { time: anchors.from.time, price: anchors.from.price },
				to: { time: anchors.to.time, price: anchors.to.price }
			};
		case 'price_level':
			return { kind: 'price_level', price: anchors.price };
		case 'date_range':
			return { kind: 'date_range', start: anchors.start, end: anchors.end };
		case 'setup_window':
			return { kind: 'setup_window', start: anchors.start, end: anchors.end };
		case 'label':
			return {
				kind: 'label',
				at: { time: anchors.at.time, price: anchors.at.price },
				text: anchors.text
			};
	}
}

export function copyAnnotation(annotation: ChartAnnotation): ChartAnnotation {
	return {
		id: annotation.id,
		kind: annotation.kind,
		anchors: copyAnchors(annotation.anchors),
		priceAdjustment: annotation.priceAdjustment,
		...(annotation.label !== undefined ? { label: annotation.label } : {})
	} as ChartAnnotation;
}

// Only price-bearing kinds can go stale: a date range names bars, and a bar's
// timestamp does not change when the adjustment policy does.
export function isPriceBearing(annotation: ChartAnnotation): boolean {
	return (
		annotation.kind === 'trendline' ||
		annotation.kind === 'price_level' ||
		annotation.kind === 'label'
	);
}

export function isAnnotationStale(
	annotation: ChartAnnotation,
	chartPriceAdjustment: ChartPriceAdjustment
): boolean {
	return isPriceBearing(annotation) && annotation.priceAdjustment !== chartPriceAdjustment;
}

export function staleAnnotationIds(
	annotations: readonly ChartAnnotation[],
	chartPriceAdjustment: ChartPriceAdjustment
): ResourceId[] {
	return annotations.filter((a) => isAnnotationStale(a, chartPriceAdjustment)).map((a) => a.id);
}

// The times and prices an annotation is anchored at, so a caller can check it
// falls inside the chart's configured range without knowing the anchor shapes.
export function annotationTimes(annotation: ChartAnnotation): string[] {
	const anchors = annotation.anchors;
	switch (anchors.kind) {
		case 'trendline':
			return [anchors.from.time, anchors.to.time];
		case 'price_level':
			return [];
		case 'date_range':
		case 'setup_window':
			return [anchors.start, anchors.end];
		case 'label':
			return [anchors.at.time];
	}
}

export function annotationPrices(annotation: ChartAnnotation): number[] {
	const anchors = annotation.anchors;
	switch (anchors.kind) {
		case 'trendline':
			return [anchors.from.price, anchors.to.price];
		case 'price_level':
			return [anchors.price];
		case 'date_range':
		case 'setup_window':
			return [];
		case 'label':
			return [anchors.at.price];
	}
}

// Normalize-on-read: a malformed persisted annotation is dropped, the rest of
// the list survives, and nothing throws.
export function normalizeAnnotations(value: unknown): ChartAnnotation[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: ChartAnnotation[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (!isRecord(entry) || typeof entry.id !== 'string' || seen.has(entry.id)) {
			continue;
		}
		if (!isAnnotationKind(entry.kind)) {
			continue;
		}
		const result = createAnnotation({
			id: entry.id,
			kind: entry.kind,
			anchors: entry.anchors,
			priceAdjustment: entry.priceAdjustment as ChartPriceAdjustment,
			...(typeof entry.label === 'string' ? { label: entry.label } : {})
		});
		if (result.ok) {
			seen.add(entry.id);
			out.push(result.annotation);
		}
	}
	return out;
}
