// What a chart panel shows, and the only door to where that is stored.
//
// Chart state lives under `WorkspaceDocument.extensions.chart`, a record keyed
// by chart panel ID. Every other ticket in this epic goes through the read and
// write helpers below rather than reaching into `extensions` directly, so the
// storage shape has exactly one definition and one normalizer.
//
// Domain layer: pure functions over plain values. Nothing here performs I/O,
// and no function mutates its arguments -- writers return a new document.
import type { ResourceId } from '../../domain/ids';
import { parseId } from '../../domain/ids';
import type { PriceAdjustment } from '../../domain/provenance';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { ChartAnnotation } from './annotations';
import { normalizeAnnotations } from './annotations';
import type { ComparisonRef, InstrumentRef, Normalization } from './instrument';
import {
	copyComparison,
	copyInstrumentRef,
	normalizeComparisons,
	normalizeInstrumentRef,
	validateComparisons,
	validateInstrumentRef,
	validateNormalization
} from './instrument';
import type { StudyInstance } from './studies';
import { copyStudies, normalizeStudies } from './studies';

export const CHART_EXTENSION_KEY = 'chart';

export type ChartTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1wk' | '1mo';

export type ChartCandleType =
	'candlestick' | 'ohlc_bar' | 'line' | 'area' | 'heikin_ashi' | 'hollow_candle';

export type ChartScale = 'linear' | 'logarithmic';

export type ChartSession = 'regular' | 'extended' | 'continuous';

// The chart's own policy is finer than provenance's: a split-adjusted series is
// adjusted for splits but not dividends, which is a distinct and commonly
// wanted basis. See `toProvenancePriceAdjustment` for the mapping and why the
// chart policy must always be echoed alongside provenance.
export type ChartPriceAdjustment = 'adjusted' | 'split_adjusted' | 'unadjusted';

export type RelativeRangeToken =
	'1d' | '5d' | '1mo' | '3mo' | '6mo' | 'ytd' | '1y' | '2y' | '5y' | 'max';

export type ChartRange =
	| { kind: 'explicit'; start: string; end: string }
	| { kind: 'relative'; token: RelativeRangeToken };

export const CHART_TIMEFRAMES: Record<ChartTimeframe, true> = {
	'1m': true,
	'5m': true,
	'15m': true,
	'30m': true,
	'1h': true,
	'4h': true,
	'1d': true,
	'1wk': true,
	'1mo': true
};

export const CHART_CANDLE_TYPES: Record<ChartCandleType, true> = {
	candlestick: true,
	ohlc_bar: true,
	line: true,
	area: true,
	heikin_ashi: true,
	hollow_candle: true
};

export const CHART_SCALES: Record<ChartScale, true> = { linear: true, logarithmic: true };

export const CHART_SESSIONS: Record<ChartSession, true> = {
	regular: true,
	extended: true,
	continuous: true
};

export const CHART_PRICE_ADJUSTMENTS: Record<ChartPriceAdjustment, true> = {
	adjusted: true,
	split_adjusted: true,
	unadjusted: true
};

export const RELATIVE_RANGE_TOKENS: Record<RelativeRangeToken, true> = {
	'1d': true,
	'5d': true,
	'1mo': true,
	'3mo': true,
	'6mo': true,
	ytd: true,
	'1y': true,
	'2y': true,
	'5y': true,
	max: true
};

// Recorded on every chart at creation rather than left implied, so a payload
// never has to say "whatever the default is".
export const DEFAULT_CHART_PRICE_ADJUSTMENT: ChartPriceAdjustment = 'adjusted';
export const DEFAULT_CHART_TIMEFRAME: ChartTimeframe = '1d';
export const DEFAULT_CHART_CANDLE_TYPE: ChartCandleType = 'candlestick';
export const DEFAULT_CHART_SCALE: ChartScale = 'linear';
export const DEFAULT_CHART_SESSION: ChartSession = 'regular';
export const DEFAULT_CHART_RANGE: ChartRange = { kind: 'relative', token: '6mo' };

export interface ChartConfig {
	panelId: ResourceId;
	// Null until the chart is pointed at something; a chart panel is created
	// before it knows what it shows.
	instrument: InstrumentRef | null;
	timeframe: ChartTimeframe;
	range: ChartRange;
	candleType: ChartCandleType;
	scale: ChartScale;
	session: ChartSession;
	comparisons: ComparisonRef[];
	priceAdjustment: ChartPriceAdjustment;
}

export interface ChartState {
	config: ChartConfig;
	studies: StudyInstance[];
	annotations: ChartAnnotation[];
}

export interface ChartConfigPatch {
	instrument?: InstrumentRef | null;
	timeframe?: ChartTimeframe;
	range?: ChartRange;
	candleType?: ChartCandleType;
	scale?: ChartScale;
	session?: ChartSession;
	comparisons?: ComparisonRef[];
	priceAdjustment?: ChartPriceAdjustment;
}

export interface ChartConfigChange {
	field: string;
	from: unknown;
	to: unknown;
}

export type ChartConfigTransition =
	{ ok: true; config: ChartConfig; changes: ChartConfigChange[] } | { ok: false; issues: string[] };

// Changing any of these invalidates cached bars and every study value derived
// from them: the underlying series is no longer the same series.
export const CHART_DATA_INVALIDATING_FIELDS: readonly string[] = [
	'timeframe',
	'range',
	'session',
	'priceAdjustment',
	'instrument'
];

// Lossy by necessity: provenance has no `split_adjusted`, so a split-adjusted
// chart reports `adjusted` there. That is why every chart payload echoes the
// exact `ChartPriceAdjustment` alongside provenance -- reading the provenance
// field alone cannot tell you whether dividends were adjusted for.
export function toProvenancePriceAdjustment(policy: ChartPriceAdjustment): PriceAdjustment {
	return policy === 'unadjusted' ? 'unadjusted' : 'adjusted';
}

export function isChartTimeframe(value: unknown): value is ChartTimeframe {
	return typeof value === 'string' && value in CHART_TIMEFRAMES;
}

export function isChartCandleType(value: unknown): value is ChartCandleType {
	return typeof value === 'string' && value in CHART_CANDLE_TYPES;
}

export function isChartScale(value: unknown): value is ChartScale {
	return typeof value === 'string' && value in CHART_SCALES;
}

export function isChartSession(value: unknown): value is ChartSession {
	return typeof value === 'string' && value in CHART_SESSIONS;
}

export function isChartPriceAdjustment(value: unknown): value is ChartPriceAdjustment {
	return typeof value === 'string' && value in CHART_PRICE_ADJUSTMENTS;
}

export function isRelativeRangeToken(value: unknown): value is RelativeRangeToken {
	return typeof value === 'string' && value in RELATIVE_RANGE_TOKENS;
}

export function isIsoTimestamp(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateChartRange(value: unknown, field: string): string[] {
	if (!isRecord(value)) {
		return [`${field}: expected an explicit {start, end} range or a relative range token.`];
	}
	if (value.kind === 'relative') {
		return isRelativeRangeToken(value.token)
			? []
			: [
					`${field}.token: "${String(value.token)}" is not one of ` +
						`${Object.keys(RELATIVE_RANGE_TOKENS).join(', ')}.`
				];
	}
	if (value.kind !== 'explicit') {
		return [`${field}.kind: expected "explicit" or "relative".`];
	}
	const issues: string[] = [];
	if (!isIsoTimestamp(value.start)) {
		issues.push(`${field}.start: "${String(value.start)}" is not an ISO timestamp.`);
	}
	if (!isIsoTimestamp(value.end)) {
		issues.push(`${field}.end: "${String(value.end)}" is not an ISO timestamp.`);
	}
	if (issues.length === 0 && Date.parse(value.end as string) <= Date.parse(value.start as string)) {
		issues.push(`${field}.end: must be after ${field}.start.`);
	}
	return issues;
}

export function copyChartRange(range: ChartRange): ChartRange {
	return range.kind === 'explicit'
		? { kind: 'explicit', start: range.start, end: range.end }
		: { kind: 'relative', token: range.token };
}

export function copyChartConfig(config: ChartConfig): ChartConfig {
	return {
		panelId: config.panelId,
		instrument: config.instrument ? copyInstrumentRef(config.instrument) : null,
		timeframe: config.timeframe,
		range: copyChartRange(config.range),
		candleType: config.candleType,
		scale: config.scale,
		session: config.session,
		comparisons: config.comparisons.map(copyComparison),
		priceAdjustment: config.priceAdjustment
	};
}

export function copyChartState(state: ChartState): ChartState {
	return {
		config: copyChartConfig(state.config),
		studies: copyStudies(state.studies),
		annotations: state.annotations.map((a) => ({ ...a }))
	};
}

export function createChartConfig(panelId: ResourceId): ChartConfig {
	return {
		panelId,
		instrument: null,
		timeframe: DEFAULT_CHART_TIMEFRAME,
		range: copyChartRange(DEFAULT_CHART_RANGE),
		candleType: DEFAULT_CHART_CANDLE_TYPE,
		scale: DEFAULT_CHART_SCALE,
		session: DEFAULT_CHART_SESSION,
		comparisons: [],
		priceAdjustment: DEFAULT_CHART_PRICE_ADJUSTMENT
	};
}

export function createChartState(panelId: ResourceId): ChartState {
	return { config: createChartConfig(panelId), studies: [], annotations: [] };
}

const SCALAR_VALIDATORS: Record<string, (value: unknown, field: string) => string[]> = {
	timeframe: (v, f) =>
		isChartTimeframe(v) ? [] : [`${f}: "${String(v)}" is not a supported timeframe.`],
	candleType: (v, f) =>
		isChartCandleType(v) ? [] : [`${f}: "${String(v)}" is not a supported candle type.`],
	scale: (v, f) => (isChartScale(v) ? [] : [`${f}: "${String(v)}" is not linear or logarithmic.`]),
	session: (v, f) =>
		isChartSession(v) ? [] : [`${f}: "${String(v)}" is not regular, extended or continuous.`],
	priceAdjustment: (v, f) =>
		isChartPriceAdjustment(v)
			? []
			: [`${f}: "${String(v)}" is not adjusted, split_adjusted or unadjusted.`]
};

function validatePatch(patch: ChartConfigPatch): string[] {
	const issues: string[] = [];
	for (const [field, validate] of Object.entries(SCALAR_VALIDATORS)) {
		const value = (patch as Record<string, unknown>)[field];
		if (value !== undefined) {
			issues.push(...validate(value, field));
		}
	}
	if (patch.range !== undefined) {
		issues.push(...validateChartRange(patch.range, 'range'));
	}
	if (patch.instrument !== undefined && patch.instrument !== null) {
		issues.push(...validateInstrumentRef(patch.instrument, 'instrument'));
	}
	if (patch.comparisons !== undefined) {
		issues.push(...validateComparisons(patch.comparisons, 'comparisons'));
	}
	return issues;
}

function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// Only the fields the patch names are touched; everything else is carried
// through byte-identical. Returns what actually changed, not what was asked
// for, so re-setting a field to its current value reports no change.
export function applyChartConfigPatch(
	config: ChartConfig,
	patch: ChartConfigPatch
): ChartConfigTransition {
	const issues = validatePatch(patch);
	if (issues.length > 0) {
		return { ok: false, issues };
	}
	const next = copyChartConfig(config);
	const changes: ChartConfigChange[] = [];
	for (const key of Object.keys(patch) as (keyof ChartConfigPatch)[]) {
		const to = patch[key];
		if (to === undefined) {
			continue;
		}
		const from = config[key as keyof ChartConfig];
		if (sameValue(from, to)) {
			continue;
		}
		changes.push({ field: key, from, to });
		Object.assign(next, { [key]: to });
	}
	return { ok: true, config: copyChartConfig(next), changes };
}

export function invalidatesChartData(changes: readonly ChartConfigChange[]): boolean {
	return changes.some((c) => CHART_DATA_INVALIDATING_FIELDS.includes(c.field));
}

export function addComparison(
	config: ChartConfig,
	comparison: ComparisonRef
): ChartConfigTransition {
	const issues = validateInstrumentRef(comparison?.instrument, 'comparison.instrument');
	issues.push(...validateNormalization(comparison?.normalization, 'comparison.normalization'));
	if (issues.length > 0) {
		return { ok: false, issues };
	}
	const id = comparison.instrument.instrumentId;
	if (config.comparisons.some((c) => c.instrument.instrumentId === id)) {
		return {
			ok: false,
			issues: [`comparison.instrument.instrumentId: "${id}" is already a comparison.`]
		};
	}
	return applyChartConfigPatch(config, {
		comparisons: [...config.comparisons.map(copyComparison), copyComparison(comparison)]
	});
}

export function updateComparison(
	config: ChartConfig,
	instrumentId: string,
	normalization: Normalization
): ChartConfigTransition {
	if (!config.comparisons.some((c) => c.instrument.instrumentId === instrumentId)) {
		return { ok: false, issues: [unknownComparison(instrumentId)] };
	}
	const issues = validateNormalization(normalization, 'normalization');
	if (issues.length > 0) {
		return { ok: false, issues };
	}
	return applyChartConfigPatch(config, {
		comparisons: config.comparisons.map((c) =>
			c.instrument.instrumentId === instrumentId
				? { instrument: copyInstrumentRef(c.instrument), normalization: { ...normalization } }
				: copyComparison(c)
		)
	});
}

export function removeComparison(config: ChartConfig, instrumentId: string): ChartConfigTransition {
	if (!config.comparisons.some((c) => c.instrument.instrumentId === instrumentId)) {
		return { ok: false, issues: [unknownComparison(instrumentId)] };
	}
	return applyChartConfigPatch(config, {
		comparisons: config.comparisons
			.filter((c) => c.instrument.instrumentId !== instrumentId)
			.map(copyComparison)
	});
}

function unknownComparison(instrumentId: string): string {
	return `comparison_instrument_id: "${instrumentId}" is not a comparison on this chart.`;
}

// Normalize-on-read for persisted state: unrecognized or malformed fields fall
// back to their recorded defaults rather than throwing, so a chart written by
// an older build still opens.
export function normalizeChartConfig(value: unknown, panelId: ResourceId): ChartConfig {
	const source = isRecord(value) ? value : {};
	const range = validateChartRange(source.range, 'range').length === 0 ? source.range : undefined;
	return {
		panelId,
		instrument: normalizeInstrumentRef(source.instrument),
		timeframe: isChartTimeframe(source.timeframe) ? source.timeframe : DEFAULT_CHART_TIMEFRAME,
		range: range ? copyChartRange(range as ChartRange) : copyChartRange(DEFAULT_CHART_RANGE),
		candleType: isChartCandleType(source.candleType)
			? source.candleType
			: DEFAULT_CHART_CANDLE_TYPE,
		scale: isChartScale(source.scale) ? source.scale : DEFAULT_CHART_SCALE,
		session: isChartSession(source.session) ? source.session : DEFAULT_CHART_SESSION,
		comparisons: normalizeComparisons(source.comparisons),
		priceAdjustment: isChartPriceAdjustment(source.priceAdjustment)
			? source.priceAdjustment
			: DEFAULT_CHART_PRICE_ADJUSTMENT
	};
}

export function normalizeChartState(value: unknown, panelId: ResourceId): ChartState {
	const source = isRecord(value) ? value : {};
	return {
		config: normalizeChartConfig(source.config, panelId),
		studies: normalizeStudies(source.studies),
		annotations: normalizeAnnotations(source.annotations)
	};
}

function chartExtension(doc: WorkspaceDocument): Record<string, unknown> {
	const raw = doc.extensions[CHART_EXTENSION_KEY];
	return isRecord(raw) ? raw : {};
}

export function hasChartState(doc: WorkspaceDocument, panelId: ResourceId): boolean {
	return isRecord(chartExtension(doc)[panelId]);
}

// Null rather than a default when the panel has no chart state, so a caller can
// tell "never configured" from "configured back to the defaults".
export function readChartStateOrNull(
	doc: WorkspaceDocument,
	panelId: ResourceId
): ChartState | null {
	const entry = chartExtension(doc)[panelId];
	return isRecord(entry) ? normalizeChartState(entry, panelId) : null;
}

export function readChartState(doc: WorkspaceDocument, panelId: ResourceId): ChartState {
	return readChartStateOrNull(doc, panelId) ?? createChartState(panelId);
}

export function readAllChartStates(doc: WorkspaceDocument): Record<ResourceId, ChartState> {
	const out: Record<ResourceId, ChartState> = {};
	for (const [panelId, entry] of Object.entries(chartExtension(doc))) {
		if (isRecord(entry)) {
			out[panelId] = normalizeChartState(entry, panelId);
		}
	}
	return out;
}

// Returns a new document; the input is never mutated. Other extension keys pass
// through untouched, which is what makes `extensions` safe to share.
export function writeChartState(doc: WorkspaceDocument, state: ChartState): WorkspaceDocument {
	return {
		...doc,
		extensions: {
			...doc.extensions,
			[CHART_EXTENSION_KEY]: {
				...chartExtension(doc),
				[state.config.panelId]: copyChartState(state)
			}
		}
	};
}

export function removeChartState(doc: WorkspaceDocument, panelId: ResourceId): WorkspaceDocument {
	const { [panelId]: _removed, ...rest } = chartExtension(doc);
	return {
		...doc,
		extensions: { ...doc.extensions, [CHART_EXTENSION_KEY]: rest }
	};
}

// High-water marks for `createIdSequencer`, so a reloaded workspace keeps
// counting up instead of restarting at 1 and reissuing a live ID.
export function chartStateIdSeed(doc: WorkspaceDocument): Record<string, number> {
	const seed: Record<string, number> = {};
	const bump = (id: string): void => {
		const parsed = parseId(id);
		if (!parsed || (parsed.kind !== 'study' && parsed.kind !== 'annotation')) {
			return;
		}
		const key = parsed.discriminator ? `${parsed.kind}:${parsed.discriminator}` : parsed.kind;
		seed[key] = Math.max(seed[key] ?? 0, parsed.sequence);
	};
	for (const state of Object.values(readAllChartStates(doc))) {
		state.studies.forEach((s) => bump(s.id));
		state.annotations.forEach((a) => bump(a.id));
	}
	return seed;
}
